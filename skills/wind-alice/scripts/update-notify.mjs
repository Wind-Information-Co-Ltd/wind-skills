// 探针接线: spawn update-check.mjs(detached) → 完成后读 cache 通过 stderr 一次性通知。
// 行为对齐 wind-mcp-skill/scripts/cli.mjs 的 maybeNotifyFailureOnce + maybeNotifyUpdateOnce:
//   - per-skill + per-session sentinel: ~/.cache/wind-aifinmarket/{failure,update}-shown-<skill>-<sid>
//   - sentinel mtime ≤ 24h: 本会话已展示, 静默; > 24h: 视为过期, 重新允许
//   - cleanup 阈值 1d (与 fresh 阈值对齐); 跨 skill 互清也只清过期的
//   - 升级命令按 outdated.scope 决定 -g (global 加, project 不加)
// 兼容旧 export `maybePrintUpdateNotice`: 内部转调 failure + update + cleanup 三步。

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, statSync,
  unlinkSync, readdirSync, closeSync, openSync, utimesSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILL_NAME = basename(SKILL_DIR);
const UPDATE_CHECK_PATH = join(SKILL_DIR, "scripts", "update-check.mjs");
const CACHE_DIR = join(homedir(), ".cache", "wind-aifinmarket");
const UPDATE_STATE_FILE = join(CACHE_DIR, "update-state.json");

// ───── sentinel + sessionId 常量 ─────
const FAILURE_SENTINEL_PREFIX = "failure-shown-";
const UPDATE_SENTINEL_PREFIX = "update-shown-";
const SENTINEL_PREFIXES = [FAILURE_SENTINEL_PREFIX, UPDATE_SENTINEL_PREFIX];
const SENTINEL_FRESH_MS = 6 * 60 * 60 * 1000;
const SENTINEL_CLEANUP_MS = 6 * 60 * 60 * 1000;

const SHELL_NAMES = new Set([
  "bash", "sh", "zsh", "dash", "fish", "csh", "ksh", "tcsh",
  "xonsh", "nu", "nushell", "ion", "elvish", "oksh", "mksh", "yash", "rc", "es",
  "cmd.exe", "powershell.exe", "pwsh.exe",
  "bash.exe", "sh.exe", "zsh.exe", "dash.exe", "fish.exe", "tcsh.exe", "ksh.exe",
  "wsl.exe", "wslhost.exe",
  "conhost.exe", "mintty.exe", "msys-1.0.dll", "cygwin1.dll",
]);
const SESSION_CACHE_FILE = join(CACHE_DIR, "session.id");
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;

// ───── sessionId: walk 进程树跳 shell, 找首个非 shell 祖先 ─────
function tryProcWalk() {
  try {
    let pid = process.ppid;
    let hops = 0;
    while (pid && pid > 1 && hops < 10) {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const commEnd = stat.lastIndexOf(")");
      const name = stat.slice(stat.indexOf("(") + 1, commEnd);
      const after = stat.slice(commEnd + 2).split(" ");
      const parentPid = parseInt(after[1], 10);
      const starttime = after[19];
      if (!SHELL_NAMES.has(name.toLowerCase())) return `${pid}-${starttime}`;
      pid = parentPid;
      hops++;
    }
  } catch {}
  return null;
}

function tryMacWalk() {
  try {
    let pid = process.ppid;
    let hops = 0;
    while (pid && pid > 1 && hops < 10) {
      const out = execFileSync("ps", ["-p", String(pid), "-o", "ppid=,lstart=,comm="], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
      }).trim();
      if (!out) break;
      const parts = out.split(/\s+/);
      if (parts.length < 7) break;
      const parentPid = parseInt(parts[0], 10);
      const lstart = parts.slice(1, 6).join(" ");
      const comm = parts.slice(6).join(" ");
      const name = (comm.split("/").pop() || "").toLowerCase();
      if (!SHELL_NAMES.has(name)) {
        const cleanStart = lstart.replace(/[^a-zA-Z0-9]/g, "");
        return `${pid}-${cleanStart}`;
      }
      pid = parentPid;
      hops++;
    }
  } catch {}
  return null;
}

function tryWindowsWalk() {
  try {
    const ps = [
      "$shells = @('cmd.exe','powershell.exe','pwsh.exe','bash.exe','sh.exe','zsh.exe','dash.exe','fish.exe','tcsh.exe','ksh.exe','wsl.exe','wslhost.exe','conhost.exe','mintty.exe')",
      `$cur = ${process.ppid}`,
      "$hops = 0",
      "while ($cur -gt 4 -and $hops -lt 10) {",
      "  try { $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$cur\" } catch { break }",
      "  if (!$p) { break }",
      "  $name = $p.Name.ToLower()",
      "  if (-not ($shells -contains $name)) {",
      "    $ct = if ($p.CreationDate) { $p.CreationDate.Ticks } else { 0 }",
      "    Write-Output (\"MATCH:\" + $cur + \":\" + $ct)",
      "    exit 0",
      "  }",
      "  $cur = [int]$p.ParentProcessId",
      "  $hops++",
      "}",
      "Write-Output 'NONE'",
    ].join("; ");
    const encoded = Buffer.from(ps, "utf16le").toString("base64");
    const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000,
    }).trim();
    const m = out.match(/MATCH:(\d+):(\d+)/);
    if (m) return `${m[1]}-${m[2]}`;
  } catch {}
  return null;
}

function readSessionCache() {
  try {
    if (!existsSync(SESSION_CACHE_FILE)) return null;
    const st = statSync(SESSION_CACHE_FILE);
    if (Date.now() - st.mtimeMs > SESSION_CACHE_TTL_MS) return null;
    const content = readFileSync(SESSION_CACHE_FILE, "utf8").trim();
    return content || null;
  } catch { return null; }
}

function writeSessionCache(sid) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(SESSION_CACHE_FILE, sid);
  } catch {}
}

let _sessionIdMemo = null;
export function getSessionId() {
  if (_sessionIdMemo) return _sessionIdMemo;
  // env 注入: 给嵌套子进程 / 测试场景显式锁定 sid (生产主进程不会有此 env)
  if (process.env.WIND_SKILLS_SESSION_ID) {
    _sessionIdMemo = process.env.WIND_SKILLS_SESSION_ID;
    return _sessionIdMemo;
  }
  const cached = readSessionCache();
  if (cached) { _sessionIdMemo = cached; return cached; }
  let sid = tryProcWalk();
  if (!sid) {
    if (process.platform === "darwin") sid = tryMacWalk();
    else if (process.platform === "win32") sid = tryWindowsWalk();
  }
  if (!sid) sid = String(process.ppid);
  _sessionIdMemo = sid;
  writeSessionCache(sid);
  return sid;
}

// ───── sentinel 操作 ─────
export function failureSentinelPath(sid = getSessionId()) {
  return join(CACHE_DIR, `${FAILURE_SENTINEL_PREFIX}${SKILL_NAME}-${sid}`);
}
export function updateSentinelPath(sid = getSessionId()) {
  return join(CACHE_DIR, `${UPDATE_SENTINEL_PREFIX}${SKILL_NAME}-${sid}`);
}

export function cleanupStaleSentinels() {
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

function sentinelFresh(sentinelPath) {
  if (!existsSync(sentinelPath)) return false;
  try {
    const st = statSync(sentinelPath);
    return Date.now() - st.mtimeMs <= SENTINEL_FRESH_MS;
  } catch { return false; }
}

function touchSentinel(sentinelPath) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    const fd = openSync(sentinelPath, "a");
    closeSync(fd);
    const now = new Date();
    utimesSync(sentinelPath, now, now);
  } catch {}
}

// ───── spawn 探针 ─────
export function spawnUpdateCheck() {
  try {
    if (!existsSync(UPDATE_CHECK_PATH)) return;
    // WIND_SKILLS_UPDATE_CHECK_DETACHED: 通知子进程 stderr 被 ignore, 走 sentinel 中转
    // WIND_SKILLS_SESSION_ID: 主进程 sid 显式传给子进程, sentinel 命中
    const child = spawn("node", [UPDATE_CHECK_PATH], {
      cwd: SKILL_DIR, detached: true, stdio: "ignore", windowsHide: true,
      env: {
        ...process.env,
        WIND_SKILLS_UPDATE_CHECK_DETACHED: "1",
        WIND_SKILLS_SESSION_ID: getSessionId(),
      },
    });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

// ───── lock scope + 已升级过滤 ─────
function globalLockPaths() {
  const xdg = process.env.XDG_STATE_HOME;
  return [
    xdg ? join(xdg, "skills", ".skill-lock.json") : null,
    join(homedir(), ".agents", ".skill-lock.json"),
  ].filter(Boolean);
}

function classifyLockScope(lockPath) {
  return globalLockPaths().includes(lockPath) ? "global" : "project";
}

function getInstalledHashes() {
  const result = {};
  const candidates = new Set();
  for (const p of globalLockPaths()) candidates.add(p);
  for (const start of [SKILL_DIR, process.cwd()]) {
    let dir = resolve(start);
    while (true) {
      candidates.add(join(dir, "skills-lock.json"));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const lockPath of candidates) {
    if (!existsSync(lockPath)) continue;
    const scope = classifyLockScope(lockPath);
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      for (const [name, entry] of Object.entries(lock?.skills || {})) {
        const hash = entry?.skillFolderHash || entry?.computedHash;
        if (!hash) continue;
        if (!result[name]) result[name] = {};
        if (!result[name][scope]) result[name][scope] = hash;
      }
    } catch {}
  }
  return result;
}

function filterAlreadyUpgraded(outdated) {
  const installed = getInstalledHashes();
  return outdated.filter(o => {
    const scopeMap = installed[o.name];
    if (!scopeMap) return true;
    const liveHash = o.scope ? scopeMap[o.scope] : (scopeMap.global || scopeMap.project);
    if (!liveHash) return true;
    if (o.installedHash) return liveHash === o.installedHash;
    const cur = o.current || "";
    if (!cur) return true;
    return liveHash.startsWith(cur);
  });
}

// ───── cache view ─────
function readCacheView() {
  if (!existsSync(UPDATE_STATE_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(UPDATE_STATE_FILE, "utf8"));
    if (raw?.schemaVersion === 3 && raw?.skills && typeof raw.skills === "object") {
      return { raw, state: raw.skills[SKILL_NAME] || null, isV3: true };
    }
    return { raw, state: raw, isV3: false };
  } catch { return null; }
}

function writeCacheView(view, newState) {
  try {
    if (view.isV3) {
      view.raw.skills[SKILL_NAME] = newState;
      writeFileSync(UPDATE_STATE_FILE, JSON.stringify(view.raw, null, 2));
    } else {
      writeFileSync(UPDATE_STATE_FILE, JSON.stringify(newState, null, 2));
    }
  } catch {}
}

function collectUpdateNotice() {
  try {
    const view = readCacheView();
    if (!view || !view.state) return null;
    let state = view.state;

    if (!view.isV3 && state.status === "update_available" && Array.isArray(state.outdated)) {
      const filtered = state.outdated.filter(o => o?.name === SKILL_NAME);
      if (filtered.length < state.outdated.length) {
        state = filtered.length === 0
          ? { ...state, status: "up_to_date", outdated: [] }
          : { ...state, outdated: filtered };
      }
    }

    if (state.status === "update_available" && Array.isArray(state.outdated) && state.outdated.length > 0) {
      const stillOutdated = filterAlreadyUpgraded(state.outdated);
      if (stillOutdated.length === 0) {
        state = { status: "up_to_date", ttlMs: 60 * 60 * 1000, lastCheck: new Date().toISOString() };
        if (view.state.snoozedUntil) state.snoozedUntil = view.state.snoozedUntil;
        if (typeof view.state.snoozeLevel === "number") state.snoozeLevel = view.state.snoozeLevel;
        writeCacheView(view, state);
      } else if (stillOutdated.length < state.outdated.length) {
        state = { ...state, outdated: stillOutdated };
        writeCacheView(view, state);
      }
    }

    if (state.snoozedUntil && new Date(state.snoozedUntil) > new Date()) return null;
    if (state.status !== "update_available") return null;

    return {
      items: state.outdated.map(o => {
        const scope = o.scope || "global";
        const scopeFlag = scope === "global" ? " -g" : "";
        const isGitee = typeof o.sourceUrl === "string" && o.sourceUrl.includes("gitee.com");
        const upgrade_command = isGitee
          ? `npx skills add ${o.sourceUrl} --skill ${o.name}${scopeFlag} -y  # Gitee 源不支持 update,需重装`
          : `npx skills update ${o.name}${scopeFlag} -y`;
        return {
          name: o.name,
          current: o.current || null,
          latest: o.latest || null,
          upgrade_command,
        };
      }),
    };
  } catch { return null; }
}

// ───── 一次性 stderr 通知 ─────
export function maybeNotifyFailureOnce() {
  try {
    const view = readCacheView();
    if (!view || !view.state) return;
    const state = view.state;
    if (state.status !== "transient_error" && state.status !== "unknown") return;
    if (state.snoozedUntil && new Date(state.snoozedUntil) > new Date()) return;
    const sentinel = failureSentinelPath();
    if (sentinelFresh(sentinel)) return;
    const reason = state.reason || "unknown";
    process.stderr.write(`[wind-skills] 更新检测失败 (reason=${reason}), 不影响本次调用。\n`);
    touchSentinel(sentinel);
  } catch {}
}

export function maybeNotifyUpdateOnce() {
  try {
    const notice = collectUpdateNotice();
    if (!notice || !Array.isArray(notice.items) || notice.items.length === 0) return;
    const sentinel = updateSentinelPath();
    if (sentinelFresh(sentinel)) return;
    const lines = ["[wind-skills] 检测到新版可用:"];
    for (const item of notice.items) {
      const ver = item.current && item.latest ? `${item.current} → ${item.latest}` : (item.latest || "?");
      lines.push(`  ${item.name}: ${ver}`);
      lines.push(`  升级命令: ${item.upgrade_command}`);
    }
    process.stderr.write(lines.join("\n") + "\n");
    touchSentinel(sentinel);
  } catch {}
}

// 兼容 wind-alice/scripts/request.js 的旧 import 名:
// 把 failure / update / cleanup 三步合在一个入口。
export function maybePrintUpdateNotice() {
  cleanupStaleSentinels();
  maybeNotifyFailureOnce();
  maybeNotifyUpdateOnce();
}
