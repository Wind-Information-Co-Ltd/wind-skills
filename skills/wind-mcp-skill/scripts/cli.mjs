#!/usr/bin/env node
 // wind-mcp-skill CLI: thin JSON-envelope wrapper around Wind MCP servers.
// Keep this file self-contained for skill portability; heavier reference material lives in SKILL.md/references.
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync
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
  fileURLToPath
} from 'node:url';
import {
  spawn
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
const UPDATE_STATE_FILE = join(homedir(), '.cache', 'wind-aifinmarket', 'update-state.json');
const TOOL_MANIFEST_PATH = join(SKILL_DIR, 'references', 'tool-manifest.json');
const SKILL_NAME = 'wind-mcp-skill';

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
    const child = spawn('node', [UPDATE_CHECK_PATH], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

function getInstalledHashes() {
  const result = {};
  const candidates = new Set();
  const xdg = process.env.XDG_STATE_HOME;
  candidates.add(xdg ?
    join(xdg, 'skills', '.skill-lock.json') :
    join(homedir(), '.agents', '.skill-lock.json'));
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
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      for (const [name, entry] of Object.entries(lock?.skills || {})) {
        const hash = entry?.skillFolderHash || entry?.computedHash;
        if (hash && !result[name]) result[name] = hash;
      }
    } catch {}
  }
  return result;
}

function filterAlreadyUpgraded(outdated) {
  const installed = getInstalledHashes();
  return outdated.filter(o => {
    const live = installed[o.name];
    if (!live) return true; // 找不到 lock,保守保留
    // 优先用同类型的 skillFolderHash 比较（update-check.mjs v2 记录）
    if (o.installedHash) return live === o.installedHash;
    // 兼容旧缓存条目：退化到 shortHash 前缀匹配
    const cur = o.current || '';
    if (!cur) return true;
    return live.startsWith(cur);
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

function collectUpdateNotices() {
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
          const isGitee = typeof o.sourceUrl === 'string' && o.sourceUrl.includes('gitee.com');
          const upgradeCmd = isGitee ?
            `npx skills add ${o.sourceUrl} --skill ${o.name} -g -y  # Gitee 源不支持 update,需重装` :
            `npx skills update ${o.name} -g -y`;
          return {
            name: o.name,
            current: o.current || null,
            latest: o.latest || null,
            source: isGitee ? 'gitee' : 'github',
            source_url: o.sourceUrl || null,
            upgrade_command: upgradeCmd,
          };
        }),
      }];
    }

    if (state.status === 'transient_error') {
      return [{
        type: 'update_check_failed',
        severity: 'warn',
        reason: state.reason || 'unknown',
        message: '检查更新失败，可能是网络问题',
      }];
    }

    if (state.status === 'unknown') {
      return [{
        type: 'update_check_unknown',
        severity: 'warn',
        reason: state.reason || 'unknown',
        message: '无法确认 wind skills 是否最新',
      }];
    }
  } catch {}
  return [];
}

// ───── 工具函数 ─────

function writeEnvelope({
  ok,
  command = activeCommand,
  data,
  error,
  notices = []
}) {
  // All agent-facing output must go through this envelope. Keep stderr free for future verbose logs only.
  const envelope = {
    ok,
    command,
    ...(data === undefined ? {} : {
      data
    }),
    ...(error ? {
      error
    } : {}),
    notices,
    meta: {
      cli_version: SKILL_VERSION,
      schema_version: OUTPUT_SCHEMA_VERSION
    },
  };
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}

function die(code, message, ctx = {}, exitCode = 1) {
  writeEnvelope({
    ok: false,
    command: ctx.command || activeCommand,
    data: ctx.data,
    error: buildErrorObject(code, message, ctx),
  });
  process.exit(exitCode);
}

function exitWithUsage(usage, exitCode = 0) {
  die('USAGE_ERROR', '命令用法不正确', {
    command: activeCommand || 'help',
    data: {
      usage
    },
    extraHint: '按 data.usage 修正命令参数后重试。',
  }, exitCode);
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
    die('UNKNOWN_SERVER_TYPE', `未知 server_type: ${server_type}`, {
      extraHint: `可用 server_type: ${Object.keys(SERVERS).join(' / ')}`,
    });
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
    die('TOOL_MANIFEST_INVALID', `工具清单读取失败: ${err.message}`, {
      extraHint: `检查 ${TOOL_MANIFEST_PATH} 是否存在且为合法 JSON；CLI 以该文件作为 server_type + tool_name 的权威清单。`,
    });
  }
}

function validateToolSelection(server_type, toolName) {
  getServer(server_type);
  const manifest = loadToolManifest();
  const tools = manifest[server_type];
  if (!tools.includes(toolName)) {
    die('UNKNOWN_TOOL_NAME', `工具名不属于 ${server_type}: ${toolName}`, {
      server_type,
      tool: toolName,
      available_tools: tools,
      extraHint: `请不要继续试错调用。先按 SKILL.md 意图路由重新判断 server_type + tool_name。\n` +
        `当前 server_type 可用工具: ${tools.join(' / ')}`,
    });
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

  die('KEY_MISSING', 'WIND_API_KEY 未配置', {
    extraHint: `先获取 Key：node ${join(SKILL_DIR, 'scripts', 'cli.mjs')} open-portal，或手动访问 ${PORTAL_URL}。\n` +
      `询问用户选择存放位置后执行：node ${join(SKILL_DIR, 'scripts', 'cli.mjs')} setup-key <KEY> --scope <global|skill>，然后重试原调用。`,
  });
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

function getErrorHint(code, fallback) {
  for (const [c, , hint] of ERROR_PATTERNS) {
    if (c === code) return hint;
  }
  if (code === 'TOOL_RUNTIME_ERROR') {
    return '后端工具运行错误。保留后端原文，先检查请求规模、字段口径和数据覆盖；不要直接切换工具绕过。';
  }
  return fallback || '未知错误，参考后端原文 + 联系万得支持。';
}

// Keep these behavior tables compatible with references/error-codes.json.
// They remain in-file so the CLI can still produce errors if reference files are missing.
const NO_FALLBACK_CODES = new Set([
  'INVALID_PARAMS_JSON', 'UNKNOWN_SERVER_TYPE', 'UNKNOWN_TOOL_NAME', 'TOOL_MANIFEST_INVALID', 'UNKNOWN_SCOPE',
  'USAGE_ERROR', 'OPEN_PORTAL_FAILED', 'CONFIG_WRITE_ERROR', 'KEY_MISSING', 'KEY_INVALID', 'KEY_FORBIDDEN_SERVER',
  'RATE_LIMIT_DAILY', 'RATE_LIMIT_QPS', 'BALANCE_INSUFFICIENT', 'NETWORK_ERROR',
  'SERVER_5XX', 'RESPONSE_PARSE_ERROR', 'MCP_PROTOCOL_ERROR', 'TOOL_RUNTIME_ERROR', 'UNKNOWN',
]);
const RETRYABLE_CODES = new Set(['RATE_LIMIT_QPS', 'NETWORK_ERROR', 'SERVER_5XX']);
const ERROR_CATEGORIES = [
  ['client', new Set(['USAGE_ERROR', 'INVALID_PARAMS_JSON', 'UNKNOWN_SERVER_TYPE', 'UNKNOWN_TOOL_NAME', 'TOOL_MANIFEST_INVALID', 'UNKNOWN_SCOPE', 'OPEN_PORTAL_FAILED'])],
  ['schema', new Set(['PARAM_VALIDATION_ERROR'])],
  ['filesystem', new Set(['CONFIG_WRITE_ERROR'])],
  ['auth', new Set(['KEY_MISSING', 'KEY_INVALID', 'KEY_FORBIDDEN_SERVER'])],
  ['quota', new Set(['RATE_LIMIT_DAILY', 'RATE_LIMIT_QPS', 'BALANCE_INSUFFICIENT'])],
  ['network', new Set(['NETWORK_ERROR'])],
  ['backend', new Set(['SERVER_5XX', 'RESPONSE_PARSE_ERROR', 'NO_RESULTS', 'MCP_PROTOCOL_ERROR', 'TOOL_RUNTIME_ERROR'])],
];
const AGENT_ACTIONS = {
  USAGE_ERROR: '读取 data.usage，按可用子命令和参数格式重新构造命令。',
  INVALID_PARAMS_JSON: '修正 params_json 或 shell 转义后重试，不要切换工具。',
  UNKNOWN_SERVER_TYPE: '从 error.hint 或 SKILL.md 的可用 server_type 中重新选择。',
  UNKNOWN_TOOL_NAME: '读取 error.context.available_tools，并按意图路由规则为当前 server_type 重新选择合法工具。',
  TOOL_MANIFEST_INVALID: '检查 references/tool-manifest.json 是否存在且为合法 JSON；本地 skill 安装可能不完整或损坏。',
  UNKNOWN_SCOPE: '让用户选择 Key 存放位置后，用 --scope global 或 --scope skill 重试 setup-key。',
  OPEN_PORTAL_FAILED: '把 data.url 告知用户，让用户在自己的浏览器中手动打开。',
  PARAM_VALIDATION_ERROR: '先按 SKILL.md 和 references 核对字段名、必填项、日期格式、枚举值、server_type 和 tool_name；专项工具修正后仍不适合时，才考虑 analytics_data。',
  CONFIG_WRITE_ERROR: '检查目标配置路径是否可写，或让用户改选 setup-key 的另一种 scope。',
  KEY_MISSING: '引导用户获取 WIND_API_KEY 并用 setup-key 配置；不要改用 analytics_data。',
  KEY_INVALID: '让用户重新生成或替换 API Key，不要通过切换 Wind 工具绕过。',
  KEY_FORBIDDEN_SERVER: '当前 Key 可能没有该 server 权限；让用户确认权限或选择已授权的数据服务。',
  RATE_LIMIT_DAILY: '日额度已用尽，等待额度刷新或更换有效 Key。',
  RATE_LIMIT_QPS: '短暂等待后原样重试，不要为了绕过 QPS 而切换工具。',
  BALANCE_INSUFFICIENT: '提示用户充值或更换有余额的有效 Key。',
  NETWORK_ERROR: '检查网络、代理、DNS、超时或 Codex 沙箱联网权限，然后原样重试。',
  SERVER_5XX: '稍后原样重试；若提示超时，可降低请求复杂度。',
  RESPONSE_PARSE_ERROR: '后端响应格式异常或发生变化；保留原始错误信息并联系 Wind 支持。',
  NO_RESULTS: '在不改变用户意图的前提下调整关键词或参数；专项路径仍不适合时，可用 analytics_data 做结构化取数兜底。',
  MCP_PROTOCOL_ERROR: '检查 error.message；若能明确修正请求形态则修正，否则保留后端原文并联系支持。',
  TOOL_RUNTIME_ERROR: '保留后端原文，检查请求规模、字段口径和数据覆盖；不能明确修正时停止并告知用户。',
  UNKNOWN: '不要盲目重试；先检查 error.message 和 context，能明确定位本地问题则修正，否则报告原始错误。',
};

function errorCategory(code) {
  return ERROR_CATEGORIES.find(([, codes]) => codes.has(code))?.[0] || 'unknown';
}

function fallbackAllowed(code, server_type) {
  return Boolean(server_type && server_type !== 'analytics_data' && !NO_FALLBACK_CODES.has(code));
}

function appendFallbackHint(code, hint, server_type) {
  if (!fallbackAllowed(code, server_type)) return hint;
  if (code === 'PARAM_VALIDATION_ERROR') {
    return `${hint} 若修正后仍为工具调用错误，且问题属于结构化取数，可改用 analytics_data.get_financial_data。`;
  }
  if (code === 'NO_RESULTS') {
    return `${hint} 若专项路径仍无可用结果，且问题属于结构化取数，可改用 analytics_data.get_financial_data。`;
  }
  return `${hint} 请先按 SKILL.md 工具表检查 server_type、tool_name 和入参后重试一次；若仍为工具调用错误，可改用 analytics_data.get_financial_data，并将 question 简化为结构化取数问题。`;
}

function buildErrorObject(code, backendMsg, ctx = {}) {
  const {
    server_type,
    apiKey,
    extraHint
  } = ctx;
  const hint = appendFallbackHint(code, extraHint || getErrorHint(code), server_type);
  const context = {
    ...(server_type ? {
      server_type
    } : {}),
    ...(ctx.tool ? {
      tool: ctx.tool
    } : {}),
    ...(apiKey ? {
      api_key_masked: maskKey(apiKey)
    } : {}),
    ...(ctx.available_tools ? {
      available_tools: ctx.available_tools
    } : {}),
  };
  return {
    code,
    message: backendMsg,
    hint,
    category: errorCategory(code),
    retryable: RETRYABLE_CODES.has(code),
    fallback_allowed: fallbackAllowed(code, server_type),
    agent_action: AGENT_ACTIONS[code] || AGENT_ACTIONS.UNKNOWN,
    ...(Object.keys(context).length ? {
      context
    } : {}),
  };
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
    die('NETWORK_ERROR', err.message, {
      server_type,
      apiKey,
      extraHint: '网络不通 / DNS 解析失败 / 代理拦截 / 超时。检查网络后重试。',
    });
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    const [code, hint] = HTTP_ERROR_MAP[resp.status] || ['UNKNOWN', '检查参数构造'];
    const detail = `HTTP ${resp.status} ${resp.statusText}` + (bodyText ? ` | body: ${bodyText.slice(0, 200)}` : '');
    die(code, detail, {
      server_type,
      apiKey,
      extraHint: hint
    });
  }

  const text = await resp.text();
  let payload;
  try {
    payload = parseSSE(text);
  } catch (err) {
    die('RESPONSE_PARSE_ERROR', err.message, {
      server_type,
      apiKey,
      extraHint: '响应格式异常，可能是后端版本变更。把后端原文发给万得支持。',
    });
  }

  if (payload.error) {
    const msg = payload.error.message || JSON.stringify(payload.error);
    die('MCP_PROTOCOL_ERROR', msg, {
      server_type,
      apiKey
    });
  }

  if (payload.result?.isError) {
    const msg = payload.result.content?.[0]?.text || JSON.stringify(payload.result);
    die(inferErrorCode(msg), msg, {
      server_type,
      apiKey
    });
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
        die(inferErrorCode(msg), msg, {
          server_type,
          apiKey
        });
      }
      if (inner.error && (inner.error.code || inner.error.message)) {
        const errCode = inner.error.code || '';
        const errMsg = inner.error.message || '';
        const combined = errCode ? `${errCode}: ${errMsg}` : errMsg;
        die(inferErrorCode(combined), combined, {
          server_type,
          apiKey
        });
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
    die('UNKNOWN_SCOPE', `setup-key 未知 scope: ${scope}`, {
      extraHint: '可选值: global / skill',
    });
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
      writeFileSync(file, JSON.stringify({
        wind_api_key: key
      }, null, 2) + '\n', {
        mode: 0o600
      });
    }
  } catch (err) {
    die('CONFIG_WRITE_ERROR', `配置写入失败: ${err.message}`, {
      extraHint: '检查目标路径是否可写，或改用 --scope global/skill 的另一种存放位置。',
      data: {
        scope,
        path: file || null
      },
    });
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
    die('OPEN_PORTAL_FAILED', `本地无法启动浏览器：${spawnError.message}`, {
      data,
      extraHint: '请把 data.url 告知用户，让他在自己设备的浏览器里打开。',
    });
  }
  return data;
}

// ───── 主入口 ─────

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

const commands = {
  call: () => cmdCall(args[0], args[1], args[2]),
  'open-portal': () => cmdOpenPortal(),
  'setup-key': () => cmdSetupKey(...args),
};

if (!cmd) {
  activeCommand = 'help';
  writeEnvelope({
    ok: true,
    command: 'help',
    data: {
      usage: USAGE
    }
  });
  process.exit(0);
}

activeCommand = cmd;

if (!commands[cmd]) {
  writeEnvelope({
    ok: false,
    command: cmd,
    data: {
      usage: USAGE
    },
    error: buildErrorObject('USAGE_ERROR', `未知命令: ${cmd}`, {
      extraHint: '按 data.usage 选择可用命令后重试。'
    }),
  });
  process.exit(1);
}

if (cmd === 'call') {
  spawnUpdateCheck();
}

commands[cmd]()
  .then((data) => {
    const notices = cmd === 'call' ? collectUpdateNotices() : [];
    writeEnvelope({
      ok: true,
      command: cmd,
      data,
      notices
    });
  })
  .catch((err) => {
    die('UNKNOWN', `执行失败：${err.message || err}`, {
      extraHint: err.stack ? `stack:\n${err.stack}` : '未知异常，建议联系万得支持。',
    });
  });
