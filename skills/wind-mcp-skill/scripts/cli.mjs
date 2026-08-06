#!/usr/bin/env node
// wind-mcp-skill CLI: thin JSON-envelope wrapper around Wind MCP servers
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const SKILL_VERSION = '2.0.1';
const DEFAULT_TOOL_CONCURRENCY = 1;
const MAX_TOOL_CONCURRENCY = 10;

// 本地 registry: 工具选择可在任何网络调用前失败
const SERVERS = {
  stock_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_stock_data/mcp/',
    label: 'Wind 股票（选股筛选 + 档案/财务/股本/事件/技术/风险 + 行情/K线/分钟）',
  },
  fund_data: {
    endpoint: 'https://mcp.wind.com.cn/vserver_fund_data/mcp/',
    label: 'Wind 基金（基金筛选 + 档案/财务/持仓/业绩/持有人/公司 + 行情/K线/分钟）',
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
const TOOL_MANIFEST_PATH = join(SKILL_DIR, 'scripts', 'tool-manifest.json');
const CALL_RULES_PATH = join(SKILL_DIR, 'scripts', 'call-rules.json');

const INTERNAL_WARNINGS_KEY = '__wind_cli_warnings';
const SKILL_NAME = basename(SKILL_DIR);

const CALL_EXAMPLES = [
  `cli.mjs call stock_data search_stocks '{"question":"筛选沪深市场市值超500亿且连续5日上涨的股票"}'`,
  `cli.mjs call stock_data search_stocks '{"question":"筛选港股中市值超1000亿港元的科技股"}'`,
  `cli.mjs call fund_data search_funds '{"question":"筛选股票型基金中近一年收益率超20%的产品"}'`,
  `cli.mjs call stock_data get_stock_basicinfo '{"question":"600519.SH公司基本档案"}'`,
  `cli.mjs call stock_data get_stock_price_indicators '{"windcode":"600519.SH","indexes":"中文简称,最新成交价,涨跌幅"}'`,
  `cli.mjs call fund_data get_fund_kline '{"windcode":"588200.SH","begin_date":"2026-04-01","end_date":"2026-04-30"}'`,
  `cli.mjs call stock_data get_stock_quote '{"windcode":"AAPL.O","begin":"2026-08-05","end":"2026-08-05"}'`,
  `cli.mjs call index_data get_index_kline '{"windcode":"000300.SH","begin_date":"2026-04-01","end_date":"2026-04-30"}'`,
  `cli.mjs call financial_docs get_financial_news '{"question":"美联储利率政策","top_k":3}'`,
  `cli.mjs call economic_data natural_language_get_edb_data '{"executionMode":"searchFetch","question":"中国GDP","observation":"10"}'`,
  `cli.mjs call analytics_data get_financial_data '{"question":"查询中国A股市场过去一年的平均成交量"}'`,
];

// ───── 自动更新 ─────
// 每天首次使用 skill 时异步执行一次 npx skills update，不阻塞主流程。

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizePath(value) {
  const normalized = resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function updateScope() {
  const globalRoot = normalizePath(join(homedir(), '.agents', 'skills'));
  const skillDir = normalizePath(SKILL_DIR);
  return skillDir.startsWith(globalRoot + '/') ? 'global' : 'project';
}

function updateStateFile() {
  return join(SKILL_DIR, 'scripts', 'update-state.json');
}

function readUpdateState() {
  try {
    const stateFile = updateStateFile();
    if (!existsSync(stateFile)) return null;
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function writeUpdateStatePatch(patch) {
  const stateFile = updateStateFile();
  mkdirSync(dirname(stateFile), { recursive: true });
  const state = { ...(readUpdateState() || {}), ...patch };
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}

function alreadyUpdatedToday() {
  try {
    const state = readUpdateState();
    return state && state.date === todayKey() && state.status === 'success';
  } catch {
    return false;
  }
}

function markSkillUsed() {
  writeUpdateStatePatch({
    lastUsedAt: new Date().toISOString(),
    lastUsedPid: process.pid,
  });
}

function triggerUpdateCheck() {
  try {
    if (!existsSync(UPDATE_CHECK_PATH)) return;
    if (alreadyUpdatedToday()) return;
    markSkillUsed();
    const tmpDir = join(homedir(), '.cache', 'wind-aifinmarket');
    mkdirSync(tmpDir, { recursive: true });
    const runnerPath = join(tmpDir, `update-check-${SKILL_NAME}-${process.pid}.mjs`);
    copyFileSync(UPDATE_CHECK_PATH, runnerPath);
    const child = spawn('node', [runnerPath, SKILL_DIR], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { });
    child.unref();
  } catch { }
}

// section: 工具函数

function normalizeSuccessPayload(value, path = '$', state = { warnings: [], tables: [], invalidPaths: [] }, dataCell = false) {
  if (dataCell && value === 'INVALID') {
    state.invalidPaths.push(path);
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeSuccessPayload(item, `${path}[${index}]`, state, dataCell));
  }
  if (!value || typeof value !== 'object') return value;

  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    const isStructuredDataArray = Array.isArray(item) && (key === 'rows' || key === 'value');
    normalized[key] = normalizeSuccessPayload(item, `${path}.${key}`, state, dataCell || isStructuredDataArray);
  }
  if (Array.isArray(value.rows)) {
    state.tables.push({ path, actual_row_count: value.rows.length });
  }
  if (Object.hasOwn(value, 'excelTotalCount')) {
    state.warnings.push({
      code: 'UNRELIABLE_DECLARED_COUNT',
      path: `${path}.excelTotalCount`,
      message: 'excelTotalCount 仅保留为后端原始字段，不得据此判断结果总数或完整性。',
    });
  }
  return normalized;
}

// 保留 MCP result 外层兼容性；只清洗可解析的 JSON 文本并附加机器可读安全元数据。
function normalizeCallSuccess(result, context = {}) {
  const output = result && typeof result === 'object' ? structuredClone(result) : result;
  const state = { warnings: [], tables: [], invalidPaths: [] };
  if (output && typeof output === 'object' && Array.isArray(output[INTERNAL_WARNINGS_KEY])) {
    state.warnings.push(...output[INTERNAL_WARNINGS_KEY]);
    delete output[INTERNAL_WARNINGS_KEY];
  }
  if (output && Array.isArray(output.content)) {
    for (const item of output.content) {
      if (item?.type !== 'text' || typeof item.text !== 'string') continue;
      try {
        const parsed = JSON.parse(item.text);
        item.text = JSON.stringify(normalizeSuccessPayload(parsed, '$', state));
      } catch {
        // 非 JSON 文本按后端原文透传。
      }
    }
  }
  if (state.invalidPaths.length) {
    state.warnings.push({
      code: 'BACKEND_INVALID_AS_NULL',
      count: state.invalidPaths.length,
      paths: state.invalidPaths.slice(0, 100),
      truncated: state.invalidPaths.length > 100,
      message: '结构化数据区中的后端字符串 INVALID 已转换为 null；表示缺失或不适用，禁止按 0 参与计算。',
    });
  }
  if (output && typeof output === 'object') {
    output.cli_meta = {
      schema_version: '1.0',
      server_type: context.server_type || null,
      tool_name: context.tool_name || null,
      completeness: state.warnings.some(warning => warning.code === 'UNRELIABLE_DECLARED_COUNT') ? 'unknown' : 'not_asserted',
      tables: state.tables,
      warnings: state.warnings,
    };
  }
  return output;
}

function writeRawCallSuccess(result, context = {}) {
  process.stdout.write(JSON.stringify(normalizeCallSuccess(result, context), null, 2) + '\n');
}

function writePlainSuccess(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function loadParamsInput(paramsInput) {
  if (!paramsInput.startsWith('@')) {
    return { jsonText: paramsInput, source: 'inline' };
  }

  const fileArg = paramsInput.slice(1);
  if (!fileArg) {
    const error = new Error('@file 缺少文件路径');
    error.code = 'PARAMS_FILE_ERROR';
    error.file = fileArg;
    throw error;
  }

  const filePath = resolve(process.cwd(), fileArg);
  try {
    const jsonText = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return { jsonText, source: 'file', filePath };
  } catch (cause) {
    const error = new Error(`无法读取 params 文件：${filePath} (${cause.code || cause.message})`);
    error.code = 'PARAMS_FILE_ERROR';
    error.file = filePath;
    error.cause = cause;
    throw error;
  }
}

const RETRY_AFTER_CORRECTION = Object.freeze({ allowed: false, mode: 'after_correction', max_attempts: 0 });
const RETRY_SAME_REQUEST = Object.freeze({ allowed: true, mode: 'same_request', max_attempts: 1 });
const RETRY_AFTER_WAIT_3S = Object.freeze({ allowed: true, mode: 'same_request_after_wait', max_attempts: 1, after_ms: 3000 });
const RETRY_AFTER_WAIT_5S = Object.freeze({ allowed: true, mode: 'same_request_after_wait', max_attempts: 1, after_ms: 5000 });
const KEEP_CURRENT_CALL = Object.freeze({ tripped: false, scope: 'current_call', action: 'none' });
const ABORT_REMAINING_BATCH = Object.freeze({ tripped: true, scope: 'remaining_batch', action: 'abort_remaining_calls' });
const NO_CORRECTION = Object.freeze({});
const REDUCE_CONCURRENCY = Object.freeze({
  strategy: 'reduce_concurrency',
  change_only: ['concurrency'],
  recommended_concurrency: DEFAULT_TOOL_CONCURRENCY,
  recommended_max_concurrency: MAX_TOOL_CONCURRENCY,
  preserve_server_type: true,
  preserve_tool_name: true,
  preserve_params: true,
});

function defineError(agentAction, {
  retry = RETRY_AFTER_CORRECTION,
  circuitBreaker = KEEP_CURRENT_CALL,
  correction = NO_CORRECTION,
} = {}) {
  return Object.freeze({
    agent_action: agentAction,
    retry,
    circuit_breaker: circuitBreaker,
    correction,
  });
}

// 错误文案与默认机器策略的唯一总表。调用点可用 metadata 补充本次请求的精确诊断。
const ERROR_DEFINITIONS = Object.freeze({
  TEMPORARILY_UNAVAILABLE: defineError(
    '原因：后端临时不可用。处理：保持当前 server_type、tool_name 和参数不变。重试：仅允许原样重试一次，仍失败则停止并告知用户稍后再试。',
    { retry: RETRY_SAME_REQUEST },
  ),
  INVALID_PARAM_NAME: defineError(
    '原因：参数名错误或缺少必填字段。处理：按 error.details 内联的 allowed_fields 或 required_fields 修正。重试：禁止原样重试；修正后最多重试一次。',
    { circuitBreaker: ABORT_REMAINING_BATCH },
  ),
  INVALID_PARAM_VALUE: defineError(
    '原因：参数值不合法。处理：按 error.details 内联的 expected_format、allowed_values 或其它期望值修正。重试：禁止原样重试；修正后最多重试一次。',
    { circuitBreaker: ABORT_REMAINING_BATCH },
  ),
  EDB_INDICATOR_NOT_FOUND: defineError(
    '原因：EDB 未找到用户想查询的经济指标。处理：保持 economic_data.natural_language_get_edb_data，只将 question 改成更短、更标准、更明确的单个指标名；优先补充官方口径、地区、来源或常见英文名，去掉年份、预测、市场规模、CAGR 或多个指标拼接等非指标名成分。重试：禁止原样重试；改写后最多重试一次。若改写后仍未找到，停止自动尝试并提示用户提供更明确的指标名称、来源或口径。',
  ),
  MARKET_TARGET_NOT_FOUND: defineError(
    '原因：行情类金融标的未识别，通常是 windcode 中的标的名称、简称或代码无法被 Wind NER 匹配。处理：保持当前行情工具；若用户输入的是中文名、简称或自然语言标的，优先原样传入更明确的单个名称，不得自行补交易所后缀或把名称猜成代码；若原始 windcode 是 1-5 位纯大写英文字母，且用户问题明确是美股/美国上市公司语境，允许仅在本错误后改为 <ticker>.O 重试一次；台股、日股、韩股、欧股等超出本 skill 覆盖范围的请求不得套用 .O 重试，应停止并说明不在支持范围；只有用户明确给出标准代码且明确市场时，才可修正为用户确认的其它 Wind 标准代码。重试：禁止原样重试；修正后最多重试一次。若仍未识别，停止自动尝试并提示用户提供更明确的标的全称、交易所或 Wind 标准代码。',
    { circuitBreaker: ABORT_REMAINING_BATCH },
  ),
  PARAM_TYPE_ERROR: defineError(
    '原因：参数类型错误，实际值与工具接受的类型不匹配。处理：按 error.details 中的 expected_type 修正对应字段；indexes 使用英文逗号分隔字符串。重试：禁止原样重试；修正后最多重试一次。',
    { circuitBreaker: ABORT_REMAINING_BATCH },
  ),
  PERIOD_PARSE_ERROR: defineError(
    "原因：K 线周期值无法解析。处理：保持当前 K 线工具，只修 period；日线用 '1d'，周线用 '1w'，月线用 '1mo'。重试：禁止原样重试；修正后最多重试一次。",
  ),
  USAGE_ERROR: defineError(
    "原因：调用命令格式错误。处理：修正为 cli.mjs call <server_type> <tool_name> '<params_json>|@params_file'。重试：禁止原样重试；修正命令形态后最多重试一次。",
  ),
  PARAMS_FILE_ERROR: defineError(
    '原因：@file 参数文件路径为空、文件不存在、无权限或无法读取。处理：只修文件路径或权限，不改 server_type、tool_name 和业务参数。重试：文件可读后最多重试一次。',
    { circuitBreaker: ABORT_REMAINING_BATCH },
  ),
  INVALID_PARAMS_JSON: defineError(
    '原因：内联参数或 @file 文件内容不是可解析的 JSON。处理：只修 shell 引号、JSON 转义或文件内容，不改字段、日期、indexes、question 或工具。重试：禁止原样重试；修正 JSON 后最多重试一次。',
  ),
  ROUTE_ERROR: defineError(
    '原因：server_type 或 tool_name 不合法。处理：按 error.details 内联的合法 server_type、tool_name 或候选路由修正。重试：禁止原样重试；修正路由后最多重试一次。',
  ),
  PARAM_VALIDATION_ERROR: defineError(
    '原因：本地或后端参数校验未通过。处理：按 error.details 内联的 field、issue、expected_format、allowed_values、allowed_fields 或 required_fields 修正。重试：禁止原样重试；修正后最多重试一次。',
    { circuitBreaker: ABORT_REMAINING_BATCH },
  ),
  PARAM_CONFLICT_ERROR: defineError(
    '原因：同时传入的同义参数值不一致。处理：按 error.details 中的 fields 和 actual_values 保留一个字段，或将两个字段改为相同值；不得静默覆盖。重试：修正冲突后最多重试一次。',
    { circuitBreaker: ABORT_REMAINING_BATCH },
  ),
  AUTH_ERROR: defineError(
    '原因：认证失败或 API Key 缺失/无效。处理：按 detail 配置或更换有效 Key；不要换工具绕过。重试：Key 修复前禁止重试；Key 修复后最多原样重试一次。',
  ),
  DAILY_LIMIT_ERROR: defineError(
    '原因：当前 Key 的单日请求次数已达上限，不是账户余额不足。处理：等待次日额度刷新，或更换仍有当日额度的 Key。重试：额度刷新或更换 Key 前禁止重试。',
  ),
  BALANCE_ERROR: defineError(
    '原因：当前 Key 对应账户余额不足，不是单日请求次数超限。处理：充值，或更换余额充足的 Key。重试：余额恢复或更换 Key 前禁止重试。',
  ),
  RATE_LIMIT_ERROR: defineError(
    '原因：请求过于频繁，触发 QPS 限流，不代表日额度或余额不足。处理：等待 3-5 秒，并降低请求频率。重试：等待后仅允许原样重试一次。',
    { retry: RETRY_AFTER_WAIT_5S },
  ),
  CONCURRENCY_LIMIT_ERROR: defineError(
    '原因：当前同时执行的工具请求数超过后端并发上限，不是参数、标的或额度错误。处理：立即停止发起剩余同批请求，等待 3 秒并恢复串行调用；如用户明确要求并发，并发数不得超过 10。重试：降低并发后仅允许原样重试一次。',
    {
      retry: RETRY_AFTER_WAIT_3S,
      circuitBreaker: ABORT_REMAINING_BATCH,
      correction: REDUCE_CONCURRENCY,
    },
  ),
  NETWORK_ERROR: defineError(
    '原因：网络连接或后端 HTTP 5xx 异常。处理：若 detail 暴露参数问题，先修参数；否则稍后再试。重试：仅允许原样重试一次，仍失败则停止并告知用户。',
    { retry: RETRY_SAME_REQUEST },
  ),
  TOOL_RUNTIME_ERROR: defineError(
    '原因：后端工具运行失败。处理：优先根据 detail 判断是否为请求过大、字段不支持或数据未覆盖；能定位则只修对应项。重试：禁止盲目原样重试；修正后最多重试一次，无法定位则停止。',
  ),
  NO_RESULTS: defineError(
    '原因：工具执行成功但没有匹配结果。处理：保持同一 server_type、tool_name 和用户意图，只调整一个直接相关的关键词、时间范围或粒度。重试：禁止原样重试；调整后最多重试一次。若第二次仍无结果，停止自动尝试并提示用户提供更明确的指标名称、来源或口径。',
  ),
  SETUP_ERROR: defineError(
    '原因：本地配置或环境操作失败。处理：按 detail 修正 scope、权限、路径或让用户手动打开 URL。重试：禁止原样重试；修正本地问题后最多重试一次。',
  ),
  UNKNOWN: defineError(
    '原因：未归类的后端或本地错误；不代表参数、工具或标的可修复。处理：保留 detail 原文，不要猜测参数、切换工具或扩大查询；仅当能明确判断属于本地命令、参数、认证或网络问题时，才修正对应项。重试：禁止原样重试；有确定修正项时最多重试一次，无法明确定位则停止并将 detail 原文告知用户。',
  ),
});

function getErrorDefinition(code) {
  return ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.UNKNOWN;
}

// 失败 envelope 保留 agent_action 向后兼容，同时提供机器可读的诊断与重试策略。
function writeErrorEnvelope(code, detail, metadata = {}) {
  const definition = getErrorDefinition(code);
  const envelope = {
    ok: false,
    error: {
      code,
      ...(metadata.error_message ? { message: metadata.error_message } : {}),
      details: metadata.details || (detail ? { message: String(detail).slice(0, 500) } : {}),
      retry: metadata.retry || definition.retry,
      circuit_breaker: metadata.circuit_breaker || definition.circuit_breaker,
      correction: metadata.correction || definition.correction,
      agent_action: buildAgentAction(code, detail),
    },
  };
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}

function die(code, detail = null, exitCode = 1, metadata = {}) {
  writeErrorEnvelope(code, detail, metadata);
  process.exit(exitCode);
}

function exitWithUsage(usage, exitCode = 0) {
  die('USAGE_ERROR', `USAGE:\n${usage}`, exitCode);
}

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}

// dotenv 解析: 兼容注释 / 引号 / export 前缀
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
    die('ROUTE_ERROR', `未知 server_type: ${server_type}. 可用: ${Object.keys(SERVERS).join(' / ')}`, 1, {
      details: { field: 'server_type', issue: 'invalid_enum', actual: server_type, allowed_values: Object.keys(SERVERS) },
      retry: { allowed: true, mode: 'after_correction', max_attempts: 1 },
      correction: { change_only: ['server_type'] },
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
    die('UNKNOWN', `工具清单读取失败: ${err.message}`);
  }
}

function validateToolSelection(server_type, toolName) {
  getServer(server_type);
  const manifest = loadToolManifest();
  const tools = manifest[server_type];
  if (!tools.includes(toolName)) {
    die('ROUTE_ERROR', `工具名 "${toolName}" 不属于 server_type "${server_type}"。`, 1, {
      details: { field: 'tool_name', issue: 'invalid_enum', actual: toolName, server_type, allowed_values: tools },
      retry: { allowed: true, mode: 'after_correction', max_attempts: 1 },
      correction: { change_only: ['tool_name'], preserve_server_type: true },
    });
  }
}

const PRICE_INDICATOR_TOOLS = new Set(['get_stock_price_indicators', 'get_fund_price_indicators', 'get_index_price_indicators']);
const QUOTE_TOOLS = new Set(['get_stock_quote', 'get_fund_quote', 'get_index_quote']);
const EDB_EXECUTION_MODE_ALIASES = new Map([
  ['仅搜索', 'search'],
  ['仅提数', 'fetch'],
  ['搜索并提数', 'searchFetch'],
]);

function readCallRules() {
  try {
    return JSON.parse(readFileSync(CALL_RULES_PATH, 'utf8'));
  } catch (err) {
    die('UNKNOWN', `调用规则读取失败: ${err.message}`);
  }
}

function prepareNormalizationRules(rules) {
  return {
    klinePeriodMap: new Map(Object.entries(rules.kline_period_map || {})),
    toolByDomain: rules.tool_by_domain || {},
  };
}

const CALL_RULES = readCallRules();
const NORMALIZATION_RULES = prepareNormalizationRules(CALL_RULES);
const KLINE_PERIOD_MAP = NORMALIZATION_RULES.klinePeriodMap;
const PUBLIC_KLINE_PERIODS = new Set(KLINE_PERIOD_MAP.keys());
const KLINE_PERIODS = new Set(KLINE_PERIOD_MAP.values());
const TOOL_BY_DOMAIN = NORMALIZATION_RULES.toolByDomain;

const TOOL_VALIDATION_RULES = {
  basic: CALL_RULES.basic || {},
  toolRules: Array.isArray(CALL_RULES.tool_rules) ? CALL_RULES.tool_rules : [],
};
const KLINE_TOOLS = new Set(TOOL_VALIDATION_RULES.toolRules.find(rule => rule.name === 'kline')?.tools || []);

function normalizeIndexes(indexes) {
  if (typeof indexes !== 'string') return indexes;
  return indexes.split(',').map((item) => item.trim()).filter(Boolean).join(',');
}

function normalizeWindcode(windcode) {
  if (typeof windcode !== 'string') return windcode;
  const raw = windcode.trim();
  const upper = raw.toUpperCase();
  // Keep natural-language names untouched. Wind's backend NER is responsible
  // for resolving names/aliases; the CLI must not guess exchange suffixes.
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  if (/^0\d{4}\.HK$/.test(upper)) return upper.slice(1);
  if (/^\d{4}\.HK$/.test(upper)) return upper;
  if (/^\d{6}\.(SH|SZ|BJ|OF)$/.test(upper)) return upper;
  if (/^[A-Z]{1,5}\.(O|N|A|HK|SH|SZ|BJ)$/.test(upper)) return upper;
  return raw;
}

function toolFamily(toolName) {
  if (PRICE_INDICATOR_TOOLS.has(toolName)) return 'price';
  if (KLINE_TOOLS.has(toolName)) return 'kline';
  if (QUOTE_TOOLS.has(toolName)) return 'quote';
  return null;
}

function normalizeCall(server_type, toolName, args) {
  const family = toolFamily(toolName);
  if (family) toolName = TOOL_BY_DOMAIN[family]?.[server_type] || toolName;
  const normalizedArgs = { ...args };
  const normalizationErrors = [];
  if (toolName === 'natural_language_get_edb_data' && typeof normalizedArgs.executionMode === 'string') {
    normalizedArgs.executionMode = EDB_EXECUTION_MODE_ALIASES.get(normalizedArgs.executionMode) || normalizedArgs.executionMode;
  }
  if (typeof normalizedArgs.indexes === 'string') normalizedArgs.indexes = normalizeIndexes(normalizedArgs.indexes);
  if (typeof normalizedArgs.windcode === 'string') normalizedArgs.windcode = normalizeWindcode(normalizedArgs.windcode);
  if (KLINE_TOOLS.has(toolName) && normalizedArgs.period === undefined) normalizedArgs.period = '1d';
  if (typeof normalizedArgs.period === 'string') {
    const key = normalizedArgs.period.trim();
    const backendPeriod = KLINE_PERIOD_MAP.get(key);
    normalizedArgs.period = backendPeriod || key;
    if (!backendPeriod && KLINE_PERIODS.has(key)) {
      normalizationErrors.push({
        message: `字段 'period' 只能是 ${Array.from(PUBLIC_KLINE_PERIODS).join('/')}，日 K 请传 '1d'`,
        field: 'period',
        issue: 'invalid_enum',
        actual: key,
        allowed_values: Array.from(PUBLIC_KLINE_PERIODS),
      });
    }
  }
  return { server_type, toolName, args: normalizedArgs, normalizationErrors };
}

function validateBasicParams(params, toolName) {
  const errors = [];
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return [{
      code: 'PARAM_TYPE_ERROR',
      message: 'params 必须是 JSON object',
      field: 'params',
      issue: 'invalid_type',
      expected_type: 'object',
      actual_type: Array.isArray(params) ? 'array' : typeof params,
    }];
  }

  const basic = TOOL_VALIDATION_RULES.basic;
  for (const key of basic.string_keys || []) {
    if (!(key in params)) continue;
    if (typeof params[key] !== 'string') {
      errors.push({ message: `字段 '${key}' 必须是字符串`, field: key, issue: 'invalid_type', expected_type: 'string', actual_type: Array.isArray(params[key]) ? 'array' : typeof params[key] });
    } else if (params[key].trim().length === 0) {
      errors.push({ message: `字段 '${key}' 不能为空或全空白`, field: key, issue: 'empty_value', expected: 'non-empty string' });
    }
  }
  return errors;
}

function hasParamValue(params, key) {
  return params[key] !== undefined && params[key] !== null && params[key] !== '';
}

function resolveValidationValues(fieldRule) {
  if (Array.isArray(fieldRule.values)) return fieldRule.values.map(String);
  if (fieldRule.values_from === 'kline_period_map') return Array.from(KLINE_PERIODS).map(String);
  return [];
}

function resolveValidationDisplayValues(fieldRule) {
  if (fieldRule.values_from === 'kline_period_map') return Array.from(PUBLIC_KLINE_PERIODS).map(String);
  return resolveValidationValues(fieldRule);
}

function renderValidationMessage(template, values) {
  return String(template || '').replace('${values}', values.join('/'));
}

function renderValidationTemplate(template, params) {
  return String(template || '').replace(/\$\{([^}]+)\}/g, (_, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function validationErrorMessage(error) {
  return typeof error === 'string' ? error : error.message;
}

function validationErrorCode(error) {
  return typeof error === 'object' && error?.code ? error.code : null;
}

function validateToolParams(toolName, params) {
  const errors = [];
  const rules = TOOL_VALIDATION_RULES.toolRules.filter(rule => Array.isArray(rule.tools) && rule.tools.includes(toolName));

  for (const rule of rules) {
    const ruleLabel = rule.label || rule.name || toolName;
    if (Array.isArray(rule.allowed)) {
      const allowedKeys = new Set(rule.allowed);
      for (const key of Object.keys(params)) {
        if (!allowedKeys.has(key)) errors.push({ message: `${ruleLabel} 工具不支持字段 '${key}'`, field: key, issue: 'unknown_field', allowed_fields: [...allowedKeys] });
      }
    }

    for (const key of rule.required || []) {
      if (!hasParamValue(params, key)) errors.push({ message: `${ruleLabel} 工具缺少必填字段 '${key}'`, field: key, issue: 'missing_required', required_fields: rule.required || [] });
    }

    for (const [field, fieldRule] of Object.entries(rule.enum_fields || {})) {
      if (!(field in params)) continue;
      const values = resolveValidationValues(fieldRule);
      if (!values.includes(String(params[field]))) {
        const displayValues = resolveValidationDisplayValues(fieldRule);
        errors.push({ message: renderValidationMessage(fieldRule.message, displayValues), field, issue: 'invalid_enum', actual: params[field], allowed_values: displayValues });
      }
    }

    for (const fields of rule.paired || []) {
      const present = fields.filter(key => hasParamValue(params, key));
      if (present.length > 0 && present.length < fields.length) {
        errors.push({ message: `字段 '${fields.join("' 和 '")}' 应成对填写`, fields, issue: 'incomplete_pair', expected_fields: fields });
      }
    }

    for (const fields of rule.mutually_exclusive || []) {
      const present = fields.filter(key => hasParamValue(params, key));
      if (present.length > 1) {
        errors.push({ message: `字段 '${fields.join('/')}' 互斥，不应同时填写`, fields, issue: 'mutually_exclusive' });
      }
    }

    for (const [startKey, endKey] of rule.ordered_dates || []) {
      if (params[startKey] && params[endKey] && params[startKey] > params[endKey]) {
        errors.push({ message: `字段 '${startKey}' 不能晚于 '${endKey}'`, fields: [startKey, endKey], issue: 'invalid_order', expected: `${startKey} <= ${endKey}` });
      }
    }

    for (const [field, patternRule] of Object.entries(rule.patterns || {})) {
      if (!(field in params)) continue;
      const pattern = new RegExp(patternRule.pattern);
      if (!pattern.test(String(params[field]))) {
        errors.push({ message: patternRule.message || `字段 '${field}' 格式不合法`, field, issue: 'invalid_format', actual: params[field], expected_pattern: patternRule.pattern });
      }
    }

    for (const conditional of rule.required_one_of_when || []) {
      if (!conditional.values?.map(String).includes(String(params[conditional.field]))) continue;
      const satisfied = conditional.one_of?.some(group => group.every(key => hasParamValue(params, key)));
      if (!satisfied) errors.push({ message: conditional.message || `字段 '${conditional.field}' 当前取值缺少配套参数`, field: conditional.field, issue: 'missing_conditional_fields', one_of: conditional.one_of });
    }
  }
  return errors;
}

// ───── 认证 ─────

function getApiKey() {
  const globalConfig = join(homedir(), '.wind-aifinmarket', 'config');
  if (existsSync(globalConfig)) {
    try {
      const env = parseDotenv(readFileSync(globalConfig, 'utf8'));
      const key = env.WIND_API_KEY?.trim();
      if (key) return key;
    } catch { }
  }

  const localConfig = join(SKILL_DIR, 'config.json');
  if (existsSync(localConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(localConfig, 'utf8'));
      const key = typeof cfg.wind_api_key === 'string' ? cfg.wind_api_key.trim() : '';
      if (key) return key;
    } catch { }
  }

  const envKey = process.env.WIND_API_KEY?.trim();
  if (envKey) return envKey;

  die('AUTH_ERROR', 'WIND_API_KEY 未配置（CLI 已完整检查：用户全局配置 > Skill 本地配置 > 环境变量）');
}

// section: 错误码 — message 来自 HTTP / JSON-RPC / 工具内嵌 JSON, 统一映射成稳定 code

const ERROR_PATTERNS = [
  ['TEMPORARILY_UNAVAILABLE', /temporarily_unavailable/i, '后端偶发不可用。'],
  ['EDB_INDICATOR_NOT_FOUND', /未找到匹配的(?:经济)?指标|indicator_not_found/i, 'EDB 未找到用户想查询的指标。'],
  ['MARKET_TARGET_NOT_FOUND', /market_target_not_found|NER-API error.*(?:识别合并后无结果|请确认输入内容是否包含实体)|comm_exception.*NER-API|未识别实体|未识别到有效的金融标的|ner_error/i, '行情类查询对象未识别。'],
  ['PARAM_TYPE_ERROR', /attribute_error|(?:'list' object has no attribute '(?:split|strip)')|(?:list object has no attribute (?:split|strip))/i, '参数类型错误：列表传给了只接受字符串的字段。'],
  ['PERIOD_PARSE_ERROR', /srv_internal_error|For input string:\s*\\?["\x27]?(?:day|daily|monthly|week|weekly|month|D|M|W)\\?["\x27]?/i, 'K 线周期值无法解析。'],
  ['INVALID_PARAM_VALUE', /invalid_param_value|Invalid value .* for field|参数值.*不合法|参数值错误/i, '后端参数值错误。'],
  ['INVALID_PARAM_NAME', /invalid_param_name|缺少必填参数|missing required/i, '后端参数名错误。'],
  ['DAILY_LIMIT_ERROR', /单日请求次数超限|daily.*(?:request|quota)?.*limit|daily.*limit.*exceed/i, '单日请求次数已超限。'],
  ['BALANCE_ERROR', /余额不足|请先充值|insufficient.*balance/i, '账户余额不足。'],
  ['CONCURRENCY_LIMIT_ERROR', /当前工具并发请求数量超限|并发(?:请求)?(?:数量)?(?:超限|过多)|concurren(?:cy|t).*(?:limit|exceed|too many)/i, '工具并发请求数量超限。'],
  ['RATE_LIMIT_ERROR', /请求过于频繁|qps.*limit|too.*frequent|rate.*limit/i, 'QPS 限流。'],
  ['AUTH_ERROR', /密钥无效|key.*invalid|unauthorized|认证失败|auth.*fail/i, '认证/权限错误。按 Key 机制修复后原样重试。'],
  ['NO_RESULTS', /未获取到数据|"NO_RESULTS"|no\s*results?|not\s*found|empty\s*result/i, '未获取到匹配数据。先在不改变用户意图的前提下调整关键词或参数。'],
  ['PARAM_VALIDATION_ERROR', /参数验证失败|参数.*(错误|非法|无效)|字段.*(不存在|不识别|不支持|非法)|invalid\s*(param|argument|field)|missing\s*(param|argument|field|required)/i, '后端参数验证失败。先按 SKILL.md 工具表核对字段名、必填项、日期格式和枚举值后重试。'],
  ['NETWORK_ERROR', /服务.*暂不可用|服务.*不可用|service\s+unavailable|temporarily\s+unavailable/i, '网络/后端错误。先核对参数再稍后重试。'],
  ['TOOL_RUNTIME_ERROR', /TOOL_ERROR|tool.*error|工具.*(执行|运行).*错误|runtime.*error/i, '后端工具运行错误。保留后端原文，先检查请求是否过大或口径是否受支持；不要直接切换工具绕过。'],
];

function inferErrorCode(msg) {
  if (!msg) return 'UNKNOWN';
  if (/^\s*"?OK"?\s*$/i.test(String(msg))) return 'TOOL_RUNTIME_ERROR';
  for (const [code, pat] of ERROR_PATTERNS) {
    if (pat.test(msg)) return code;
  }
  return 'UNKNOWN';
}

function hasUsableData(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function businessPayloadHasUsableData(inner) {
  const body = inner && typeof inner === 'object' ? inner.data : null;
  if (!body || typeof body !== 'object') return hasUsableData(body);
  return Object.hasOwn(body, 'data') ? hasUsableData(body.data) : hasUsableData(body);
}

function classifyBusinessResponse(inner, serverType) {
  const body = inner && typeof inner === 'object' ? inner.data : null;
  if (!body || typeof body !== 'object') return null;
  const numericCode = typeof body.code === 'number'
    ? body.code
    : (typeof body.code === 'string' && /^\d+$/.test(body.code.trim()) ? Number(body.code) : null);
  if (numericCode === null) return null;
  const message = typeof body.message === 'string' ? body.message : JSON.stringify(body);
  const isSuccessCode = numericCode === 0
    || (numericCode >= 200 && numericCode < 300 && /^(OK|SUCCESS)$/i.test(String(body.message || '').trim()));
  if (isSuccessCode) return null;
  if (serverType === 'economic_data' && numericCode === 1003) {
    return { error: ['EDB_INDICATOR_NOT_FOUND', message] };
  }
  const inferredCode = inferErrorCode(message);
  if (businessPayloadHasUsableData(inner) && inferredCode === 'UNKNOWN') {
    return {
      warning: {
        code: 'UNKNOWN_BACKEND_STATUS_WITH_DATA',
        backend_code: body.code,
        backend_message: body.message ?? null,
        message: '后端返回未知业务状态码，但响应中包含可用数据；已保留数据并降级为成功警告。',
      },
    };
  }
  return { error: [inferredCode, message] };
}


function isExplicitNoDataResult(inner) {
  return inner?.data === null
    && inner?.error?.code === 'QUERY_FAILED'
    && inner?.error?.message === '没找到数据';
}

// detail 只保留短诊断，避免后端长文本淹没 agent_action。
function buildAgentAction(code, detail) {
  const template = getErrorDefinition(code).agent_action;
  if (code === 'USAGE_ERROR') return template;
  if (detail && typeof detail === 'string' && detail.trim()) {
    const d = detail.trim().slice(0, 500);
    return `[${d}] ${template}`;
  }
  return template;
}

// section: MCP 调用 — 裸 HTTP + JSON-RPC, 响应兼容 SSE / 纯 JSON

function parseSSE(text) {
  const trimmed = text.trim();
  // 后端正常 SSE, 部分错误场景纯 JSON
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch { }
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

async function fetchWithRetry(fetchFn, url, optionsOrFactory, {
  attempts = 3,
  delaysMs = [300, 1000],
  onAttemptError = null,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const options = typeof optionsOrFactory === 'function'
        ? optionsOrFactory(attempt)
        : optionsOrFactory;
      return await fetchFn(url, options);
    } catch (err) {
      lastError = err;
      onAttemptError?.(err, attempt, attempts);
      const delayMs = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] || 0;
      if (attempt < attempts && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

const HTTP_ERROR_MAP = {
  401: ['AUTH_ERROR', 'API Key 无效或过期'],
  429: ['RATE_LIMIT_ERROR', '请求过于频繁'],
  500: ['NETWORK_ERROR', '服务端异常'],
  502: ['NETWORK_ERROR', '网关异常'],
  503: ['NETWORK_ERROR', '服务暂不可用'],
  504: ['NETWORK_ERROR', '网关超时'],
};

async function mcpRequest(server_type, method, params, {
  timeoutMs = 60_000,
  diagnosticContext = null,
} = {}) {
  const server = getServer(server_type);
  const responseWarnings = [];
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
  const dieMcp = (code, detail, { backendError = null } = {}) => {
    if (code !== 'MARKET_TARGET_NOT_FOUND') {
      const backendMessage = String(detail || '').replace(/\s*\(server=[^)]+\)\s*$/, '').slice(0, 2000);
      const callArguments = params?.arguments && typeof params.arguments === 'object' ? params.arguments : null;
      die(code, detail, 1, {
        ...(backendError?.message ? { error_message: backendError.message } : {}),
        details: {
          server_type,
          tool_name: params?.name || null,
          backend_message: backendMessage,
          ...(backendError ? { backend_error: backendError } : {}),
          original_params: callArguments,
        },
      });
    }
    const originalInput = diagnosticContext?.original_input ?? params?.arguments?.windcode ?? null;
    const attemptedInput = diagnosticContext?.normalized_input ?? params?.arguments?.windcode ?? null;
    die(code, detail, 1, {
      details: {
        message: String(detail || '').slice(0, 500),
        field: 'windcode',
        issue: 'instrument_not_resolved',
        original_input: originalInput,
        normalized_input: attemptedInput,
        attempted_inputs: attemptedInput == null ? [] : [attemptedInput],
        candidates: [],
      },
      retry: { allowed: false, mode: 'after_user_correction', max_attempts: 0 },
      circuit_breaker: { tripped: true, scope: 'remaining_batch', action: 'abort_remaining_calls' },
      correction: {
        required: ['instrument_full_name_or_windcode'],
        requires_user_input: true,
        user_prompt: '请提供该标的的准确全称或 Wind 标准代码。',
        preserve_server_type: true,
        preserve_tool_name: true,
      },
    });
  };
  const dieBackend = (error, fallbackCode = 'UNKNOWN') => {
    const backendError = error && typeof error === 'object'
      ? error
      : { message: String(error ?? '') };
    const message = backendError.message || JSON.stringify(backendError);
    const inferredCode = inferErrorCode(message);
    const code = inferredCode === 'UNKNOWN' ? fallbackCode : inferredCode;
    dieMcp(code, message, { backendError });
  };
  let resp;
  try {
    resp = await fetchWithRetry(
      fetch,
      server.endpoint,
      () => ({
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      }),
      {
        attempts: 3,
        delaysMs: [300, 1000],
        onAttemptError: process.env.WIND_DEBUG === '1'
          ? (err, attempt, total) => {
            const causeCode = err?.cause?.code || err?.code || 'UNKNOWN_CAUSE';
            process.stderr.write(`[wind-mcp fetch retry ${attempt}/${total}] ${causeCode}: ${err?.message || err}\n`);
          }
          : null,
      },
    );
  } catch (err) {
    dieBackend({
      message: err?.message || String(err),
      ...(err?.code ? { code: err.code } : {}),
      ...(err?.cause?.code ? { cause_code: err.cause.code } : {}),
    }, 'NETWORK_ERROR');
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    const code = HTTP_ERROR_MAP[resp.status]?.[0] || 'UNKNOWN';
    const detail = `HTTP ${resp.status} ${resp.statusText} (server=${server_type})` + (bodyText ? ` | body: ${bodyText.slice(0, 200)}` : '');
    let backendError = null;
    try {
      backendError = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      backendError = bodyText ? { message: bodyText.slice(0, 2000) } : null;
    }
    dieMcp(code, detail, { backendError });
  }

  const text = await resp.text();
  let payload;
  try {
    payload = parseSSE(text);
  } catch (err) {
    die('TOOL_RUNTIME_ERROR', `${err.message} (server=${server_type})`);
  }

  if (payload.error) {
    const msg = typeof payload.error === 'string'
      ? payload.error
      : (payload.error.message || JSON.stringify(payload.error));
    if (/^\s*OK\s*$/i.test(msg)) {
      dieMcp(
        'TOOL_RUNTIME_ERROR',
        `JSON-RPC protocol conflict: payload.error is present but error message is "OK"; error=${JSON.stringify(payload.error).slice(0, 1000)} (server=${server_type})`,
      );
    }
    dieBackend(payload.error, 'TOOL_RUNTIME_ERROR');
  }

  if (payload.result?.isError) {
    const msg = payload.result.content?.[0]?.text || JSON.stringify(payload.result);
    if (/^\s*OK\s*$/i.test(msg)) {
      dieMcp(
        'TOOL_RUNTIME_ERROR',
        `MCP result protocol conflict: isError=true but error text is "OK"; result=${JSON.stringify(payload.result).slice(0, 1000)} (server=${server_type})`,
      );
    }
    let raw;
    try {
      raw = JSON.parse(msg);
    } catch {
      raw = { message: msg };
    }
    dieBackend(raw?.error || raw, 'TOOL_RUNTIME_ERROR');
  }

  // 部分工具把业务错误包在 content[0].text 的 JSON 字符串里, 必须二次解析
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
        dieBackend({ code: inner.mcp_tool_error_code, message: msg }, 'TOOL_RUNTIME_ERROR');
      }
      if (inner.error && (inner.error.code || inner.error.message) && !isExplicitNoDataResult(inner)) {
        const errorMessage = inner.error.message || JSON.stringify(inner.error);
        const inferredCode = inferErrorCode(errorMessage);
        if (businessPayloadHasUsableData(inner) && inferredCode === 'UNKNOWN') {
          responseWarnings.push({
            code: 'BACKEND_ERROR_WITH_DATA',
            backend_error: inner.error,
            message: '后端同时返回错误信息和可用数据；已保留数据并标记为部分成功，请勿忽略该警告。',
          });
        } else {
          dieBackend(inner.error, 'TOOL_RUNTIME_ERROR');
        }
      }
      const businessClassification = classifyBusinessResponse(inner, server_type);
      if (businessClassification?.error) {
        const [code, message] = businessClassification.error;
        dieMcp(code, message, { backendError: inner.data });
      }
      if (businessClassification?.warning) responseWarnings.push(businessClassification.warning);
    }
  }

  if (responseWarnings.length && payload.result && typeof payload.result === 'object') {
    payload.result[INTERNAL_WARNINGS_KEY] = responseWarnings;
  }
  return payload.result;
}

async function mcpInitializeAndCall(server_type, method, params, diagnosticContext = null) {
  await mcpRequest(server_type, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: {
      name: SKILL_NAME,
      version: SKILL_VERSION
    },
  }, {
    timeoutMs: 30_000
  });

  return mcpRequest(server_type, method, params, {
    timeoutMs: 600_000,
    diagnosticContext,
  });
}

// section: 命令

async function cmdCall(server_type, toolName, paramsInput) {
  if (!server_type || !toolName || !paramsInput) {
    exitWithUsage(
      `用法：call <server_type> <tool_name> '<params_json>|@params_file'\n` +
      `可用 server_type: ${Object.keys(SERVERS).join(' / ')}\n` +
      `典型：\n  ${CALL_EXAMPLES.join('\n  ')}`,
      1,
    );
  }

  let paramsSource;
  try {
    paramsSource = loadParamsInput(paramsInput);
  } catch (e) {
    die('PARAMS_FILE_ERROR', e.message, 1, {
      details: { field: 'params', issue: 'file_read_error', source: 'file', file: e.file || null },
      retry: { allowed: true, mode: 'after_correction', max_attempts: 1 },
      circuit_breaker: { tripped: true, scope: 'remaining_batch', action: 'abort_remaining_calls' },
      correction: { change_only: ['params_file'], strategy: 'fix_file_path_or_permissions', requires_user_input: false, preserve_server_type: true, preserve_tool_name: true },
    });
  }

  let args;
  try {
    args = JSON.parse(paramsSource.jsonText);
  } catch (e) {
    const sourceDetail = paramsSource.source === 'file'
      ? `文件：${paramsSource.filePath}`
      : `原文：${paramsSource.jsonText.slice(0, 200)}`;
    die('INVALID_PARAMS_JSON', `params JSON 解析失败：${e.message} | ${sourceDetail}`, 1, {
      details: {
        field: 'params',
        issue: 'invalid_json',
        source: paramsSource.source,
        ...(paramsSource.filePath ? { file: paramsSource.filePath } : {}),
        message: e.message,
      },
      retry: { allowed: true, mode: 'after_correction', max_attempts: 1 },
      circuit_breaker: { tripped: true, scope: 'remaining_batch', action: 'abort_remaining_calls' },
      correction: { change_only: [paramsSource.source === 'file' ? 'params_file_content' : 'params_json'], strategy: 'fix_json_syntax', requires_user_input: false, preserve_server_type: true, preserve_tool_name: true },
    });
  }

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    const actualType = Array.isArray(args) ? 'array' : typeof args;
    die('PARAM_TYPE_ERROR', 'params 必须是 JSON object', 1, {
      details: [{ field: 'params', issue: 'invalid_type', expected_type: 'object', actual_type: actualType }],
      retry: { allowed: true, mode: 'after_correction', max_attempts: 1 },
      circuit_breaker: { tripped: true, scope: 'remaining_batch', action: 'abort_remaining_calls' },
      correction: { change_only: ['params'], strategy: 'fix_from_error_details', requires_user_input: false, preserve_server_type: true, preserve_tool_name: true },
    });
  }

  const originalArgs = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : args;
  let normalizationErrors;
  ({ server_type, toolName, args, normalizationErrors } = normalizeCall(server_type, toolName, args));
  validateToolSelection(server_type, toolName);

  const validationErrors = [...normalizationErrors, ...validateBasicParams(args, toolName)];
  const paramsShapeInvalid = validationErrors.some(error => validationErrorCode(error) === 'PARAM_TYPE_ERROR' && error.field === 'params');
  if (!paramsShapeInvalid) validationErrors.push(...validateToolParams(toolName, args));
  if (validationErrors.length > 0) {
    const explicitCode = validationErrors.map(validationErrorCode).find(Boolean);
    const messages = validationErrors.map(validationErrorMessage);
    const hasTypeError = validationErrors.some(error => typeof error === 'object' && error?.issue === 'invalid_type');
    die(explicitCode || (hasTypeError ? 'PARAM_TYPE_ERROR' : 'PARAM_VALIDATION_ERROR'), messages.join('；'), 1, {
      details: validationErrors.map(error => typeof error === 'string' ? { message: error } : { ...error, code: undefined, message: undefined }),
      retry: { allowed: true, mode: 'after_correction', max_attempts: 1 },
      circuit_breaker: { tripped: true, scope: 'remaining_batch', action: 'abort_remaining_calls' },
      correction: {
        change_only: [...new Set(validationErrors.flatMap(error => error?.field ? [error.field] : error?.fields || []))],
        strategy: 'fix_from_error_details',
        requires_user_input: validationErrors.some(error => ['ambiguous_value', 'conflicting_aliases'].includes(error?.issue)),
        preserve_server_type: true,
        preserve_tool_name: true,
      },
    });
  }

  const result = await mcpInitializeAndCall(server_type, 'tools/call', {
    name: toolName,
    arguments: args,
    _meta: { clientVersion: SKILL_VERSION },
  }, {
    original_input: originalArgs && typeof originalArgs === 'object' ? originalArgs.windcode : null,
    normalized_input: args && typeof args === 'object' ? args.windcode : null,
  });
  return {
    server_type,
    tool: toolName,
    result,
  };
}

async function cmdListTools(server_type) {
  if (!server_type) {
    exitWithUsage(
      `用法：list-tools <server_type>\n` +
      `可用 server_type: ${Object.keys(SERVERS).join(' / ')}`,
      1,
    );
  }
  getServer(server_type);
  const result = await mcpInitializeAndCall(server_type, 'tools/list', {});
  return { server_type, ...result };
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
    die('SETUP_ERROR', `setup-key 未知 scope: ${scope} (可选: global / skill)`);
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
    die('SETUP_ERROR', `配置写入失败 (scope=${scope}, path=${file || 'n/a'}): ${err.message}`);
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
    die('SETUP_ERROR', `本地无法启动浏览器: ${spawnError.message} | 用户应手动打开 ${data.url}`);
  }
  return data;
}

// 诊断: 输出自动更新状态
async function cmdDiagnose() {
  let updateState = null;
  try {
    const stateFile = updateStateFile();
    if (existsSync(stateFile)) {
      updateState = JSON.parse(readFileSync(stateFile, 'utf8'));
    }
  } catch {
    updateState = { status: 'unreadable' };
  }
  return {
    platform: process.platform,
    node_pid: process.pid,
    update_scope: updateScope(),
    update_state_file: updateStateFile(),
    update_state: updateState,
    next_update_needed: !alreadyUpdatedToday(),
  };
}

// section: 主入口 — IS_MAIN guard 让单元测试 import 不副作用
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (IS_MAIN) runMain();

function runMain() {
  const [cmd, ...args] = process.argv.slice(2);

  const USAGE =
    `wind-mcp-skill\n` +
    `访问万得 Wind 金融数据（按数据域分类调用）\n\n` +
    `用法:\n` +
    `  cli.mjs call <server_type> <tool_name> '<params_json>|@params_file'\n` +
    `  cli.mjs list-tools <server_type>                    # 获取后端官方工具描述和 inputSchema\n` +
    `  cli.mjs open-portal                                # 打开万得开发者中心拿 API Key\n` +
    `  cli.mjs setup-key <KEY> --scope <global|skill>     # 配置 API Key（先问用户存放位置）\n\n` +
    `可用 server_type:\n` +
    Object.entries(SERVERS).map(([k, v]) => `  ${k.padEnd(20)}${v.label}`).join('\n') + '\n\n' +
    `典型:\n` +
    `  ${CALL_EXAMPLES.join('\n  ')}`;

  const commands = {
    call: () => cmdCall(args[0], args[1], args[2]),
    'list-tools': () => cmdListTools(args[0]),
    'open-portal': () => cmdOpenPortal(),
    'setup-key': () => cmdSetupKey(...args),
    diagnose: () => cmdDiagnose(),
  };

  if (!cmd) {
    // help: 直接输出 USAGE 纯文本
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  if (!commands[cmd]) {
    die('USAGE_ERROR', `未知命令: ${cmd}\nUSAGE:\n${USAGE}`);
  }

  commands[cmd]()
    .then((data) => {
      if (cmd === 'call') {
        // call: 透传 result 内容 (parse JSON if applicable, else raw text)
        writeRawCallSuccess(data?.result, { server_type: data?.server_type, tool_name: data?.tool });
        setTimeout(triggerUpdateCheck, 0);
      } else {
        // open-portal / setup-key: 直接输出结构化数据 (无 envelope 包裹)
        writePlainSuccess(data);
      }
    })
    .catch((err) => {
      die('UNKNOWN', `执行失败: ${err.message || err}${err.stack ? ' | stack: ' + err.stack.slice(0, 300) : ''}`);
    });
}
