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

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, openSync, closeSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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

// sentinel 清理: 与 cli.mjs / update-notify.mjs 同步, 一并清 2 种前缀; 阈值 6h
// (cli.mjs/notify 入口也清, 这里多触发一次保证 find-finance 等无 cli 通路的 skill 也勤清)
const SENTINEL_PREFIXES = ['failure-shown-', 'update-shown-'];
const SENTINEL_CLEANUP_MS = 6 * 60 * 60 * 1000;

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

// baselines 节: 用于 v1 lock 没有 installedAt 时的替代检测
// key 格式: "<lockPath>:<skillName>:<computedHash>", value: { remoteSha }
// 升级 skill 会让 installedHash 变 → key 变 → 旧条目残留。writeBaseline 写新 hash 时
// 顺手清同 (lockPath, skillName) 下不同 hash 的旧 entry, 避免无界累加。
function readBaseline(key) {
  const full = readUnifiedCache();
  return full.baselines?.[key] || null;
}
async function writeBaseline(key, remoteSha) {
  await withLock(() => {
    const full = readUnifiedCache();
    if (!full.baselines || typeof full.baselines !== 'object') full.baselines = {};
    // GC: key 结构 <lockPath>:<skillName>:<hash>; skillName / hash 不含 ':',
    // lockPath 在 Windows 可能含盘符冒号, 所以用 lastIndexOf 切出 hash 前的前缀。
    // 同前缀但不是当前 key 的 → 同 (lockPath, skillName) 但不同 hash → 删。
    const lastColon = key.lastIndexOf(':');
    if (lastColon > 0) {
      const prefix = key.slice(0, lastColon + 1);
      for (const k of Object.keys(full.baselines)) {
        if (k !== key && k.startsWith(prefix)) delete full.baselines[k];
      }
    }
    full.baselines[key] = { remoteSha };
    writeFileSync(CACHE_FILE, JSON.stringify(full, null, 2));
  });
}

function cleanupLegacyFiles() {
  for (const name of LEGACY_CACHE_FILES) {
    const p = join(CACHE_DIR, name);
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }
}

// 清 mtime > SENTINEL_CLEANUP_MS 的旧 sentinel (4 种前缀全扫), 与 cli.mjs/notify 一致
function cleanupStaleSentinels() {
  try {
    if (!existsSync(CACHE_DIR)) return;
    const now = Date.now();
    for (const name of readdirSync(CACHE_DIR)) {
      if (!SENTINEL_PREFIXES.some(p => name.startsWith(p))) continue;
      const p = join(CACHE_DIR, name);
      try {
        const st = statSync(p);
        if (now - st.mtimeMs > SENTINEL_CLEANUP_MS) unlinkSync(p);
      } catch {}
    }
  } catch {}
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

// global lock 候选路径(XDG / ~/.agents); 其它都视为 project lock。
// 用于区分升级命令是否带 -g —— global 装的加 -g, project 装的不加。
function globalLockPaths() {
  const xdg = process.env.XDG_STATE_HOME;
  return [
    xdg ? join(xdg, 'skills', '.skill-lock.json') : null,
    join(homedir(), '.agents', '.skill-lock.json'),
  ].filter(Boolean);
}

function classifyLockScope(lockPath) {
  return globalLockPaths().includes(lockPath) ? 'global' : 'project';
}

function findLockFiles() {
  const candidates = new Set();
  for (const p of globalLockPaths()) candidates.add(p);
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
      if (entry) found.push({ entry, lockPath, scope: classifyLockScope(lockPath) });
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

// 解析 entry 的源 URL 候选。优先级:
//   1. entry.sourceUrl: v3 lock 必有, 直接用 (单候选, 不瞎试)
//   2. entry.source 是完整 http(s) URL: 直接用
//   3. entry.source 是短形式 + entry.sourceType 已知:
//      - sourceType=github → 直接拼 GitHub
//      - sourceType=git/gitee → 直接拼 Gitee
//   4. 短形式但缺 sourceType (极旧 v1 lock): 启发式两候选兜底
function deriveSourceUrlCandidates(entry) {
  if (entry?.sourceUrl) return [entry.sourceUrl];
  if (typeof entry?.source !== 'string' || !entry.source) return [];
  if (/^https?:\/\//.test(entry.source)) return [entry.source];

  const t = entry.sourceType;
  if (t === 'github') return [`https://github.com/${entry.source}.git`];
  if (t === 'git' || t === 'gitee') return [`https://gitee.com/${entry.source}.git`];

  // 兜底: sourceType 完全缺失, 两候选都试
  return [
    `https://github.com/${entry.source}.git`,
    `https://gitee.com/${entry.source}.git`,
  ];
}

function normalizeSkillDir(skillPath) {
  return String(skillPath || '')
    .replace(/\\/g, '/')
    .replace(/\/?SKILL\.md$/i, '')
    .replace(/\/+$/, '');
}

// ───── 代理 ─────

// 代理来源 (按可靠度排序):
//   1. process.env (主路径; 沙箱剥 env 时为空)
//   2. git config http.proxy / https.proxy (持久化兜底, 企业网用户常配)
// 不读 cli.mjs 写的 hint 文件 - 主进程也可能被剥 env, 那 hint 也是空的, 不如不依赖。
// 同进程内缓存 git config 结果, 避免每次 fetchJson 都 spawn 一次 git。
let _gitProxyMemo;
function loadGitProxy() {
  if (_gitProxyMemo !== undefined) return _gitProxyMemo;
  try {
    const httpsR = spawnSync('git', ['config', '--get', 'https.proxy'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, windowsHide: true });
    const httpR = spawnSync('git', ['config', '--get', 'http.proxy'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, windowsHide: true });
    const https = httpsR.error ? '' : (httpsR.stdout || '').trim();
    const http = httpR.error ? '' : (httpR.stdout || '').trim();
    if (!https && !http) { _gitProxyMemo = null; return null; }
    _gitProxyMemo = { HTTPS_PROXY: https || http, HTTP_PROXY: http || https };
    return _gitProxyMemo;
  } catch { _gitProxyMemo = null; return null; }
}

// 按 curl/requests 惯例: HTTPS_PROXY/https_proxy/HTTP_PROXY/http_proxy/ALL_PROXY/all_proxy
// HTTPS 目标优先 HTTPS_PROXY, HTTP 目标只看 HTTP_PROXY+。NO_PROXY 后缀匹配 (大小写不敏感),
// '*' 全跳过, '.foo.com' 与 'foo.com' 等价 (匹配自身 + 子域)。
// env 全空时回落 git config。
function getProxyForUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const env = process.env;
  const isHttps = u.protocol === 'https:';
  const candidates = isHttps
    ? [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy]
    : [env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy];
  let proxy = candidates.find(v => typeof v === 'string' && v.trim().length > 0);
  if (!proxy) {
    const git = loadGitProxy();
    if (git) proxy = isHttps ? git.HTTPS_PROXY : git.HTTP_PROXY;
  }
  if (!proxy) return null;
  const noProxy = env.NO_PROXY || env.no_proxy;
  if (noProxy) {
    const host = u.hostname.toLowerCase();
    for (const raw of noProxy.split(',')) {
      const e = raw.trim().toLowerCase();
      if (!e) continue;
      if (e === '*') return null;
      const norm = e.replace(/^\./, '');
      if (host === norm || host.endsWith('.' + norm)) return null;
    }
  }
  return proxy.trim();
}

// curl 子进程的 env: 本进程 env 缺代理时, 从 git config 补, 让 curl 能拿到
function buildCurlEnv() {
  const merged = { ...process.env };
  const env = process.env;
  const hasEnvProxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
                      || env.ALL_PROXY || env.all_proxy;
  if (hasEnvProxy) return merged;
  const git = loadGitProxy();
  if (!git) return merged;
  if (git.HTTPS_PROXY) merged.HTTPS_PROXY = git.HTTPS_PROXY;
  if (git.HTTP_PROXY) merged.HTTP_PROXY = git.HTTP_PROXY;
  return merged;
}

// ───── HTTP ─────

// curl 优先: Linux / macOS / Windows10+ (build 17063+) 自带, 自动读 HTTPS_PROXY /
// HTTP_PROXY / NO_PROXY env (本进程 env 缺时 buildCurlEnv 从 git config 兜底)。
// 默认 -k 跳过 TLS 证书验证: update-check 只 GET 公开 JSON 不传凭证, 接受 MITM 网关换签场景。
//
// 静默降级: 走代理 network 失败 → curl --noproxy '*' 静默重试; 直连成功就用直连结果,
// 不给用户加任何"代理失败"提示 (wind-skills stderr 只出"是否有新版"这一条)。
// curl 不在 PATH → 降级 Node fetch (无代理), 静默。
async function fetchJson(url) {
  const curlResult = fetchJsonViaCurl(url, { noProxy: false });
  if (curlResult.code !== 'curl_missing') {
    if (curlResult.error === 'network' && getProxyForUrl(url)) {
      const direct = fetchJsonViaCurl(url, { noProxy: true });
      if (direct.error !== 'network' && direct.code !== 'curl_missing') return direct;
    }
    return curlResult;
  }

  // curl 不在 PATH: Node fetch (不走代理, 静默)
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

// curl 子进程: 同步 spawnSync (update-check 一次性脚本, 阻塞无副作用)
// -k 默认开: update-check 只 GET 公开 JSON 不带 Authorization, MITM 投毒最多让用户漏报新版,
//   不会让其执行恶意代码 → 跳过 TLS 验证以兼容公司 MITM 代理换签场景。
// -w 把 HTTP 状态码追加到 stdout 末尾, 用 marker 切分 body / status。
// noProxy: 走 --noproxy '*' (降级直连重试用)。curl 不在 PATH → { code: 'curl_missing' }。
function fetchJsonViaCurl(url, { noProxy = false } = {}) {
  const MARKER = '\n__HTTP_CODE__';
  try {
    const args = [
      '-sS', '-k',
      '--max-time', String(Math.ceil(NETWORK_TIMEOUT_MS / 1000)),
      '-A', `${SKILL_NAME}-update-check`,
      '-H', 'Accept: application/json',
      '-w', `${MARKER}%{http_code}`,
    ];
    if (noProxy) args.push('--noproxy', '*');
    args.push(url);
    // env 注入: 本进程 env 可能被沙箱剥了, buildCurlEnv 从 git config 补
    const result = spawnSync('curl', args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: buildCurlEnv(),
    });

    if (result.error && result.error.code === 'ENOENT') return { code: 'curl_missing' };
    if (result.error) return { error: 'network' };

    const out = result.stdout || '';
    const idx = out.lastIndexOf(MARKER);
    if (idx < 0) return { error: 'network' };  // curl 连接前异常退出 (DNS/拨号)
    const body = out.slice(0, idx);
    const code = Number(out.slice(idx + MARKER.length).trim());
    if (!code) return { error: 'network' };
    // 403/429 一律视为 rate_limit (curl 没传 -D 抓 header, 牺牲 x-ratelimit-remaining 精度)
    if (code === 403 || code === 429) return { error: 'rate_limit' };
    if (code < 200 || code >= 300) return { error: `http_${code}` };
    try { return { data: JSON.parse(body) }; }
    catch { return { error: 'shape' }; }
  } catch {
    return { error: 'network' };
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

// 升级命令拼装。两条规则:
//   1. scope=global → 加 -g; scope=project → 不加 (项目级安装升级到全局是错的)
//   2. Gitee 源不支持 update, 退回 add 重装; GitHub 用 update
// outdated 缺 scope (旧缓存或测试 seed 数据) 时 fallback 'global' 保持兼容。
export function buildUpgradeCommand(o) {
  const scope = o.scope || 'global';
  const scopeFlag = scope === 'global' ? ' -g' : '';
  const isGitee = typeof o.sourceUrl === 'string' && o.sourceUrl.includes('gitee.com');
  return isGitee
    ? `npx skills add ${o.sourceUrl} --skill ${o.name}${scopeFlag} -y  # Gitee 源不支持 update,需重装`
    : `npx skills update ${o.name}${scopeFlag} -y`;
}

function printNotice(state) {
  if (state.snoozedUntil && new Date(state.snoozedUntil) > new Date()) return;

  if (state.status === 'update_available') {
    const lines = ['', `[wind-skills] 检测到 ${state.outdated.length} 个 skill 有新版:`];
    for (const o of state.outdated) {
      lines.push(`  • ${o.name.padEnd(34)} ${o.current || '?'} → ${o.latest}`);
      lines.push(`    升级: ${buildUpgradeCommand(o)}`);
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
  cleanupStaleSentinels();

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

  for (const { entry, lockPath, scope } of entries) {
    // 1) 解析候选 sourceUrl: v3 lock 有 sourceUrl 直接用; v1 lock 缺 sourceUrl 时
    //    从 source 短形式启发式生成 GitHub/Gitee 两个候选, 试到能拉 tree 的那个为准
    const urlCandidates = deriveSourceUrlCandidates(entry);
    if (urlCandidates.length === 0) {
      unknownDetails.push({ reason: 'no_source_url' });
      continue;
    }

    const skillDir = normalizeSkillDir(entry.skillPath);
    const ref = entry.ref || null;

    let parsed = null;
    let sourceUrl = null;
    let currentTree = null;
    let lastError = null;
    for (const candidateUrl of urlCandidates) {
      const p = parseSourceUrl(candidateUrl);
      if (!p) continue;
      const r = await fetchCurrentTree(p, ref);
      if (r.tree) {
        parsed = p;
        sourceUrl = candidateUrl;
        currentTree = r.tree;
        break;
      }
      lastError = r.error;
      if (r.error === 'rate_limit') { rateLimited = true; break; }
    }
    if (rateLimited) break;
    if (!parsed || !currentTree) {
      if (lastError) {
        transientError = { reason: lastError };
      } else {
        unknownDetails.push({ reason: 'unsupported_host' });
      }
      continue;
    }

    const currentSha = findSkillSha(currentTree, skillDir);
    if (!currentSha) {
      unknownDetails.push({ reason: 'path_missing' });
      continue;
    }

    const installedAt = entry.updatedAt || entry.installedAt;

    if (installedAt) {
      // v3 path: 走原 installedAt-反查策略 (精确, 能捕获"装老版本")
      const installCommit = await fetchCommitAtTime(parsed, ref, skillDir, installedAt);
      if (installCommit.error) {
        if (installCommit.error === 'rate_limit') { rateLimited = true; break; }
        unknownDetails.push({ reason: `commit_lookup_${installCommit.error}` });
        continue;
      }
      const installedTreeResult = await fetchTreeBySha(parsed, installCommit.sha);
      if (installedTreeResult.error) {
        if (installedTreeResult.error === 'rate_limit') { rateLimited = true; break; }
        transientError = { reason: installedTreeResult.error };
        continue;
      }
      const installedSha = findSkillSha(installedTreeResult.tree, skillDir);
      if (!installedSha) {
        unknownDetails.push({ reason: 'path_missing_at_install' });
        continue;
      }
      if (currentSha === installedSha) continue;
      outdated.push({
        name: SKILL_NAME,
        current: shortHash(installedSha),
        latest: shortHash(currentSha),
        sourceUrl,
        installedHash: entry.skillFolderHash || entry.computedHash || null,
        scope,
      });
    } else {
      // v1 path: 没有 installedAt, 用 baseline 策略
      // 首次见到这条 entry → 把 currentSha 存为 baseline, 报 up_to_date(静默捕获)
      // 后续 → 比较新 currentSha 与 baseline.remoteSha, 不等就报 update_available
      const installedHash = entry.skillFolderHash || entry.computedHash || '';
      const baselineKey = `${lockPath}:${SKILL_NAME}:${installedHash}`;
      const baseline = readBaseline(baselineKey);
      if (!baseline) {
        // 首次捕获: 静默存 baseline, 报 up_to_date (此 entry 视为最新)
        await writeBaseline(baselineKey, currentSha);
        continue;
      }
      if (baseline.remoteSha === currentSha) continue;  // 远端未变, up_to_date
      // 远端动了 → update_available
      outdated.push({
        name: SKILL_NAME,
        current: shortHash(baseline.remoteSha),
        latest: shortHash(currentSha),
        sourceUrl,
        installedHash,
        scope,
      });
    }
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
    ttlMs: TTL_UNKNOWN_MS,
    lockSignature,
  };
  await writeUnifiedCacheSkill(state);
  printNotice(state);
}

main().catch(() => {});
