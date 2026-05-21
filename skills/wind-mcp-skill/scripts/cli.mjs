#!/usr/bin/env node
 // wind-mcp-skill CLI: thin JSON-envelope wrapper around Wind MCP servers.
// Keep this file self-contained for skill portability; heavier reference material lives in SKILL.md/references.
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  readdirSync,
  closeSync,
  openSync,
  utimesSync,
} from 'node:fs';
import {
  homedir
} from 'node:os';
import {
  join,
  dirname,
  resolve
} from 'node:path';
import {
  fileURLToPath,
  pathToFileURL,
} from 'node:url';
import {
  spawn,
  execFileSync,
} from 'node:child_process';

const SKILL_VERSION = '1.6.1';
const OUTPUT_SCHEMA_VERSION = 1;
let activeCommand = 'help';

// Server registry is intentionally local data so tool selection can fail before any network call.
const SERVERS = {
  stock_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_stock_data/mcp/',
    label: 'Wind A 股股票（档案/财务/股本/事件/技术/风险 + 行情/K线/分钟）',
  },
  global_stock_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_global_stock_data/mcp/',
    label: 'Wind 全球股票/港股美股（档案/财务/股本/事件/技术/风险 + 行情/K线/分钟）',
  },
  fund_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_fund_data/mcp/',
    label: 'Wind 基金（档案/财务/持仓/业绩/持有人/公司 + 行情/K线/分钟）',
  },
  index_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_index_data/mcp/',
    label: 'Wind 指数/板块（档案/基本面/技术 + 行情/K线/分钟）',
  },
  bond_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_bond_data/mcp/',
    label: 'Wind 债券（基本档案/发债主体/行情估值/主体财务）',
  },
  financial_docs: {
    endpoint: 'https://mcp.wind.com.cn/vserver_financial_docs/mcp/',
    label: 'Wind 金融文档 RAG（公告 / 新闻）',
  },
  economic_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_economic_data/mcp/',
    label: 'Wind EDB 宏观/行业经济指标',
  },
  analytics_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_analytics_data/mcp/',
    label: 'Wind 通用分析数据（NL → Wind 数据）',
  },
};

const PORTAL_URL = 'https://aifinmarket.wind.com.cn/#/user/overview';

const SKILL_DIR = dirname(dirname(fileURLToPath(
  import.meta.url)));

const UPDATE_CHECK_PATH = join(SKILL_DIR, 'scripts', 'update-check.mjs');
const CACHE_DIR = join(homedir(), '.cache', 'wind-aifinmarket');
const UPDATE_STATE_FILE = join(CACHE_DIR, 'update-state.json');
const TOOL_MANIFEST_PATH = join(SKILL_DIR, 'references', 'tool-manifest.json');
const SKILL_NAME = 'wind-mcp-skill';

// 失败 / 更新通知 sentinel: ~/.cache/wind-aifinmarket/{failure,update}-shown-<skill>-<sid>
// per-skill 隔离: 文件名带 SKILL_NAME, 多 skill 共享 CACHE_DIR 时各自独立 dedup
// 两个独立 sentinel,语义完全平行:
//   mtime ≤ 24h: 视为"本会话已展示" → 静默
//   mtime > 24h: 视为过期(同 sid 重用风险) → 重新允许展示
// 启动时清理 mtime > 1d 的 sentinel 文件防累积 (与 fresh 阈值对齐, 过期即清)
// cleanup 用 prefix 匹配,跨 skill 互清也只清过期的,无副作用
const FAILURE_SENTINEL_PREFIX = 'failure-shown-';
const UPDATE_SENTINEL_PREFIX = 'update-shown-';
const SENTINEL_PREFIXES = [FAILURE_SENTINEL_PREFIX, UPDATE_SENTINEL_PREFIX];
const SENTINEL_FRESH_MS = 6 * 60 * 60 * 1000;
const SENTINEL_CLEANUP_MS = 6 * 60 * 60 * 1000;

const CALL_EXAMPLES = [
  `cli.mjs call stock_data get_stock_basicinfo '{"question":"600519.SH公司基本档案"}'`,
  `cli.mjs call stock_data get_stock_price_indicators '{"windcode":"600519.SH","indexes":"中文简称,最新成交价,涨跌幅"}'`,
  `cli.mjs call fund_data get_fund_kline '{"windcode":"588200.SH","begin_date":"20260401","end_date":"20260430"}'`,
  `cli.mjs call global_stock_data get_global_stock_quote '{"windcode":"AAPL.O"}'`,
  `cli.mjs call index_data get_index_kline '{"windcode":"000300.SH","begin_date":"20260401","end_date":"20260430"}'`,
  `cli.mjs call financial_docs get_financial_news '{"query":"美联储利率政策","top_k":3}'`,
  `cli.mjs call economic_data get_economic_data '{"metricIdsStr":"中国GDP"}'`,
  `cli.mjs call analytics_data get_financial_data '{"question":"查询中国A股市场过去一年的平均成交量"}'`,
];

function spawnUpdateCheck() {
  try {
    if (!existsSync(UPDATE_CHECK_PATH)) return;
    // WIND_SKILLS_UPDATE_CHECK_DETACHED: 通知子进程 stderr 被 ignore, 走 sentinel 中转
    // WIND_SKILLS_SESSION_ID: 主进程算出的 sid 显式传给子进程, sentinel 命中
    const child = spawn('node', [UPDATE_CHECK_PATH], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        WIND_SKILLS_UPDATE_CHECK_DETACHED: '1',
        WIND_SKILLS_SESSION_ID: getSessionId(),
      },
    });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

// global lock 路径(XDG / ~/.agents); 其余视为 project lock。
// 与 update-check.mjs 中同名函数语义对齐, 用于按 scope 区分 -g 升级命令。
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

// 按 scope 隔离的 live hash. 返回 { [name]: { global?: hash, project?: hash } }.
// global 升了 / project 没升 这种半升级状态, filter 必须按 scope 匹配才能正确保留 project 那条。
function getInstalledHashes() {
  const result = {};
  const candidates = new Set();
  for (const p of globalLockPaths()) candidates.add(p);
  for (const start of [SKILL_DIR, process.cwd()]) {
    let dir = resolve(start);
    while (true) {
      candidates.add(join(dir, 'skills-lock.json'));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const lockPath of candidates) {
    if (!existsSync(lockPath)) continue;
    const scope = classifyLockScope(lockPath);
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
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
    if (!scopeMap) return true; // 找不到任何 lock,保守保留
    // outdated 缺 scope (旧缓存) → 跨 scope 取首个可用 hash, 维持原行为
    const liveHash = o.scope
      ? scopeMap[o.scope]
      : (scopeMap.global || scopeMap.project);
    if (!liveHash) return true; // 该 scope 下没装(异常),保守保留
    if (o.installedHash) return liveHash === o.installedHash;
    // 兼容旧缓存条目：退化到 shortHash 前缀匹配
    const cur = o.current || '';
    if (!cur) return true;
    return liveHash.startsWith(cur);
  });
}

// Cache schema 兼容: v3 unified ({schemaVersion, skills:{<name>:{...}}}) vs legacy 顶层平铺
function readCacheView() {
  if (!existsSync(UPDATE_STATE_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(UPDATE_STATE_FILE, 'utf8'));
    if (raw?.schemaVersion === 3 && raw?.skills && typeof raw.skills === 'object') {
      return {
        raw,
        state: raw.skills[SKILL_NAME] || null,
        isV3: true
      };
    }
    return {
      raw,
      state: raw,
      isV3: false
    };
  } catch {
    return null;
  }
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

export function collectUpdateNotices() {
  try {
    const view = readCacheView();
    if (!view || !view.state) return [];
    let state = view.state;

    // 防御:legacy v2 顶层 schema(其他 skill 如 wind-alice 仍用)可能含他人 outdated,
    // 严格只透传 name===SKILL_NAME 的条目,杜绝跨 skill 通知泄露。v3 path 走
    // skills[SKILL_NAME] 取节点本就不会含他人,这里主要保护 legacy 兼容路径。
    if (state.status === 'update_available' && Array.isArray(state.outdated)) {
      const filtered = state.outdated.filter(o => o?.name === SKILL_NAME);
      if (filtered.length < state.outdated.length) {
        state = filtered.length === 0 ?
          {
            ...state,
            status: 'up_to_date',
            outdated: []
          } :
          {
            ...state,
            outdated: filtered
          };
      }
    }

    // 先修正已升级但缓存仍提示过期的状态，再决定是否返回 notice。
    if (state.status === 'update_available' && Array.isArray(state.outdated) && state.outdated.length > 0) {
      const stillOutdated = filterAlreadyUpgraded(state.outdated);
      if (stillOutdated.length === 0) {
        state = {
          status: 'up_to_date',
          ttlMs: 60 * 60 * 1000,
          lastCheck: new Date().toISOString(),
        };
        if (view.state.snoozedUntil) state.snoozedUntil = view.state.snoozedUntil;
        if (typeof view.state.snoozeLevel === 'number') state.snoozeLevel = view.state.snoozeLevel;
        writeCacheView(view, state);
      } else if (stillOutdated.length < state.outdated.length) {
        state = {
          ...state,
          outdated: stillOutdated
        };
        writeCacheView(view, state);
      }
    }

    if (state.snoozedUntil && new Date(state.snoozedUntil) > new Date()) return [];

    if (state.status === 'update_available') {
      return [{
        type: 'update_available',
        severity: 'info',
        message: `检测到 ${state.outdated.length} 个 skill 有新版`,
        items: state.outdated.map((o) => {
          // scope 决定是否带 -g: global 加, project 不加。
          // outdated 缺 scope (旧缓存或测试 seed) 时回退 'global' 保兼容。
          const scope = o.scope || 'global';
          const scopeFlag = scope === 'global' ? ' -g' : '';
          const isGitee = typeof o.sourceUrl === 'string' && o.sourceUrl.includes('gitee.com');
          const upgradeCmd = isGitee
            ? `npx skills add ${o.sourceUrl} --skill ${o.name}${scopeFlag} -y  # Gitee 源不支持 update,需重装`
            : `npx skills update ${o.name}${scopeFlag} -y`;
          return {
            name: o.name,
            current: o.current || null,
            latest: o.latest || null,
            source: isGitee ? 'gitee' : 'github',
            source_url: o.sourceUrl || null,
            scope,
            upgrade_command: upgradeCmd,
          };
        }),
      }];
    }

    // transient_error / unknown 不进 notices(stdout 完全干净)。
    // 失败提示走 stderr 一次性输出, 见 maybeNotifyFailureOnce()。
  } catch {}
  return [];
}

// 会话标识: walk 进程树跳过 shell 层,找首个非 shell 祖先作为 sessionId。
// 对 Claude Code / Codex / Cursor 等 "每次 spawn 新 shell" 的 agent, 直接用 ppid 会失配,
// 因为 shell 是 ephemeral 的; 真正稳定的是再往上一级的 agent 进程(claude/codex/cursor)。
// Linux/WSL/Git Bash(MSYS2): /proc/<pid>/stat 走树, ~1ms
// macOS: ps -p ... -o ppid,lstart,comm, ~50ms
// Windows native: powershell -EncodedCommand 跑 Get-CimInstance Win32_Process, ~500ms-1s
//   (Windows 慢, 用文件缓存 5min TTL 避免每次都付)
// 跳过这些进程, 它们都是 ephemeral 的 shell / console-host 层, 不构成"会话"
const SHELL_NAMES = new Set([
  // 主流 Unix shell
  'bash', 'sh', 'zsh', 'dash', 'fish', 'csh', 'ksh', 'tcsh',
  // 备选/罕见 Unix shell
  'xonsh', 'nu', 'nushell', 'ion', 'elvish', 'oksh', 'mksh', 'yash', 'rc', 'es',
  // Windows native shell
  'cmd.exe', 'powershell.exe', 'pwsh.exe',
  // MSYS2 / Cygwin / Git Bash 下的 shell
  'bash.exe', 'sh.exe', 'zsh.exe', 'dash.exe', 'fish.exe', 'tcsh.exe', 'ksh.exe',
  // WSL launcher (ephemeral, 跳过它走 wsl.exe 的父进程)
  'wsl.exe', 'wslhost.exe',
  // Console hosts / shell helper (per-shell ephemeral, 应该跳过)
  'conhost.exe',     // cmd/pwsh 的 console host
  'mintty.exe',      // Git Bash 默认终端
  'msys-1.0.dll',    // MSYS infra (理论上不会出现, just in case)
  'cygwin1.dll',     // Cygwin infra
]);
const SESSION_CACHE_FILE = join(CACHE_DIR, 'session.id');
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;  // 5min

// /proc walk (Linux / WSL / Git Bash MSYS2): 优先尝试,失败再走平台分支
function tryProcWalk() {
  try {
    let pid = process.ppid;
    let hops = 0;
    while (pid && pid > 1 && hops < 10) {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const commEnd = stat.lastIndexOf(')');
      const name = stat.slice(stat.indexOf('(') + 1, commEnd);
      const after = stat.slice(commEnd + 2).split(' ');
      const parentPid = parseInt(after[1], 10);
      const starttime = after[19];
      if (!SHELL_NAMES.has(name.toLowerCase())) {
        return `${pid}-${starttime}`;
      }
      pid = parentPid;
      hops++;
    }
  } catch {}
  return null;
}

// macOS ps walk
function tryMacWalk() {
  try {
    let pid = process.ppid;
    let hops = 0;
    while (pid && pid > 1 && hops < 10) {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=,lstart=,comm='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim();
      if (!out) break;
      // 格式: "<ppid> <lstart 5 字段> <comm>"
      // lstart 例: "Mon May 20 09:00:00 2026", 5 字段固定
      const parts = out.split(/\s+/);
      if (parts.length < 7) break;
      const parentPid = parseInt(parts[0], 10);
      const lstart = parts.slice(1, 6).join(' ');  // 5 字段
      const comm = parts.slice(6).join(' ');
      // comm 可能是带路径的(如 /usr/bin/bash), 取 basename
      const name = (comm.split('/').pop() || '').toLowerCase();
      if (!SHELL_NAMES.has(name)) {
        // 用 lstart 替代 starttime (字符串形式但稳定)
        const cleanStart = lstart.replace(/[^a-zA-Z0-9]/g, '');
        return `${pid}-${cleanStart}`;
      }
      pid = parentPid;
      hops++;
    }
  } catch {}
  return null;
}

// Windows PowerShell walk (一次 EncodedCommand 调用走全树, 避免多次 spawn 开销)
function tryWindowsWalk() {
  try {
    // 拼 PowerShell 脚本: 走树, 跳 shell, 输出 "MATCH:<pid>:<ticks>" 或 "NONE"
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
    ].join('; ');
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    }).trim();
    const m = out.match(/MATCH:(\d+):(\d+)/);
    if (m) return `${m[1]}-${m[2]}`;
  } catch {}
  return null;
}

// 文件缓存(Windows 慢, 5min 内复用)
function readSessionCache() {
  try {
    if (!existsSync(SESSION_CACHE_FILE)) return null;
    const st = statSync(SESSION_CACHE_FILE);
    if (Date.now() - st.mtimeMs > SESSION_CACHE_TTL_MS) return null;
    const content = readFileSync(SESSION_CACHE_FILE, 'utf8').trim();
    return content || null;
  } catch { return null; }
}
function writeSessionCache(sid) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(SESSION_CACHE_FILE, sid);
  } catch {}
}

// 模块内存缓存(同一 Node 进程内多次调用只算一次)
let _sessionIdMemo = null;

export function getSessionId() {
  if (_sessionIdMemo) return _sessionIdMemo;

  // 0. env 注入: 给嵌套子进程 / 测试场景显式锁定 sid (生产 cli.mjs 主进程不会有此 env)
  if (process.env.WIND_SKILLS_SESSION_ID) {
    _sessionIdMemo = process.env.WIND_SKILLS_SESSION_ID;
    return _sessionIdMemo;
  }

  // 1. 文件缓存(主要服务 Windows: PowerShell 慢, 5min 内不重复走)
  const cached = readSessionCache();
  if (cached) {
    _sessionIdMemo = cached;
    return cached;
  }

  // 2. /proc 优先(Linux/WSL/Git Bash 都试一下, 都能命中)
  let sid = tryProcWalk();

  // 3. 平台分支
  if (!sid) {
    if (process.platform === 'darwin') sid = tryMacWalk();
    else if (process.platform === 'win32') sid = tryWindowsWalk();
  }

  // 4. fallback: ppid (degraded, 但至少同一 shell 内能 dedup)
  if (!sid) sid = String(process.ppid);

  _sessionIdMemo = sid;
  writeSessionCache(sid);
  return sid;
}

// 失败 / 更新 sentinel: 按 <SKILL_NAME>-<sessionId> 隔离, mtime 控制时效, 两种独立文件
// per-skill 命名避免多个 skill 共用同 sid 时 dedup 互相覆盖
export function failureSentinelPath(sid = getSessionId()) {
  return join(CACHE_DIR, `${FAILURE_SENTINEL_PREFIX}${SKILL_NAME}-${sid}`);
}
export function updateSentinelPath(sid = getSessionId()) {
  return join(CACHE_DIR, `${UPDATE_SENTINEL_PREFIX}${SKILL_NAME}-${sid}`);
}

// 启动时清理 mtime > 7d 的旧 sentinel(两种前缀都扫)防累积
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

// 通用 sentinel 时效检查 + 触发
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
    const fd = openSync(sentinelPath, 'a');
    closeSync(fd);
    const now = new Date();
    utimesSync(sentinelPath, now, now);
  } catch {}
}

// 读 cache 失败状态 → 检查 sentinel → 第一次就 stderr 打通知 + touch sentinel; 否则静默。
// 仅在 cmd === 'call' 调用; 完全不动 stdout。
export function maybeNotifyFailureOnce() {
  try {
    const view = readCacheView();
    if (!view || !view.state) return;
    const state = view.state;
    if (state.status !== 'transient_error' && state.status !== 'unknown') return;
    if (state.snoozedUntil && new Date(state.snoozedUntil) > new Date()) return;

    const sentinel = failureSentinelPath();
    if (sentinelFresh(sentinel)) return;

    const reason = state.reason || 'unknown';
    process.stderr.write(`[wind-skills] 更新检测失败 (reason=${reason}), 不影响本次调用。\n`);
    touchSentinel(sentinel);
  } catch {}
}

// 检测到新版可用 → 检查 sentinel → 第一次就 stderr 打通知 + touch sentinel; 否则静默。
// 复用 collectUpdateNotices() 已有的 filterAlreadyUpgraded / snooze 过滤逻辑。
// 仅在 cmd === 'call' 调用; 完全不动 stdout。
export function maybeNotifyUpdateOnce() {
  try {
    const notices = collectUpdateNotices();
    const updateNotice = notices.find(n => n && n.type === 'update_available');
    if (!updateNotice || !Array.isArray(updateNotice.items) || updateNotice.items.length === 0) return;

    const sentinel = updateSentinelPath();
    if (sentinelFresh(sentinel)) return;

    // 格式化 stderr 输出
    const lines = ['[wind-skills] 检测到新版可用:'];
    for (const item of updateNotice.items) {
      const ver = item.current && item.latest ? `${item.current} → ${item.latest}` : (item.latest || '?');
      lines.push(`  ${item.name}: ${ver}`);
      lines.push(`  升级命令: ${item.upgrade_command}`);
    }
    process.stderr.write(lines.join('\n') + '\n');
    touchSentinel(sentinel);
  } catch {}
}

// ───── 工具函数 ─────

// 成功路径: `call` 命令完整透传 MCP `result` 对象,**不做任何 parse 或抽取**。
// 业务数据通常在 result.content[0].text(可能是 JSON 字符串,由 agent 自行 parse)。
// 其它命令(help / open-portal / setup-key)直接输出它们的结构化数据。
// 全部不带任何 envelope / meta 包裹。
function writeRawCallSuccess(result) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function writePlainSuccess(data) {
  // help / open-portal / setup-key 等结构化输出,直接 JSON
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

// 失败路径: 极简 envelope { ok:false, error:{code, agent_action} }
// 所有更新检查信号(update_available / 失败检测)走 stderr 一次性通道, stdout 永远不带。
function writeErrorEnvelope(code, detail) {
  const envelope = {
    ok: false,
    error: {
      code,
      agent_action: buildAgentAction(code, detail),
    },
  };
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}

function die(code, detail = null, exitCode = 1) {
  writeErrorEnvelope(code, detail);
  process.exit(exitCode);
}

function exitWithUsage(usage, exitCode = 0) {
  // USAGE 文本嵌入 agent_action 让 agent 自包含拿到帮助
  die('USAGE_ERROR', `USAGE:\n${usage}`, exitCode);
}

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}

// 解析 dotenv 风格配置文件，兼容注释、引号和 export 前缀。
function parseDotenv(content) {
  const env = {};
  for (const rawLine of content.split('\n')) {
    let line = rawLine.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(' #');
      if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    }
    env[key] = val;
  }
  return env;
}

function getServer(server_type) {
  const server = SERVERS[server_type];
  if (!server) {
    die('UNKNOWN_SERVER_TYPE', `未知 server_type: ${server_type}. 可用: ${Object.keys(SERVERS).join(' / ')}`);
  }
  return server;
}

function loadToolManifest() {
  try {
    // tool-manifest.json is the authority for legal server_type + tool_name combinations.
    const manifest = JSON.parse(readFileSync(TOOL_MANIFEST_PATH, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest 顶层必须是对象');
    }
    for (const [serverType, tools] of Object.entries(manifest)) {
      if (!SERVERS[serverType]) {
        throw new Error(`manifest 包含未知 server_type: ${serverType}`);
      }
      if (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string' || !tool)) {
        throw new Error(`manifest 中 ${serverType} 的工具清单必须是非空字符串数组`);
      }
    }
    for (const serverType of Object.keys(SERVERS)) {
      if (!Array.isArray(manifest[serverType])) {
        throw new Error(`manifest 缺少 server_type: ${serverType}`);
      }
    }
    return manifest;
  } catch (err) {
    die('TOOL_MANIFEST_INVALID', `工具清单读取失败: ${err.message}`);
  }
}

function validateToolSelection(server_type, toolName) {
  getServer(server_type);
  const manifest = loadToolManifest();
  const tools = manifest[server_type];
  if (!tools.includes(toolName)) {
    die('UNKNOWN_TOOL_NAME', `工具名 "${toolName}" 不属于 server_type "${server_type}"。`);
  }
}

// ───── 认证 ─────

function getApiKey() {
  if (process.env.WIND_API_KEY) return process.env.WIND_API_KEY;

  const localConfig = join(SKILL_DIR, 'config.json');
  if (existsSync(localConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(localConfig, 'utf8'));
      if (cfg.wind_api_key) return cfg.wind_api_key;
    } catch {}
  }

  const globalConfig = join(homedir(), '.wind-aifinmarket', 'config');
  if (existsSync(globalConfig)) {
    try {
      const env = parseDotenv(readFileSync(globalConfig, 'utf8'));
      if (env.WIND_API_KEY) return env.WIND_API_KEY;
    } catch {}
  }

  die('KEY_MISSING', 'WIND_API_KEY 未配置');
}

// ───── 错误码体系 ─────

const ERROR_PATTERNS = [
  ['RATE_LIMIT_DAILY', /单日请求次数超限|daily.*limit/i, 'API Key 当日请求额度已用尽。等次日 0 点刷新或换备用 Key。'],
  ['BALANCE_INSUFFICIENT', /余额不足|请先充值|insufficient.*balance/i, 'API Key 计费余额不足。开发者中心充值或换备用 Key。'],
  ['RATE_LIMIT_QPS', /请求过于频繁|qps.*limit|too.*frequent/i, '请求过于频繁。等几秒重试（可重试）。'],
  ['KEY_INVALID', /密钥无效|key.*invalid|unauthorized|认证失败|auth.*fail/i, 'API Key 无效或过期 → 开发者中心重新生成。'],
  ['NO_RESULTS', /未获取到数据|"NO_RESULTS"|no\s*results?|not\s*found|empty\s*result/i, '未获取到匹配数据。先在不改变用户意图的前提下调整关键词或参数。'],
  ['PARAM_VALIDATION_ERROR', /参数验证失败|参数.*(错误|非法|无效)|字段.*(不存在|不识别|不支持|非法)|invalid\s*(param|argument|field)|missing\s*(param|argument|field|required)/i, '后端参数验证失败。先按 SKILL.md 工具表核对字段名、必填项、日期格式和枚举值后重试。'],
  ['TOOL_RUNTIME_ERROR', /TOOL_ERROR|tool.*error|工具.*(执行|运行).*错误|runtime.*error/i, '后端工具运行错误。保留后端原文，先检查请求是否过大或口径是否受支持；不要直接切换工具绕过。'],
  ['KEY_MISSING', /WIND_API_KEY 未配置/, 'API Key 未配置。先 `node scripts/cli.mjs open-portal` 拿 Key，再选三种方式之一配置。'],
  ['UNKNOWN_SERVER_TYPE', /未知 server_type/, 'server_type 不在可用列表内。先 `cli.mjs` 看 USAGE 列表，按列表填。'],
  ['UNKNOWN_TOOL_NAME', /工具名不属于/, 'tool_name 不在该 server_type 的工具清单内。按 SKILL.md 和 references/tool-manifest.json 重新选择。'],
  ['TOOL_MANIFEST_INVALID', /工具清单读取失败/, '本地工具清单文件异常。检查 references/tool-manifest.json。'],
  ['INVALID_PARAMS_JSON', /params JSON 解析失败/, '`call` 命令第三参数必须是合法 JSON 字符串。注意 shell 转义（建议外层用单引号包裹整个 JSON）。'],
];

// 错误 message 可能来自 HTTP、JSON-RPC 或工具内嵌 JSON，统一映射成稳定错误码。
function inferErrorCode(msg) {
  if (!msg) return 'UNKNOWN';
  for (const [code, pat] of ERROR_PATTERNS) {
    if (pat.test(msg)) return code;
  }
  return 'UNKNOWN';
}

// 每个错误码对应一段 NL 处方：诊断 + 行动 一体。
// agent 读完 agent_action 就能决定下一步,无需再看其它字段。
// 后端原始 message 由 buildAgentAction() 拼到前面作为诊断上下文。
const AGENT_ACTIONS = {
  USAGE_ERROR: '命令用法不正确。读取 stdout 中的 USAGE 文本（每条 cli 调用都会输出），按可用子命令和参数格式重新构造命令后重试。',
  INVALID_PARAMS_JSON: '`call` 命令第三参数必须是合法 JSON 字符串。按当前 shell 类型调整转义（Bash 用外层单引号、PowerShell 用 \\" 转义内部双引号），修正后重试同一 server_type + tool_name；不要切换工具。',
  UNKNOWN_SERVER_TYPE: 'server_type 不在可用列表内。运行 `node scripts/cli.mjs`（无参）查看 USAGE 列出的合法 server_type，或读 SKILL.md 第 1 节"数据范围"重新选择，再重试。',
  UNKNOWN_TOOL_NAME: 'tool_name 不属于该 server_type。读取 `references/tool-manifest.json` 查询当前 server_type 的合法 tool 清单，按意图路由规则（SKILL.md "意图判定与路由顺序"）重新选择 tool 后重试；不要直接 fallback 到 analytics_data。',
  TOOL_MANIFEST_INVALID: '本地 `references/tool-manifest.json` 缺失或非法 JSON。skill 安装可能不完整,提示用户重装：`npx skills update wind-mcp-skill -g -y`。',
  UNKNOWN_SCOPE: '`setup-key` 命令必须带 --scope global 或 --scope skill。先用 AskUserQuestion 询问用户 Key 存放位置后,带上 --scope 参数重试。',
  OPEN_PORTAL_FAILED: '本地无法自动打开浏览器。把 stdout 中的 `url` 字段告知用户,让用户在自己的浏览器中手动打开开发者中心。',
  PARAM_VALIDATION_ERROR: '后端参数验证失败。按 SKILL.md "## 3. 工具表"和 `references/indicators.md` 逐字段核对：字段名、必填项、日期格式、枚举值、server_type、tool_name。修正后重试同一工具；若多次修正仍不通过且属于结构化取数问题,可改用 `analytics_data.get_financial_data`,但 question 必须忠实反映用户原始意图。',
  CONFIG_WRITE_ERROR: '配置文件写入失败。检查目标路径权限,或用 AskUserQuestion 询问用户改用另一种 scope 后重试 setup-key。',
  KEY_MISSING: 'WIND_API_KEY 未配置。立即执行 `node scripts/cli.mjs open-portal` 打开万得开发者中心；获取 Key 后执行 `node scripts/cli.mjs setup-key <KEY> --scope <global|skill>`（先用 AskUserQuestion 询问 scope）再重试原调用。不要只把 URL 发给用户,也不要改用 analytics_data 绕过。',
  KEY_INVALID: 'API Key 无效或过期。引导用户在开发者中心重新生成 Key,用 setup-key 配置后重试；不要通过切换 Wind 工具绕过。',
  KEY_FORBIDDEN_SERVER: '当前 Key 未订阅该 server 的权限。让用户在开发者中心确认权限,或选择已授权的其他 server；不要换 server 绕过。',
  RATE_LIMIT_DAILY: 'API Key 当日请求额度已用尽。等次日额度刷新,或让用户更换备用 Key；不要换工具绕过。',
  RATE_LIMIT_QPS: '请求过于频繁触发 QPS 限流。等待 3-5 秒后原样重试同一工具；不要为绕过限流而切换工具。',
  BALANCE_INSUFFICIENT: 'API Key 计费余额不足。提示用户在开发者中心充值,或更换有余额的 Key 后重试。',
  NETWORK_ERROR: '网络请求失败（DNS / 代理 / 超时 / 沙箱拦截）。检查网络环境；在 Codex 环境中确认使用 `sandbox_permissions: "require_escalated"` 联网。修复后原样重试。',
  SERVER_5XX: '万得后端服务异常。稍后原样重试同一请求；若提示超时,可降低请求复杂度（缩短时间范围、减少字段）。',
  RESPONSE_PARSE_ERROR: '后端响应格式异常。保留 stdout 错误原文,联系万得支持；不要盲目重试或切换工具。',
  NO_RESULTS: '查询命中数据为空。先在不改变用户意图的前提下调整关键词或参数重试；若专项路径仍无结果且属于结构化取数,可改用 `analytics_data.get_financial_data` 兜底,question 必须忠实反映用户原始意图。',
  MCP_PROTOCOL_ERROR: 'MCP 协议层错误。读 stdout 错误原文,若能明确指向请求形态问题则修正后重试,否则保留原文联系万得支持。',
  TOOL_RUNTIME_ERROR: '后端工具运行错误。读 stdout 错误原文,检查请求规模是否过大、字段口径是否受支持、数据覆盖范围；不能明确修正时停止并告知用户,不要盲目切换工具。',
  UNKNOWN: '未知错误。不要盲目重试；先读 stdout 错误原文,能定位本地问题（参数 / 配置 / 网络）则修正后重试一次,否则保留原文告知用户并停止。',
};

// agent_action = 后端原始诊断 + 标准处方,合并为一段 NL 文本。
// USAGE_ERROR 例外: 嵌入完整 USAGE 不截断,以便 agent 重新构造命令。
// 其它 code 上限 500 字, 防后端原文过长污染 envelope。
function buildAgentAction(code, detail) {
  const template = AGENT_ACTIONS[code] || AGENT_ACTIONS.UNKNOWN;
  if (detail && typeof detail === 'string' && detail.trim()) {
    const d = code === 'USAGE_ERROR' ? detail.trim() : detail.trim().slice(0, 500);
    return `[${d}] ${template}`;
  }
  return template;
}

// ───── MCP 调用（裸 HTTP + JSON-RPC + 响应解析兼容 SSE/纯 JSON）─────

function parseSSE(text) {
  const trimmed = text.trim();
  // 后端正常返回 SSE，部分错误场景直接返回纯 JSON。
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  const lines = text.split(/\r?\n/);
  let last = null;
  for (const line of lines) {
    if (line.startsWith('data: ')) last = line.slice(6);
  }
  if (last) {
    try {
      return JSON.parse(last);
    } catch (e) {
      throw new Error(`SSE data 行 JSON 解析失败：${e.message}。原文前 200 字符：${text.slice(0, 200)}`);
    }
  }
  throw new Error(`响应格式无法识别（既非 SSE 也非纯 JSON）。原文前 200 字符：${text.slice(0, 200)}`);
}

const HTTP_ERROR_MAP = {
  401: ['KEY_INVALID', 'API Key 无效或过期 → 开发者中心重新生成'],
  403: ['KEY_FORBIDDEN_SERVER', 'API Key 权限不足或该 server 未订阅 → 开发者中心确认'],
  429: ['RATE_LIMIT_QPS', '请求过于频繁 → 等几秒重试'],
  500: ['SERVER_5XX', '服务端异常 → 稍后重试或查 status.wind.com.cn'],
  502: ['SERVER_5XX', '网关异常 → 稍后重试'],
  503: ['SERVER_5XX', '服务暂不可用 → 稍后重试'],
  504: ['SERVER_5XX', '网关超时 → 稍后重试，或减小请求复杂度'],
};

async function mcpRequest(server_type, method, params, {
  timeoutMs = 60_000
} = {}) {
  const server = getServer(server_type);
  const apiKey = getApiKey();
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  });
  let resp;
  try {
    resp = await fetch(server.endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    die('NETWORK_ERROR', `${err.message} (server=${server_type})`);
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    const code = HTTP_ERROR_MAP[resp.status]?.[0] || 'UNKNOWN';
    const detail = `HTTP ${resp.status} ${resp.statusText} (server=${server_type})` + (bodyText ? ` | body: ${bodyText.slice(0, 200)}` : '');
    die(code, detail);
  }

  const text = await resp.text();
  let payload;
  try {
    payload = parseSSE(text);
  } catch (err) {
    die('RESPONSE_PARSE_ERROR', `${err.message} (server=${server_type})`);
  }

  if (payload.error) {
    const msg = payload.error.message || JSON.stringify(payload.error);
    die('MCP_PROTOCOL_ERROR', `${msg} (server=${server_type})`);
  }

  if (payload.result?.isError) {
    const msg = payload.result.content?.[0]?.text || JSON.stringify(payload.result);
    die(inferErrorCode(msg), `${msg} (server=${server_type})`);
  }

  // 部分工具把业务错误包在 content[0].text 的 JSON 字符串里，必须二次解析。
  const innerText = payload.result?.content?.[0]?.text;
  if (typeof innerText === 'string') {
    let inner;
    try {
      inner = JSON.parse(innerText);
    } catch {
      inner = null;
    }
    if (inner) {
      if (typeof inner.mcp_tool_error_code === 'number' && inner.mcp_tool_error_code !== 0) {
        const msg = inner.mcp_tool_error_msg || JSON.stringify(inner);
        die(inferErrorCode(msg), `${msg} (server=${server_type})`);
      }
      if (inner.error && (inner.error.code || inner.error.message)) {
        const errCode = inner.error.code || '';
        const errMsg = inner.error.message || '';
        const combined = errCode ? `${errCode}: ${errMsg}` : errMsg;
        die(inferErrorCode(combined), `${combined} (server=${server_type})`);
      }
    }
  }

  return payload.result;
}

async function mcpInitializeAndCall(server_type, method, params) {
  await mcpRequest(server_type, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: {
      name: 'wind-mcp-skill',
      version: SKILL_VERSION
    },
  }, {
    timeoutMs: 30_000
  });

  return mcpRequest(server_type, method, params, {
    timeoutMs: 600_000
  });
}

// ───── 命令 ─────

async function cmdCall(server_type, toolName, paramsJson) {
  if (!server_type || !toolName || !paramsJson) {
    exitWithUsage(
      `用法：call <server_type> <tool_name> '<params_json>'\n` +
      `可用 server_type: ${Object.keys(SERVERS).join(' / ')}\n` +
      `典型：\n  ${CALL_EXAMPLES.join('\n  ')}`,
      1,
    );
  }

  validateToolSelection(server_type, toolName);

  let args;
  try {
    args = JSON.parse(paramsJson);
  } catch (e) {
    die('INVALID_PARAMS_JSON', `params JSON 解析失败：${e.message} | 原文：${paramsJson.slice(0, 200)}`);
  }

  const result = await mcpInitializeAndCall(server_type, 'tools/call', {
    name: toolName,
    arguments: args,
    _meta: { clientVersion: SKILL_VERSION },
  });
  return {
    server_type,
    tool: toolName,
    result,
  };
}

async function cmdSetupKey(...rawArgs) {
  const key = rawArgs[0];

  if (!key || key.startsWith('--')) {
    exitWithUsage(
      `用法：cli.mjs setup-key <KEY> --scope <global|skill>\n\n` +
      `scope: global=全局共享；skill=仅当前 skill。调用前先让用户选择。`,
      1,
    );
  }

  let scope = null;
  for (let i = 1; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--scope' && rawArgs[i + 1]) {
      scope = rawArgs[i + 1];
      break;
    }
    if (a.startsWith('--scope=')) {
      scope = a.slice(8);
      break;
    }
  }

  if (!scope) {
    exitWithUsage(
      `setup-key 缺 --scope 参数。\n\n` +
      `先让用户选择 global 或 skill，再重试：cli.mjs setup-key ${maskKey(key)} --scope <global|skill>`,
      1,
    );
  }

  if (!['global', 'skill'].includes(scope)) {
    die('UNKNOWN_SCOPE', `setup-key 未知 scope: ${scope} (可选: global / skill)`);
  }

  let file;
  try {
    if (scope === 'global') {
      const dir = join(homedir(), '.wind-aifinmarket');
      if (!existsSync(dir)) mkdirSync(dir, {
        recursive: true
      });
      file = join(dir, 'config');
      let lines = [];
      if (existsSync(file)) {
        lines = readFileSync(file, 'utf8').split('\n')
          .filter(l => l.length > 0 && !/^\s*(export\s+)?WIND_API_KEY\s*=/.test(l));
      }
      lines.push(`WIND_API_KEY=${key}`);
      writeFileSync(file, lines.join('\n') + '\n', {
        mode: 0o600
      });
    } else {
      file = join(SKILL_DIR, 'config.json');
      writeFileSync(file, JSON.stringify({ wind_api_key: key }, null, 2) + '\n', { mode: 0o600 });
    }
  } catch (err) {
    die('CONFIG_WRITE_ERROR', `配置写入失败 (scope=${scope}, path=${file || 'n/a'}): ${err.message}`);
  }

  return {
    scope,
    path: file,
    key_masked: maskKey(key),
    next: '现在可以重试原 Wind 调用',
  };
}

async function cmdOpenPortal() {
  const platform = process.platform;
  let bin, args;
  if (platform === 'darwin') {
    bin = 'open';
    args = [PORTAL_URL];
  } else if (platform === 'win32') {
    bin = 'cmd';
    args = ['/c', 'start', '', PORTAL_URL];
  } else {
    bin = 'xdg-open';
    args = [PORTAL_URL];
  }

  let spawnError = null;
  try {
    const child = spawn(bin, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    });
    child.unref();
    spawnError = await new Promise((resolve) => {
      child.once('error', resolve);
      setTimeout(() => resolve(null), 300);
    });
  } catch (err) {
    spawnError = err;
  }

  const data = {
    url: PORTAL_URL,
    platform,
    spawn_command: `${bin} ${args.join(' ')}`,
    flow_note: '未登录时会自动跳转到登录页（/#/login）；登录完成后回到 overview 页面即可获取 API Key。',
    fallback_message: `如果浏览器没有自动弹出，请手动访问：${PORTAL_URL}`,
  };
  if (spawnError) {
    die('OPEN_PORTAL_FAILED', `本地无法启动浏览器: ${spawnError.message} | 用户应手动打开 ${data.url}`);
  }
  return data;
}

// ───── 主入口 ─────

// 仅当作为可执行脚本直接运行时才跑顶层命令分发;被 import (e.g. 单元测试) 时不副作用。
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (IS_MAIN) runMain();

function runMain() {
const [cmd, ...args] = process.argv.slice(2);

const USAGE =
  `wind-mcp-skill\n` +
  `访问万得 Wind 金融数据（按数据域分类调用）\n\n` +
  `用法:\n` +
  `  cli.mjs call <server_type> <tool_name> '<params_json>'\n` +
  `  cli.mjs open-portal                                # 打开万得开发者中心拿 API Key\n` +
  `  cli.mjs setup-key <KEY> --scope <global|skill>     # 配置 API Key（先问用户存放位置）\n\n` +
  `可用 server_type:\n` +
  Object.entries(SERVERS).map(([k, v]) => `  ${k.padEnd(20)}${v.label}`).join('\n') + '\n\n' +
  `典型:\n` +
  `  ${CALL_EXAMPLES.join('\n  ')}`;

// 诊断命令: 输出 sessionId + 进程树, 让用户在不同终端 / 不同 agent 自测
// 跑法: 在两个独立的 Bash tool 调用(或两次终端命令)里各跑一次 cli.mjs diagnose
// 比对输出的 sessionId; 如果相同, 跨调用 dedup 机制就生效
async function cmdDiagnose() {
  const sid = getSessionId();
  // 模块缓存可能命中, 强制重算一次, 然后清掉文件缓存重新走以展示完整链路
  _sessionIdMemo = null;
  try { unlinkSync(SESSION_CACHE_FILE); } catch {}
  return {
    platform: process.platform,
    node_pid: process.pid,
    node_ppid: process.ppid,
    session_id: sid,
    detection_method: (function() {
      if (tryProcWalk()) return 'proc';
      if (process.platform === 'darwin' && tryMacWalk()) return 'macos_ps';
      if (process.platform === 'win32' && tryWindowsWalk()) return 'windows_powershell';
      return 'ppid_fallback';
    })(),
    cache_dir: CACHE_DIR,
    sentinel_failure: failureSentinelPath(sid),
    sentinel_update: updateSentinelPath(sid),
    notes: '在两个独立终端/Bash tool 调用里各跑一次,比对 session_id 是否相同。' +
           '相同表示跨调用 dedup 工作。不同表示当前环境没有稳定的非 shell 祖先。',
  };
}

const commands = {
  call: () => cmdCall(args[0], args[1], args[2]),
  'open-portal': () => cmdOpenPortal(),
  'setup-key': () => cmdSetupKey(...args),
  diagnose: () => cmdDiagnose(),
};

if (!cmd) {
  activeCommand = 'help';
  // help: 直接输出 USAGE 纯文本(无包裹)
  process.stdout.write(USAGE + '\n');
  process.exit(0);
}

activeCommand = cmd;

if (!commands[cmd]) {
  die('USAGE_ERROR', `未知命令: ${cmd}\nUSAGE:\n${USAGE}`);
}

if (cmd === 'call') {
  spawnUpdateCheck();
  // 顺手清理 mtime > 7d 的僵尸 sentinel(零成本: 同步,目录通常 < 10 个文件)
  cleanupStaleSentinels();
  // call 命令一旦进入就尝试两个 stderr 一次性通知:
  // - 失败检测(transient_error / unknown)
  // - 检测到新版可用(update_available + 未升级)
  // 两者独立 sentinel,互不干扰;同会话各自只出一次。
  // 必须在 die() 抛出前调用(die 直接 exit 会跳过)；
  // 必须在 stdout 输出前调用(防 stderr/stdout 交错)。
  maybeNotifyFailureOnce();
  maybeNotifyUpdateOnce();
}

commands[cmd]()
  .then((data) => {
    if (cmd === 'call') {
      // call: 透传 result 内容 (parse JSON if applicable, else raw text)
      writeRawCallSuccess(data?.result);
    } else {
      // open-portal / setup-key: 直接输出结构化数据 (无 envelope 包裹)
      writePlainSuccess(data);
    }
  })
  .catch((err) => {
    die('UNKNOWN', `执行失败: ${err.message || err}${err.stack ? ' | stack: ' + err.stack.slice(0, 300) : ''}`);
  });
}
