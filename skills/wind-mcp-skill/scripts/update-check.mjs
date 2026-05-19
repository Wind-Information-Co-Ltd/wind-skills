#!/usr/bin/env node
// update-check.mjs — 通用 wind-skills 升级感知探活脚本 v2(installedAt-反查方案)
// 通用版：自动从目录路径检测 skill name，无需硬编码
// 由各 skill 的 CLI 异步 spawn,读 lock 条目 → 反查"装时刻"的远端 commit → 跟当前远端 tree SHA 对比
// 设计: 完全静默,绝不阻塞主流程,任何异常吞掉
//
// 与 baseline 方案(v1)的区别:
//   - v1: 用 baseline 文件存"上次远端 SHA",首次 check 把当下当基准 → "装老版本"漏报
//   - v2: 不用 baseline,反查 lock.updatedAt 时刻的真实 commit,精确对比
// 统一缓存: ~/.cache/wind-aifinmarket/update-state.json (schema v3, 多 skill 共享)

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, openSync, closeSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = basename(dirname(SCRIPT_DIR));

const CACHE_DIR = join(homedir(), '.cache', 'wind-aifinmarket');
const CACHE_FILE = join(CACHE_DIR, 'update-state.json');
const CACHE_SCHEMA_VERSION = 3;

const TTL_UP_TO_DATE_MS    = 60 * 60 * 1000;
const TTL_AVAILABLE_MS     = 12 * 60 * 60 * 1000;
const TTL_UNKNOWN_MS       = 24 * 60 * 60 * 1000;
const TTL_TRANSIENT_MS     =  5 * 60 * 1000;
const TTL_RATE_LIMIT_MS    = 60 * 60 * 1000;

const NETWORK_TIMEOUT_MS = 5_000;
const INSTALLED_AT_TOLERANCE_MS = 60 * 60 * 1000;

// ───── 统一缓存读写 ─────

const LEGACY_CACHE_FILES = [
  'wind-find-update-state.json',
  'wind-find-update-baseline.json',
  'update-baseline.json',  // v1 baseline 残留(v2 反查方案不再使用)
];

function readUnifiedCache() {
  if (!existsSync(CACHE_FILE)) return { schemaVersion: CACHE_SCHEMA_VERSION, skills: {} };
  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (data?.schemaVersion !== CACHE_SCHEMA_VERSION || !data.skills) {
      return { schemaVersion: CACHE_SCHEMA_VERSION, skills: {} };
    }
    return data;
  } catch { return { schemaVersion: CACHE_SCHEMA_VERSION, skills: {} }; }
}

// 文件锁: O_EXCL 创建 lockfile,陈旧锁(>30s)自动清理。拿不到锁等 100ms 重试,5 次后放弃(不阻塞)。
const LOCK_FILE = CACHE_FILE + '.lock';
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_DELAY_MS = 100;
const LOCK_MAX_RETRIES = 5;

async function withLock(fn) {
  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    try {
      if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
      // 陈旧锁清理(上次进程崩了没清)
      try {
        const st = statSync(LOCK_FILE);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) unlinkSync(LOCK_FILE);
      } catch {}
      // O_EXCL 独占创建
      const fd = openSync(LOCK_FILE, 'wx');
      try {
        return fn();
      } finally {
        try { closeSync(fd); } catch {}
        try { unlinkSync(LOCK_FILE); } catch {}
      }
    } catch (e) {
      if (e?.code !== 'EEXIST') return;  // 非"已存在"的错(权限/磁盘),直接放弃
      await new Promise(r => setTimeout(r, LOCK_RETRY_DELAY_MS));
    }
  }
  // 拿不到锁就放弃,绝不阻塞主流程
}

async function writeUnifiedCacheSkill(skillState) {
  await withLock(() => {
    const full = readUnifiedCache();
    const prev = full.skills[SKILL_NAME];
    const merged = { ...skillState, lastCheck: new Date().toISOString() };
    if (prev?.snoozedUntil) merged.snoozedUntil = prev.snoozedUntil;
    if (typeof prev?.snoozeLevel === 'number') merged.snoozeLevel = prev.snoozeLevel;
    full.skills[SKILL_NAME] = merged;
    writeFileSync(CACHE_FILE, JSON.stringify(full, null, 2));
  });
}

function cleanupLegacyFiles() {
  for (const name of LEGACY_CACHE_FILES) {
    const p = join(CACHE_DIR, name);
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }
}

// ───── lock 签名 ─────

function isCacheFresh(cache, currentSignature) {
  if (!cache?.lastCheck || !cache?.ttlMs) return false;
  if (cache.lockSignature !== currentSignature) return false;
  return Date.now() - new Date(cache.lastCheck).getTime() < cache.ttlMs;
}

function buildLockSignature(entries) {
  if (!entries || entries.length === 0) return null;
  return entries
    .map(({ entry, lockPath }) => `${lockPath}|${entry.updatedAt || entry.installedAt || ''}`)
    .sort()
    .join('\n');
}

// ───── lock 文件探测 ─────

function walkUp(startDir) {
  const dirs = [];
  let dir = resolve(startDir);
  while (true) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

function findLockFiles() {
  const candidates = new Set();
  const xdg = process.env.XDG_STATE_HOME;
  candidates.add(xdg
    ? join(xdg, 'skills', '.skill-lock.json')
    : join(homedir(), '.agents', '.skill-lock.json'));
  for (const dir of walkUp(SCRIPT_DIR)) {
    candidates.add(join(dir, 'skills-lock.json'));
  }
  try {
    const cwd = process.cwd();
    for (const dir of walkUp(cwd)) {
      candidates.add(join(dir, 'skills-lock.json'));
    }
  } catch {}
  return [...candidates].filter(p => existsSync(p));
}

function collectEntries() {
  const found = [];
  for (const lockPath of findLockFiles()) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      const entry = lock?.skills?.[SKILL_NAME];
      if (entry) found.push({ entry, lockPath });
    } catch {}
  }
  return found;
}

// ───── 条目解析 ─────

function parseSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl) return null;
  let host = null;
  if (sourceUrl.includes('github.com')) host = 'github';
  else if (sourceUrl.includes('gitee.com')) host = 'gitee';
  else return null;
  const m = sourceUrl.match(/(?:github\.com|gitee\.com)[:/]([^/]+)\/([^/]+?)(?:\.git)?(?:$|[/?#])/);
  if (!m) return null;
  return { host, owner: m[1], repo: m[2] };
}

function normalizeSkillDir(skillPath) {
  return String(skillPath || '')
    .replace(/\\/g, '/')
    .replace(/\/?SKILL\.md$/i, '')
    .replace(/\/+$/, '');
}

// ───── HTTP ─────

async function fetchJson(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': `${SKILL_NAME}-update-check` },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 429) {
        const remaining = resp.headers.get('x-ratelimit-remaining');
        if (remaining === '0' || resp.status === 429) return { error: 'rate_limit' };
      }
      return { error: `http_${resp.status}` };
    }
    return { data: await resp.json() };
  } catch (e) {
    return { error: e?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

// ───── 远端 API ─────

function apiBase(host) {
  return host === 'github' ? 'https://api.github.com' : 'https://gitee.com/api/v5';
}

async function fetchTreeBySha({ host, owner, repo }, sha) {
  const r = await fetchJson(`${apiBase(host)}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
  if (r.error) return { error: r.error };
  if (r.data && Array.isArray(r.data.tree)) return { tree: r.data };
  return { error: 'shape' };
}

async function fetchCurrentTree(parsed, ref) {
  const branches = ref ? [ref] : (parsed.host === 'gitee' ? ['main', 'master'] : ['HEAD', 'main', 'master']);
  let lastError = null;
  for (const branch of branches) {
    const r = await fetchTreeBySha(parsed, branch);
    if (r.tree) return r;
    lastError = r.error;
    if (r.error === 'rate_limit') return r;
  }
  return { error: lastError || 'shape' };
}

async function fetchCommitAtTime({ host, owner, repo }, ref, skillDir, installedAt) {
  const until = new Date(new Date(installedAt).getTime() + INSTALLED_AT_TOLERANCE_MS).toISOString();
  const params = new URLSearchParams({ until, per_page: '1' });
  if (skillDir) params.set('path', skillDir);
  if (ref) params.set('sha', ref);
  const url = `${apiBase(host)}/repos/${owner}/${repo}/commits?${params.toString()}`;
  const r = await fetchJson(url);
  if (r.error) return { error: r.error };
  if (!Array.isArray(r.data) || r.data.length === 0) return { error: 'no_commit_at_time' };
  const sha = r.data[0]?.sha;
  if (typeof sha !== 'string') return { error: 'commit_shape' };
  return { sha };
}

function findSkillSha(tree, skillDir) {
  if (!skillDir) return tree.sha || null;
  return tree.tree.find(t => t.type === 'tree' && t.path === skillDir)?.sha || null;
}

function shortHash(h) {
  return typeof h === 'string' ? h.slice(0, 7) : '';
}

// ───── 通知打印 ─────

function printNotice(state) {
  if (state.snoozedUntil && new Date(state.snoozedUntil) > new Date()) return;

  if (state.status === 'update_available') {
    const lines = ['', `[wind-skills] 检测到 ${state.outdated.length} 个 skill 有新版:`];
    for (const o of state.outdated) {
      const isGitee = typeof o.sourceUrl === 'string' && o.sourceUrl.includes('gitee.com');
      const upgradeCmd = isGitee
        ? `npx skills add ${o.sourceUrl} --skill ${o.name} -g -y  # Gitee 源不支持 update,需重装`
        : `npx skills update ${o.name} -g -y`;
      lines.push(`  • ${o.name.padEnd(34)} ${o.current || '?'} → ${o.latest}`);
      lines.push(`    升级: ${upgradeCmd}`);
    }
    lines.push('');
    process.stderr.write(lines.join('\n') + '\n');
    return;
  }

  if (state.status === 'transient_error') {
    process.stderr.write(`\n[wind-skills] 检查更新失败,可能是网络问题(reason=${state.reason || 'unknown'})\n\n`);
    return;
  }

  if (state.status === 'unknown') {
    process.stderr.write(`\n[wind-skills] 无法确认是否最新(reason=${state.reason || 'unknown'})\n\n`);
  }
}

// ───── 主逻辑 ─────

async function main() {
  cleanupLegacyFiles();

  const fullCache = readUnifiedCache();
  const myCache = fullCache.skills[SKILL_NAME] || null;
  const entries = collectEntries();
  const lockSignature = buildLockSignature(entries);

  // cache 还新鲜 → 打印缓存中的通知后退出。详细结构化输出由 cli.mjs 走 JSON envelope。
  if (isCacheFresh(myCache, lockSignature)) {
    if (myCache) printNotice(myCache);
    return;
  }

  if (entries.length === 0) {
    const state = { status: 'unknown', reason: 'lock_missing', ttlMs: TTL_UNKNOWN_MS, lockSignature };
    await writeUnifiedCacheSkill(state);
    printNotice(state);
    return;
  }

  const outdated = [];
  const unknownDetails = [];
  let transientError = null;
  let rateLimited = false;

  for (const { entry, lockPath } of entries) {
    const sourceUrl = entry.sourceUrl;
    if (!sourceUrl) {
      unknownDetails.push({ reason: 'no_source_url', lockPath, source: entry.source });
      continue;
    }

    const parsed = parseSourceUrl(sourceUrl);
    if (!parsed) {
      unknownDetails.push({ reason: 'unsupported_host', lockPath, sourceUrl });
      continue;
    }

    const installedAt = entry.updatedAt || entry.installedAt;
    if (!installedAt) {
      unknownDetails.push({ reason: 'no_installed_at', lockPath });
      continue;
    }

    const skillDir = normalizeSkillDir(entry.skillPath);
    const ref = entry.ref || null;

    // A: 当前远端 tree
    const currentTreeResult = await fetchCurrentTree(parsed, ref);
    if (currentTreeResult.error) {
      if (currentTreeResult.error === 'rate_limit') { rateLimited = true; break; }
      transientError = { reason: currentTreeResult.error, sourceUrl, host: parsed.host };
      continue;
    }

    const currentSha = findSkillSha(currentTreeResult.tree, skillDir);
    if (!currentSha) {
      unknownDetails.push({ reason: 'path_missing', lockPath, sourceUrl, skillPath: entry.skillPath });
      continue;
    }

    // B: 反查装时刻的 commit → tree
    const installCommit = await fetchCommitAtTime(parsed, ref, skillDir, installedAt);
    if (installCommit.error) {
      if (installCommit.error === 'rate_limit') { rateLimited = true; break; }
      unknownDetails.push({ reason: `commit_lookup_${installCommit.error}`, lockPath, sourceUrl });
      continue;
    }

    const installedTreeResult = await fetchTreeBySha(parsed, installCommit.sha);
    if (installedTreeResult.error) {
      if (installedTreeResult.error === 'rate_limit') { rateLimited = true; break; }
      transientError = { reason: installedTreeResult.error, sourceUrl, host: parsed.host };
      continue;
    }

    const installedSha = findSkillSha(installedTreeResult.tree, skillDir);
    if (!installedSha) {
      unknownDetails.push({ reason: 'path_missing_at_install', lockPath, sourceUrl });
      continue;
    }

    if (currentSha === installedSha) continue;

    outdated.push({
      name: SKILL_NAME,
      current: shortHash(installedSha),
      latest: shortHash(currentSha),
      sourceUrl,
      host: parsed.host,
      installedHash: entry.skillFolderHash || entry.computedHash || null,
    });
  }

  // ───── 聚合 ─────

  if (rateLimited) {
    const state = { status: 'transient_error', reason: 'rate_limit', ttlMs: TTL_RATE_LIMIT_MS, lockSignature };
    await writeUnifiedCacheSkill(state);
    printNotice(state);
    return;
  }

  if (outdated.length > 0) {
    const state = { status: 'update_available', outdated, ttlMs: TTL_AVAILABLE_MS, lockSignature };
    await writeUnifiedCacheSkill(state);
    printNotice(state);
    return;
  }

  const totalHandled = unknownDetails.length + (transientError ? 1 : 0);
  if (totalHandled < entries.length) {
    await writeUnifiedCacheSkill({ status: 'up_to_date', ttlMs: TTL_UP_TO_DATE_MS, lockSignature });
    return;
  }

  if (transientError) {
    const state = {
      status: 'transient_error',
      reason: transientError.reason,
      sourceUrl: transientError.sourceUrl,
      ttlMs: TTL_TRANSIENT_MS,
      lockSignature,
    };
    await writeUnifiedCacheSkill(state);
    printNotice(state);
    return;
  }

  const state = {
    status: 'unknown',
    reason: unknownDetails[0].reason,
    details: unknownDetails,
    ttlMs: TTL_UNKNOWN_MS,
    lockSignature,
  };
  await writeUnifiedCacheSkill(state);
  printNotice(state);
}

main().catch(() => {});
