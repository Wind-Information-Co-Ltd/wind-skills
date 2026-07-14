import randomUUID from "./uuidv7.js";
import {
  formatLocalFileLink,
  sanitizeAgentResultTextForDelivery,
} from "./agentResultSanitize.js";
import { spawnUpdateCheck } from "./update-check.mjs";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, parse as parsePath, resolve as resolvePath, sep as pathSep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_API_URL = "https://mcp.wind.com.cn/skills/alice";
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url))); // .../wind-alice
const WIND_AIFINMARKET_PORTAL = "https://aifinmarket.wind.com.cn";

// 服务端在 agentResult 中给出的 `/project/xxx` 是 Alice 工作区相对路径，需要拼成
// 完整下载 URL 才能由 CLI 自动拉取：
//   ${WIND_PROJECT_FILES_PREFIX}<contextId>/project/<filename>
// 其中 contextId 取自本次请求体里 `params.message.contextId`（与服务端实际采纳的会话一致）。
// 公开 API 路径前缀（非密钥）；可通过环境变量 WIND_PROJECT_FILES_PREFIX 覆盖。
const DEFAULT_WIND_PROJECT_FILES_PREFIX = [
  "https://alice.wind.com.cn",
  "/weaver/files/",
  "alice-convo-",
  "1416751125",
  "/sessions/",
].join("");
const WIND_PROJECT_FILES_PREFIX =
  process.env.WIND_PROJECT_FILES_PREFIX ?? DEFAULT_WIND_PROJECT_FILES_PREFIX;

// 当前请求的 contextId，供下载阶段把 `/project/...` 相对路径补全为完整 URL；每次请求开始前重置。
let currentSessionContextId = null;

/**
 * 体验账户当日额度耗尽时，服务端会通过 status-update / UIState 里的
 * A2A.Markdown 投递这段中文提示；命中后直接停止后续处理。
 */
const WIND_TRIAL_DAY_QUOTA_SNIPPET =
  "很抱歉，今日已超出体验期任务限额，欢迎您明日再来尝试。";

// 模块单例：单次进程内只触发一次"token已使用完"的处理，避免在
// 流里多次重复打印 / 抛错。
let windTrialQuotaHandled = false;

export class WindTrialQuotaExceeded extends Error {
  constructor() {
    super("WIND_TRIAL_DAY_QUOTA");
    this.name = "WindTrialQuotaExceeded";
  }
}

function logWindTrialQuotaIfPresent(events) {
  if (windTrialQuotaHandled || !Array.isArray(events) || events.length === 0) {
    return;
  }
  for (const ev of events) {
    let text;
    try {
      text = JSON.stringify(ev);
    } catch {
      continue;
    }
    if (text.includes(WIND_TRIAL_DAY_QUOTA_SNIPPET)) {
      windTrialQuotaHandled = true;
      console.error("token已使用完");
      throw new WindTrialQuotaExceeded();
    }
  }
}

// 已知 Alice Skill 清单。
// 触发方式：根据 portal 抓包，服务端通过 prompt 文本前缀来识别 Skill：
//   问句含中文 → `使用「<nameZh>」技能：<原 prompt>`
//   问句全英文 → `Using "<nameEn>" skill:<原 prompt>`
// --skill 解析后仍须拿到标准 nameEn / nameZh 才能拼出正确前缀。
// --skill 参数同时支持中文名（nameZh）和英文名（nameEn）：
//   - 字面精确匹配 nameEn / nameZh
//   - normalize 后匹配（忽略大小写/空白/连字符/下划线 等，对中文无副作用）
//   命中后统一回填标准 nameEn / nameZh，拼前缀时按问句语言二选一。
export const KNOWN_SKILLS = [
  {
    nameZh: "通胀情景债券轮动策略",
    nameEn: "Inflation Bond Strategy",
    descZh:
      "实时追踪 CPI/PPI 四种通胀拐点信号，自动判断当月持有债券或转持货币基金（可空仓模式），或在 5/7/10 年期国债指数间做久期轮动（不可空仓模式）；支持风险预算约束下的配置优化与历史净值回测。",
    descEn:
      "Continuously tracks four inflation turning-point signals from CPI/PPI; toggles between bonds and money-market funds (long/flat) or rotates duration across 5/7/10Y government bond indices (fully invested). Supports risk-budget allocation optimization and historical NAV backtesting.",
  },
  {
    nameZh: "宏观数据解读",
    nameEn: "Macro Data Interpretation",
    descZh:
      "把宏观经济数据（CPI、PPI、PMI、GDP、社融、外贸、失业率、利率等）解读为研究周报式分析：结论摘要、核心数据、趋势/结构分析、后续跟踪展望。面向买方研究、宏观策略、财富管理顾问。",
    descEn:
      "Transforms macro indicators (CPI, PPI, PMI, GDP, credit, trade, unemployment, rates) into structured research commentary covering conclusions, core data, trend/structural drivers, and forward tracking. Built for buy-side analysts, macro strategists, and wealth advisors.",
  },
  {
    nameZh: "按主题选股",
    nameEn: "Thematic Stock Screening",
    descZh:
      "面向赛道投资、产业链机会挖掘、概念股筛选：拆解市场交易主线，结合关键数据验证逻辑兑现度，筛出真正受益标的，并给出估值历史分位与交易视角建议。",
    descEn:
      "Sector / supply-chain / concept stock screening: deconstructs the traded market narrative, validates logic maturity with key data, surfaces true beneficiaries, and adds historical PE percentile and actionable trading view.",
  },
  {
    nameZh: "债券利率走势研判",
    nameEn: "Bond Rate Outlook",
    descZh:
      "系统化债券利率研判框架，自适应交易（1-2 周）/ 策略（1-6 月）/ 配置（6 月-2 年）三视角；覆盖宏观、流动性、供需、曲线、技术情绪五维度，结合量化评分与压力测试输出利率判断与债券交易/配置策略。",
    descEn:
      "Systematic bond-rate framework adaptive across trading (1-2w), strategy (1-6m), and allocation (6m-2y) horizons. Covers macro, liquidity, supply-demand, curve, and technical-sentiment dimensions with quant scoring and stress tests to drive trading/allocation calls.",
  },
  {
    nameZh: "信用分析",
    nameEn: "Credit Analysis",
    descZh:
      "覆盖主体信用、行业风险、财务健康度、现金流质量、评级对标、违约概率建模，集成 Wind 风险评分系统，为债券投资与风险管理提供定量依据。敏感性分析与回收率估算请用 credit-sensitivity-recovery 技能。",
    descEn:
      "Issuer credit, industry risk, financial health, cash-flow quality, rating benchmarking, and default-probability modeling — integrated with Wind risk scoring. For sensitivity / recovery analysis use credit-sensitivity-recovery instead.",
  },
  {
    nameZh: "基金对比分析",
    nameEn: "Fund Compare",
    descZh:
      "对多只基金做全维度对比：业绩表现、风险指标、持仓结构、管理评估，输出专业对比报告，支持客观中立或主观倾向性分析。",
    descEn:
      "Comprehensive comparison of multiple funds across performance, risk, portfolio structure, and management — producing a professional report supporting both neutral and biased analyses.",
  },
  {
    nameZh: "基金筛选与投资建议",
    nameEn: "Fund Screening & Investment Advisory",
    descZh:
      "面向投顾：按风险偏好、投资目标、期限多维度筛基金，对比业绩/风险/持仓/经理等指标，产出结构化分析报告与配置建议，匹配投资者画像。",
    descEn:
      "For investment advisors: multi-dimensional fund filtering by risk appetite, objectives, and horizon; compares performance, risk, holdings, and managers; outputs structured analysis with allocation suggestions aligned to the investor profile.",
  },
  {
    nameZh: "投资标的创意与筛选",
    nameEn: "Investment Idea Generation",
    descZh:
      "全市场主动发掘机会：量化因子（价值/成长/质量/做空/特殊事件）+ 主题驱动扫描；可指定行业、市值、地区、风格，自动完成数据筛选、可比对标、估值分析，输出含逻辑、催化剂、风险的一页纸标的报告。",
    descEn:
      "Proactively surfaces ideas via quant factor screens (value/growth/quality/short/special situations) and thematic sweeps with sector/cap/geo/style filters. Outputs a one-page idea memo with thesis, catalysts, and key risks.",
  },
  {
    nameZh: "公司一页纸",
    nameEn: "Company One-Page Investment Memo",
    descZh:
      "为上市公司（A 股 / 港股 / 美股 等）生成一页纸投资报告：自动汇总财务、研报观点、公告、新闻，输出公司速览、投资逻辑、催化剂、跟踪指标、财务/估值、风险与操作建议。适用于晨会、投决会、调研前快速分析。",
    descEn:
      "One-page investment memo for listed companies across global markets (A-share / HK / US, etc.). Auto-aggregates financials, broker views, filings, and news into overview, thesis, catalysts, tracking metrics, valuation, and recommendation. Ideal for morning meetings, IC prep, and pre-research briefings.",
  },
  {
    nameZh: "上市公司调研问题清单",
    nameEn: "Stock DD List",
    descZh:
      "一键生成买方视角的上市公司调研问题清单：检索财务、研报观点、行业动态、市场预期，输出含数据驱动看多/看空摘要 + 3-5 个深度议题的针对性管理层调研问题，支持 A 股、港股、海外。",
    descEn:
      "Generates a buy-side DD question list: gathers financials, broker research, industry news, consensus; outputs a structured memo with bull/bear thesis and 3-5 deep-dive topics with pointed questions for management meetings. A-share, HK, and overseas supported.",
  },
  {
    nameZh: "全球上市公司季报点评",
    nameEn: "Global Share Quarterly Earnings Review",
    descZh:
      "标准卖方研究风格的财报点评：输入公司 + 报告期，自动完成数据提取、盈利能力分析、投资逻辑、盈利预测引用与风险提示，输出「标题 + 五段式正文」一页纸；覆盖 A/港/美/欧并适配本地披露规则，可识别业绩快报场景。",
    descEn:
      "Sell-side style earnings review: extracts financials, analyzes profitability, synthesizes thesis, references consensus, flags risks. Produces a one-page 'title + 5-paragraph body' commentary across A-share, HK, US, and Europe with local-disclosure adaptation; also handles preliminary earnings.",
  },
  {
    nameZh: "市场规模测算与战略建模",
    nameEn: "Market Sizing & Strategic Modeling",
    descZh:
      "面向咨询顾问、企业战略、投资专业人士：围绕特定市场/细分赛道/产品机会，搭建结构化、可验证的市场规模模型，覆盖市场定义、需求拆解、关键驱动、假设、Top-down/Bottom-up/交叉验证、历史回溯、增长预测、情景与敏感性分析。",
    descEn:
      "For consultants, corp-strategy teams, and investors: builds defensible market sizing models covering definition, demand decomposition, drivers, assumptions, top-down/bottom-up/triangulation, historical backfill, growth forecasts, and scenario/sensitivity testing.",
  },
  {
    nameZh: "可比公司分析",
    nameEn: "Comps Analysis",
    descZh:
      "构建机构级可比公司分析（Comps Analysis），以 Excel 表格 + 文字分析报告输出：覆盖经营指标、估值倍数对比、统计基准分析。触发词：comps analysis / comparable companies / peer analysis / relative valuation / valuation multiples / EV/EBITDA comps / peer benchmark / trading comps。",
    descEn:
      "Institutional-grade comparable company analysis with operating metrics, valuation multiples, and statistical benchmarking in Excel/spreadsheet format. Best for public valuation, peer benchmarking, IPO/funding pricing, outlier identification, IC support, and sector overviews. Not ideal for private cos without listed peers, conglomerates, distressed names, or pre-revenue startups.",
  },
  {
    nameZh: "事实核验",
    nameEn: "Fact Check",
    descZh:
      "核查从外部渠道获取的金融信息是否准确：粘贴一段含金融数据/公司声明/行业事件的文字，逐点验证其中数据与事实，生成结构化核查报告。",
    descEn:
      "Verify accuracy of financial information from external sources: paste a passage containing financial data, corporate claims, or industry events, and get a structured, point-by-point verification report.",
  },
];

function normalizeSkillName(s) {
  // 仅做大小写/分隔符层面的归一化，对中文字符无副作用：
  // 小写化 + 去掉空白、连字符、下划线、& 与中英文引号。
  return String(s || "")
    .toLowerCase()
    .replace(/[\s\-_&"'`“”‘’]+/g, "");
}

/**
 * 常见口语/误称 → 标准 nameEn。仅收录与某一 KNOWN_SKILLS 项一一对应、
 * 且用户极易把「产出物名称」（如信用报告）当成 Skill 名的别名。
 */
const SKILL_ALIAS_ENTRIES = [
  {
    nameEn: "Credit Analysis",
    aliases: ["信用报告", "信用分析报告", "credit report"],
  },
  {
    nameEn: "Company One-Page Investment Memo",
    aliases: ["一页纸", "投资备忘", "one pager", "one-pager"],
  },
  {
    nameEn: "Stock DD List",
    aliases: ["调研问题清单", "调研清单", "dd list"],
  },
  {
    nameEn: "Global Share Quarterly Earnings Review",
    aliases: ["季报点评", "财报点评", "earnings review"],
  },
  {
    nameEn: "Comps Analysis",
    aliases: ["可比分析", "comps"],
  },
];

const SKILL_ALIAS_MAP = new Map(
  SKILL_ALIAS_ENTRIES.flatMap(({ nameEn, aliases }) =>
    aliases.map((alias) => [normalizeSkillName(alias), nameEn]),
  ),
);

/**
 * 解析用户传入的 --skill 值，支持中英文。
 * 匹配优先级（命中即停）：
 *   1) 与 nameEn 字面相等（区分大小写）
 *   2) 与 nameZh 字面相等
 *   3) normalize(nameEn) 相等（忽略大小写/空白/连字符/下划线 等）
 *   4) normalize(nameZh) 相等
 *   5) SKILL_ALIAS_MAP 口语/误称别名（如「信用报告」→「信用分析」）
 * 命中后统一回填 **标准 nameEn / nameZh**（拼前缀时按问句语言二选一）。
 * 未命中返回 { name: 原字符串, matched: false }，调用方据此 [warn] 并按字面值提交。
 */
export function resolveSkillName(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const exactEn = KNOWN_SKILLS.find((s) => s.nameEn === raw);
  if (exactEn) return { name: exactEn.nameEn, matched: true, entry: exactEn, matchedBy: "nameEn" };

  const exactZh = KNOWN_SKILLS.find((s) => s.nameZh === raw);
  if (exactZh) return { name: exactZh.nameEn, matched: true, entry: exactZh, matchedBy: "nameZh" };

  const norm = normalizeSkillName(raw);
  const fuzzyEn = KNOWN_SKILLS.find(
    (s) => normalizeSkillName(s.nameEn) === norm,
  );
  if (fuzzyEn) return { name: fuzzyEn.nameEn, matched: true, entry: fuzzyEn, matchedBy: "nameEn(fuzzy)" };

  const fuzzyZh = KNOWN_SKILLS.find(
    (s) => normalizeSkillName(s.nameZh) === norm,
  );
  if (fuzzyZh) return { name: fuzzyZh.nameEn, matched: true, entry: fuzzyZh, matchedBy: "nameZh(fuzzy)" };

  const aliasTargetEn = SKILL_ALIAS_MAP.get(norm);
  if (aliasTargetEn) {
    const aliasEntry = KNOWN_SKILLS.find((s) => s.nameEn === aliasTargetEn);
    if (aliasEntry) {
      return {
        name: aliasEntry.nameEn,
        matched: true,
        entry: aliasEntry,
        matchedBy: "alias",
        aliasFrom: raw,
      };
    }
  }

  return { name: raw, matched: false, entry: null, matchedBy: null };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = (...names) => {
    for (const name of names) {
      const idx = args.indexOf(name);
      if (idx !== -1) return args[idx + 1];
    }
    return undefined;
  };
  const has = (...names) => names.some((n) => args.includes(n));

  const command = args[0] && !args[0].startsWith("-") ? args[0] : undefined;
  const prompt = get("--prompt", "-p");
  const skill = get("--skill", "-s");

  return {
    command,
    prompt,
    skill,
    listSkills: has("--list-skills"),
    help: has("--help", "-h"),
  };
}

function parseDotenv(content) {
  const env = {};
  for (const rawLine of content.split("\n")) {
    let line = rawLine.replace(/^﻿/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(" #");
      if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    }
    env[key] = val;
  }
  return env;
}

function getApiUrl() {
  return process.env.WIND_ALICE_API_URL || DEFAULT_API_URL;
}

function die(code, message, { extraHint } = {}) {
  const payload = { code, message, ...(extraHint ? { hint: extraHint } : {}) };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
  throw new Error(message);
}

function getApiKey() {
  // 全局 Key 存储位置（与其它 wind 技能可共用）
  const globalConfig = join(homedir(), ".wind-aifinmarket", "config");
  if (existsSync(globalConfig)) {
    try {
      const env = parseDotenv(readFileSync(globalConfig, "utf8"));
      const key = env.WIND_API_KEY?.trim();
      if (key) return key;
    } catch {}
  }

  const localConfig = join(SKILL_DIR, "config.json");
  if (existsSync(localConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(localConfig, "utf8"));
      const key =
        typeof cfg.wind_api_key === "string" ? cfg.wind_api_key.trim() : "";
      if (key) return key;
    } catch {}
  }

  const envKey = process.env.WIND_API_KEY?.trim();
  if (envKey) return envKey;

  die("KEY_MISSING", "WIND_API_KEY 未配置", {
    extraHint:
      `CLI 已完整检查：用户全局配置 > Skill 本地配置 > WIND_API_KEY 环境变量；不要再手动检查部分来源。\n` +
      `① 获取 Key：访问 ${WIND_AIFINMARKET_PORTAL}（未登录通常会跳转登录页）。\n` +
      `② 选择 Key 存放位置：\n` +
      `   A. 全局共享【推荐 — 所有 wind skill 共用】：%USERPROFILE%\\.wind-aifinmarket\\config\n` +
      `      内容：WIND_API_KEY=<KEY>\n` +
      `   B. 仅当前 skill：${join(SKILL_DIR, "config.json")}\n` +
      `      内容：{"wind_api_key":"<KEY>"}\n` +
      `   C. 临时会话：在终端 set / $env:WIND_API_KEY=<KEY>\n` +
      `③ 重试原命令`,
  });
}

function buildHeaders(apiKey) {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function resubscribeBody({ taskId, contextId, params }) {
  return {
    jsonrpc: "2.0",
    method: "tasks/resubscribe",
    params: {
      id: taskId || params?.params?.message?.taskId,
      contextId: contextId || params?.params?.message?.contextId,
    },
    id: randomUUID(),
  };
}

/** 问句是否包含中日韩统一表意文字（用于选择中/英文 Skill 前缀）。 */
export function containsChinese(text) {
  return /[\u3400-\u9fff]/.test(String(text || ""));
}

/**
 * 按问句语言拼 Skill 文本前缀。
 * @param {string} prompt
 * @param {{ nameEn: string, nameZh?: string|null }} skill
 * @returns {string}
 */
export function buildSkillPrefixText(prompt, skill) {
  const nameEn = String(skill?.nameEn || "").trim();
  const nameZh = String(skill?.nameZh || "").trim();
  if (containsChinese(prompt) && nameZh) {
    return `使用「${nameZh}」技能：`;
  }
  return `Using "${nameEn}" skill:`;
}

/**
 * 构造调用 Alice Agent 的请求体。
 * @param {string} prompt    用户原始问题
 * @param {{ nameEn: string, nameZh?: string|null }|null} skill  Skill 名；null 则直接使用 prompt
 *
 * 有 skill 时按问句语言拼前缀（中文问句 → 使用「nameZh」技能：；全英文 → Using "nameEn" skill:）。
 */
function buildBody(prompt, skill = null) {
  const text = skill ? `${buildSkillPrefixText(prompt, skill)}${prompt}` : prompt;
  return {
    jsonrpc: "2.0",
    method: "message/stream",
    params: {
      message: {
        messageId: randomUUID(),
        role: "user",
        kind: "message",
        parts: [
          { kind: "text", text },
          {
            kind: "data",
            data: {
              chatMode: "12",
              originalChatMode: "4",
              switchMode: "auto",
              timezone: "Asia/Shanghai",
            },
            metadata: {
              key: "Wind.WindSearch.ChatService.A2A",
              version: "1.0.0",
            },
          },
        ],
        contextId: randomUUID(),
        taskId: randomUUID(),
      },
    },
    id: randomUUID(),
  };
}

/** @internal 单测：暴露 buildBody 以便断言 Skill 前缀行为。 */
export function __buildBodyForTesting(prompt, skill = null) {
  return buildBody(prompt, skill);
}

function usage() {
  return [
    "wind-alice — 调用万得 Alice Agent，执行指定 Skill 并流式输出分析结果",
    "",
    "Usage:",
    '  wind-alice --prompt <QUESTION> [--skill <SKILL_NAME>]',
    "  wind-alice list-skills",
    "  wind-alice --help",
    "",
    "Options:",
    "  --prompt, -p <QUESTION>     用户提问（必填，list-skills 除外）",
    "  --skill,  -s <SKILL_NAME>   要执行的 Alice Skill 名，**中英文均可**：",
    "                                · 中文：如 \"上市公司调研问题清单\"",
    "                                · 英文：如 \"Stock DD List\"",
    "                                · 口语别名：如 \"信用报告\" → \"信用分析\"",
    "                              英文部分忽略大小写/空格/连字符/下划线模糊匹配。",
    "                              不传则走 auto。",
    "  --list-skills               列出已知 Skill（等同子命令 list-skills）",
    "  --help,   -h                查看帮助",
    "",
    "Env:",
    "  WIND_ALICE_API_URL          可选；默认 " + DEFAULT_API_URL,
    "  WIND_API_KEY                可选；配置文件均未提供时读取",
    "",
    "Config (按优先级):",
    `  ${join(homedir(), ".wind-aifinmarket", "config")}  (dotenv: WIND_API_KEY=...)`,
    `  ${join(SKILL_DIR, "config.json")}   (JSON: {"wind_api_key":"..."})`,
    "  WIND_API_KEY 环境变量",
  ].join("\n");
}

function printSkillList() {
  const total = KNOWN_SKILLS.length;
  console.log(`已知 Alice Skill（共 ${total} 项）：\n`);
  for (const s of KNOWN_SKILLS) {
    console.log(`- "${s.nameEn}"`);
    console.log(`    中文名：${s.nameZh}`);
    console.log(`    说明：  ${s.descZh}`);
  }
  console.log(
    "\n用法：wind-alice --prompt \"你的问题\" --skill \"<Skill 名（中/英）>\"",
  );
  console.log(
    "提示：--skill 支持中文名（nameZh）、英文名（nameEn）及常见口语别名（如「信用报告」→「信用分析」）；英文部分忽略大小写与空白/连字符/下划线的模糊匹配。问句含中文时前缀为「使用「nameZh」技能：」，全英文时为 Using \"nameEn\" skill:。",
  );
}

export function parseSsePayload(payload) {
  return payload
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!data) return [];

      try {
        return [JSON.parse(data)];
      } catch (error) {
        console.error("failed to parse SSE event:");
        console.error(block);
        console.error(error);
        return [];
      }
    });
}

export function extractAgentResultValues(events) {
  return events.flatMap((event) => {
    const artifact = event?.result?.artifact;
    if (
      event?.result?.kind !== "artifact-update" ||
      artifact?.name !== "agentResult"
    ) {
      return [];
    }

    return (artifact.parts ?? []).flatMap((part) => {
      if (part?.kind !== "data") return [];
      const value = part?.data?.data;
      return value === undefined ? [] : [value];
    });
  });
}

/**
 * 从 Alice 服务端的 `result.isError` 形态错误中提取可读文本。
 *
 * 服务端在认证失败、余额不足等场景会返回 HTTP 200 + JSON-RPC 响应：
 *   { jsonrpc: "2.0", result: { isError: true, content: [{ text: "余额不足，请先充值", type: "text" }] } }
 * 这不是 JSON-RPC 标准的 `error` 字段，旧的 consumeNonStreamBody 无法识别，
 * 会静默成功退出、用户看不到任何错误提示。
 *
 * 返回拼接后的错误文本（可能多段）；非 isError 响应返回 null。
 */
export function extractResultErrorText(event) {
  const result = event?.result;
  if (!result || typeof result !== "object" || result.isError !== true) {
    return null;
  }
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts = parts
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean);
  return texts.length > 0 ? texts.join("\n") : null;
}

/**
 * 从 SSE 事件中提取服务端下发的真实 taskId / contextId。
 * 服务端偶尔会重签发 contextId（如客户端预生成 ID 被拒绝），不刷新会导致
 * `/project/xxx` 拼出指向错误会话的下载 URL、下载失败。
 */
export function extractServerTaskIds(event) {
  const result = event?.result;
  if (!result || typeof result !== "object") return null;

  const taskId =
    (typeof result.taskId === "string" && result.taskId) ||
    (typeof result.id === "string" && result.id) ||
    null;
  const contextId =
    (typeof result.contextId === "string" && result.contextId) || null;

  if (!taskId || !contextId) return null;
  return { taskId, contextId };
}

function refreshSessionContextIdFromEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  for (const ev of events) {
    const ids = extractServerTaskIds(ev);
    if (ids?.contextId) {
      currentSessionContextId = ids.contextId;
      return;
    }
  }
}

/** @internal 单测专用：在不发起真实请求的前提下注入当前会话 contextId，
 *  让 collectDownloadLinks 能把 /project/xxx 拼成完整 URL。生产代码请勿调用。 */
export function __setSessionContextIdForTesting(ctxId) {
  currentSessionContextId = ctxId ?? null;
}

/**
 * 从 agentResult.value 抽出可下载文件链接。
 *
 * 服务端常用以下两种写法（实测来自 portal 输出）：
 *   - Markdown 链接：`[文件名.md](https://aliceexp.wind.com.cn/weaver/files/<uuid>/<filename>)`
 *   - 裸 URL：直接拼在文末
 *
 * 文件接口受同一份 WIND_API_KEY 鉴权（与调用 Agent 接口同一个 Key），
 * 用户在浏览器外下载必须自带 `Authorization: Bearer <KEY>` 才能拿到内容。
 */
const FILE_EXT_WHITELIST = new Set([
  "md",
  "markdown",
  "xlsx",
  "xls",
  "csv",
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "txt",
  "zip",
  "rar",
  "7z",
  "png",
  "jpg",
  "jpeg",
  "svg",
  "html",
  "htm",
  "json",
]);

const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
// 排除 ] [ ( —— 避免把 `https://.../x.md](/project/x.md` 这类 Markdown 残片吃进 URL
const BARE_URL_RE = /https?:\/\/[^\s)<>"'`\[\]()]+/g;
// 形如 `[文件名](/project/xxx.md)` 的相对链接：仅 `/project/...` 这种 Alice 工作区路径
const PROJECT_REL_LINK_RE = /\[([^\]]+)\]\((\/project\/[^\s)]+)\)/g;
// 形如 `[文件名](file:///project/xxx.md)` —— Alice 部分场景用 file:// 协议给出工作区路径
const FILE_SCHEME_PROJECT_LINK_RE =
  /\[([^\]]+)\]\(file:\/\/\/?(\/project\/[^\s)]+)\)/gi;
// 正文裸文本中的 `file:///project/xxx.md`（无 markdown 包裹）
const FILE_SCHEME_PROJECT_PATH_RE =
  /(?<![/\w-])file:\/\/\/?(\/project\/[^\s`)<>"'，。、:：；\]\(]+\.[A-Za-z0-9]+)/gi;
// 形如 `/project/xxx.ext` 反引号包裹或正文裸文本中的工作区相对路径：
// Alice 部分场景下会用反引号或正文直述形式给出报告文件路径，而不是标准的
// [name](path) markdown 链接，此前 CLI 仅识别 markdown 链接形式，会导致报告附件漏抓 / 不下载。
// 这里要求：
//   1) 路径必须以已知扩展名结尾（FILE_EXT_WHITELIST 二次校验），避免抓到任意 /project/... 字符串；
//   2) lookbehind 排除前缀为 `/` 或字母数字 / `_` / `-` 的位置，从而跳过完整 HTTP URL（如
//      `https://host/project/xxx.md`）中已包含的 /project 片段，避免与 BARE_URL_RE 重复抓取。
// 排除 ] ( —— 避免 [/project/x.md](/project/x.md) 中 .md 后的 Markdown 残片被过度匹配
const PROJECT_REL_PATH_RE =
  /(?<![/\w-])\/project\/[^\s`)<>"'，。、:：；\]\(]+\.[A-Za-z0-9]+/g;

/**
 * 把 `/project/xxx` 这种 Alice 工作区相对路径拼成完整下载 URL。
 * 依赖 currentSessionContextId（由本次请求的 message.contextId 注入）。
 * 没有 contextId 时返回 null，调用方据此跳过。
 */
function buildSessionProjectFileUrl(relativePath) {
  if (!currentSessionContextId) return null;
  let path = String(relativePath || "").trim();
  if (!path) return null;
  if (!path.startsWith("/")) path = "/" + path;
  return `${WIND_PROJECT_FILES_PREFIX}${currentSessionContextId}${path}`;
}

function deriveFilenameFromUrl(url, fallback) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {}
  return fallback || "downloaded";
}

function looksLikeFileUrl(url) {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (path.includes("/files/")) return true;
  // 拒绝 pathname 含 Markdown 残片的畸形 URL（如 .../x.md](/project/x.md）
  if (/[\]\(\[]/.test(path)) return false;
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return FILE_EXT_WHITELIST.has(ext);
}

/** 从字符串中扫描所有可能的下载链接，返回 [{url, filename}]，已去重。 */
export function collectDownloadLinks(value) {
  if (value == null) return [];
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const found = new Map(); // url -> filename

  let m;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    const [, name, url] = m;
    if (!looksLikeFileUrl(url)) continue;
    if (!found.has(url)) {
      found.set(url, deriveFilenameFromUrl(url, name));
    }
  }

  // 裸 URL（剔除上一步已经登记的）
  BARE_URL_RE.lastIndex = 0;
  while ((m = BARE_URL_RE.exec(text)) !== null) {
    const url = m[0].replace(/[)\].,;]+$/, ""); // 去掉行尾标点
    if (found.has(url)) continue;
    if (!looksLikeFileUrl(url)) continue;
    found.set(url, deriveFilenameFromUrl(url));
  }

  // `/project/xxx` 形式的 Markdown 相对链接
  PROJECT_REL_LINK_RE.lastIndex = 0;
  while ((m = PROJECT_REL_LINK_RE.exec(text)) !== null) {
    const [, name, relPath] = m;
    const fullUrl = buildSessionProjectFileUrl(relPath);
    if (!fullUrl) continue;
    if (!looksLikeFileUrl(fullUrl)) continue;
    if (!found.has(fullUrl)) {
      found.set(fullUrl, deriveFilenameFromUrl(fullUrl, name));
    }
  }

  // `file:///project/xxx` 形式的 Markdown 链接
  FILE_SCHEME_PROJECT_LINK_RE.lastIndex = 0;
  while ((m = FILE_SCHEME_PROJECT_LINK_RE.exec(text)) !== null) {
    const [, name, relPath] = m;
    const fullUrl = buildSessionProjectFileUrl(relPath);
    if (!fullUrl) continue;
    if (!looksLikeFileUrl(fullUrl)) continue;
    if (!found.has(fullUrl)) {
      found.set(fullUrl, deriveFilenameFromUrl(fullUrl, name));
    }
  }

  // 正文裸文本中的 `file:///project/xxx.ext`
  FILE_SCHEME_PROJECT_PATH_RE.lastIndex = 0;
  while ((m = FILE_SCHEME_PROJECT_PATH_RE.exec(text)) !== null) {
    const relPath = m[1];
    const dotIdx = relPath.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const ext = relPath.slice(dotIdx + 1).toLowerCase();
    if (!FILE_EXT_WHITELIST.has(ext)) continue;
    const fullUrl = buildSessionProjectFileUrl(relPath);
    if (!fullUrl) continue;
    if (found.has(fullUrl)) continue;
    found.set(fullUrl, deriveFilenameFromUrl(fullUrl));
  }

  // 反引号 / 正文裸文本中的 `/project/xxx.ext`
  PROJECT_REL_PATH_RE.lastIndex = 0;
  while ((m = PROJECT_REL_PATH_RE.exec(text)) !== null) {
    const relPath = m[0];
    const dotIdx = relPath.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const ext = relPath.slice(dotIdx + 1).toLowerCase();
    if (!FILE_EXT_WHITELIST.has(ext)) continue;
    const fullUrl = buildSessionProjectFileUrl(relPath);
    if (!fullUrl) continue;
    if (found.has(fullUrl)) continue;
    found.set(fullUrl, deriveFilenameFromUrl(fullUrl));
  }

  return Array.from(found, ([url, filename]) => ({ url, filename }));
}

// 进程级累计的下载链接（按 url 去重），最后统一在 main 末尾打印一次。
const collectedDownloads = new Map(); // url -> filename

function accumulateDownloadsFromValues(values) {
  if (!Array.isArray(values) || values.length === 0) return;
  for (const value of values) {
    for (const { url, filename } of collectDownloadLinks(value)) {
      if (!collectedDownloads.has(url)) collectedDownloads.set(url, filename);
    }
  }
}

/**
 * 把单个文件名清洗成跨平台安全的形态：
 *   - 去掉 Windows / POSIX 禁止的字符：< > : " / \ | ? *
 *   - 去掉控制字符 (\x00-\x1f)
 *   - 去掉首尾空白与点（Windows 不允许结尾是 . 或空格）
 *   - 兜底 "downloaded"
 */
function sanitizeFilename(name) {
  let s = String(name || "").trim();
  s = s.replace(/[\x00-\x1f<>:"/\\|?*]+/g, "_");
  s = s.replace(/^[\s.]+|[\s.]+$/g, "");
  return s || "downloaded";
}

/**
 * 解决目标目录中的文件名冲突：若已存在，则在 basename 后追加 " (1)", " (2)" …
 */
function resolveUniqueTargetPath(dir, filename) {
  const safe = sanitizeFilename(filename);
  let candidate = join(dir, safe);
  if (!existsSync(candidate)) return candidate;
  const { name, ext } = parsePath(safe);
  for (let i = 1; i < 1000; i++) {
    candidate = join(dir, `${name} (${i})${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  // 极端兜底：拼时间戳
  return join(dir, `${name}.${Date.now()}${ext}`);
}

/**
 * 用 Bearer Token GET 一个文件并写入磁盘。
 * 成功返回 { ok: true, path }；失败返回 { ok: false, error }，不抛异常。
 */
async function downloadOneFile({ url, targetPath, apiKey }) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
  } catch (e) {
    return { ok: false, error: `网络错误：${e.message}` };
  }

  if (!response.ok) {
    let snippet = "";
    try {
      const text = await response.text();
      snippet = text ? `，${text.slice(0, 200)}` : "";
    } catch {}
    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText}${snippet}`,
    };
  }

  if (!response.body) {
    return { ok: false, error: "响应体为空" };
  }

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath));
    return { ok: true, path: targetPath };
  } catch (e) {
    // 写到一半失败：清掉残留再返回
    try { unlinkSync(targetPath); } catch {}
    return { ok: false, error: `写入失败：${e.message}` };
  }
}

/**
 * 判断 child 是否位于 parent 目录之内（或就是 parent 本身）。
 * 兼容 Windows 大小写、混用斜杠的情况，并避免 "C:\foo" 被误判为 "C:\foobar" 的子目录。
 */
function isPathInside(child, parent) {
  if (!child || !parent) return false;
  const childAbs = resolvePath(child);
  const parentAbs = resolvePath(parent);
  const norm = (p) =>
    process.platform === "win32"
      ? p.replace(/[\\/]+$/, "").toLowerCase()
      : p.replace(/[\\/]+$/, "");
  const c = norm(childAbs);
  const p = norm(parentAbs);
  if (c === p) return true;
  return c.startsWith(p + pathSep) || c.startsWith(p + "/");
}

/**
 * 判断 dir 下是否存在子目录 `.agents`。
 */
function hasDotAgentsChild(dir) {
  const candidate = join(dir, ".agents");
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 解析"下载文件应该落到哪个目录"。
 *
 * 规则（按优先级）：
 *  1. 如果 skill 安装在 `homedir()/.agents` 之下（含 `~/.agents/skills/wind-alice` 这种典型布局），
 *     下载到 `<homedir>/.agents/download/`。source = "home-agents"。
 *  2. 否则从 skillDir 沿目录向上找最近的、含有 `.agents/` 子目录的祖先目录 P，
 *     下载到 `P/.agents/download/`（即项目级 `.agents/download/`）。source = "project-agents"。
 *     - 上溯过程中**遇到用户主目录就停止**，避免把 `~/.agents` 当作"项目级 .agents"误用，
 *       让规则 1 与规则 2 在语义上互斥。
 *  3. 上述都不命中（典型如 skill 处于 SVN/Git 源码开发目录，且没人建过项目级 .agents），
 *     **统一兜底到用户级 `<homedir>/.agents/download/`**（目录不存在就创建）。
 *     source = "home-agents-fallback"。
 *
 * 不再回退到 `process.cwd()`；这样可以避免把 Alice 下载的文件散落到任意命令执行目录，
 * 让"找文件就去 ~/.agents/download/"成为可依赖的稳定约定。
 *
 * 返回 { dir, source }，source ∈ "home-agents" | "project-agents" | "home-agents-fallback"。
 */
export function resolveDownloadDir(skillDir, { home = homedir() } = {}) {
  const homeAgents = join(home, ".agents");

  if (isPathInside(skillDir, homeAgents)) {
    return { dir: join(homeAgents, "download"), source: "home-agents" };
  }

  const homeAbs = resolvePath(home);
  const sameAsHome = (p) => {
    const a = process.platform === "win32" ? p.toLowerCase() : p;
    const b = process.platform === "win32" ? homeAbs.toLowerCase() : homeAbs;
    return a === b;
  };

  let cur = resolvePath(skillDir);
  // 防御性上限：避免极端情况下 dirname 不收敛（POSIX/Windows 根都会自指）。
  for (let i = 0; i < 64; i++) {
    if (sameAsHome(cur)) break;
    if (hasDotAgentsChild(cur)) {
      return { dir: join(cur, ".agents", "download"), source: "project-agents" };
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return { dir: join(homeAgents, "download"), source: "home-agents-fallback" };
}

/**
 * 把累计的下载链接逐个 GET 下载到解析出的目标目录，结果打到 stderr
 * （避免污染 stdout 的 agentResult.value 主输出）。
 *
 * 目标目录由 resolveDownloadDir 决定：用户级 / 项目级 / 兜底到用户级三种情况都会指向
 * 一个 `<...>/.agents/download/` 路径；目录不存在时会自动按 recursive 方式创建。
 * 只有当 mkdir 真的失败（比如磁盘只读、权限拒绝）时，才退到 cwd 作为最后兜底，
 * 不让用户彻底丢文件。
 *
 * 重复调用幂等：调用即清空累计列表。
 */
async function downloadCollectedFiles(apiKey) {
  if (collectedDownloads.size === 0) return;

  const items = Array.from(collectedDownloads, ([url, filename]) => ({ url, filename }));
  collectedDownloads.clear();

  const { dir: targetDir } = resolveDownloadDir(SKILL_DIR);

  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    console.error(
      `[warn] 创建下载目录失败：${targetDir}（${e.message}），回退到当前工作目录 ${process.cwd()}`,
    );
    return await downloadToFallbackCwd(items, apiKey);
  }

  console.error("");
  console.error(
    `=== 检测到 ${items.length} 个可下载文件，正在下载到：${targetDir} ===`,
  );

  const savedPaths = [];
  for (const { url, filename } of items) {
    const targetPath = resolveUniqueTargetPath(targetDir, filename);
    const result = await downloadOneFile({ url, targetPath, apiKey });
    if (result.ok) {
      console.error(`- ${filename}`);
      console.error(`  已保存：${formatLocalFileLink(result.path)}`);
      savedPaths.push(result.path);
    } else {
      console.error(`- ${filename}`);
      console.error(`  下载失败：${result.error}`);
      console.error(`  原始 URL：${url}`);
    }
  }

  printUserDownloadHints(savedPaths);
}

async function downloadToFallbackCwd(items, apiKey) {
  const cwd = process.cwd();
  console.error("");
  console.error(`=== 检测到 ${items.length} 个可下载文件，正在下载到当前目录：${cwd} ===`);
  const savedPaths = [];
  for (const { url, filename } of items) {
    const targetPath = resolveUniqueTargetPath(cwd, filename);
    const result = await downloadOneFile({ url, targetPath, apiKey });
    if (result.ok) {
      console.error(`- ${filename}`);
      console.error(`  已保存：${formatLocalFileLink(result.path)}`);
      savedPaths.push(result.path);
    } else {
      console.error(`- ${filename}`);
      console.error(`  下载失败：${result.error}`);
      console.error(`  原始 URL：${url}`);
    }
  }

  printUserDownloadHints(savedPaths);
}

/**
 * 在 stderr 打出下载结果日志（供调试用）。
 * 本地路径已通过 sanitizeAgentResultTextForDelivery 内联到 stdout 正文里，
 * 不再需要 WIND_ALICE_USER_DOWNLOAD_HINT 机器可读提示。
 * @param {string[]} savedPaths
 */
function printUserDownloadHints(savedPaths) {
  for (const absPath of savedPaths) {
    console.error(`  已保存：${formatLocalFileLink(absPath)}`);
  }
}

export function formatEventOutput(event) {
  return JSON.stringify(event, null, 2);
}

export function formatValueOutput(value, downloadDir = "") {
  if (typeof value === "string") {
    return `agentResult.value: ${sanitizeAgentResultTextForDelivery(value, downloadDir)}`;
  }
  return `agentResult.value: ${JSON.stringify(value, null, 2)}`;
}

function consumeSseText(state, text) {
  state.buffer += text;
  const blocks = state.buffer.split(/\r?\n\r?\n/);
  state.buffer = blocks.pop() ?? "";
  return parseSsePayload(blocks.join("\n\n"));
}

function printEvents(events) {
  for (const event of events) {
    if (
      event?.result?.kind !== "artifact-update" ||
      event?.result?.artifact?.name !== "agentResult"
    ) {
      continue;
    }
    console.log(formatEventOutput(event));
  }
}

function printAgentResultValues(values) {
  const { dir: downloadDir } = resolveDownloadDir(SKILL_DIR);
  for (const value of values) {
    console.log(formatValueOutput(value, downloadDir));
  }
}

/** 单条 emit：先做体验配额扫描，再打印事件 + agentResult.value；
 *  顺便累计 value 中的可下载文件链接，最终在 main 末尾统一提示。
 *  同时从 SSE 事件中提取服务端下发的真实 contextId，刷新 currentSessionContextId，
 *  让 `/project/xxx` 相对路径能够拼出有效下载 URL。
 *  另外扫描 result.isError 形态的服务端错误（认证失败 / 余额不足等），
 *  命中即打印到 stderr 并置非 0 退出码，避免静默成功退出。 */
export function emitParsedEvents(events) {
  logWindTrialQuotaIfPresent(events);
  refreshSessionContextIdFromEvents(events);
  printEvents(events);
  if (printResultErrors(events)) {
    process.exitCode = 1;
    return;
  }
  const values = extractAgentResultValues(events);
  printAgentResultValues(values);
  accumulateDownloadsFromValues(values);
}

/**
 * 扫描事件中的 `result.isError` 服务端错误，把可读文本打印到 stderr。
 * 命中任意一条即返回 true（调用方据此跳过后续 agentResult 处理并置非 0 退出码）。
 * 这类错误以 HTTP 200 + JSON-RPC `result`（而非标准 `error` 字段）形式返回，
 * 旧版只认 `error` 字段，会把这些错误当正常流静默丢弃。
 */
function printResultErrors(events) {
  if (!Array.isArray(events) || events.length === 0) return false;
  let hit = false;
  for (const ev of events) {
    const text = extractResultErrorText(ev);
    if (text) {
      console.error(`request failed (result.isError): ${text}`);
      hit = true;
    }
  }
  return hit;
}

/** 非流式路径包装：命中体验配额时返回 true，让调用方提前 return。 */
function emitParsedEventsUnlessQuota(events) {
  try {
    emitParsedEvents(events);
    return false;
  } catch (e) {
    if (e instanceof WindTrialQuotaExceeded) {
      process.exitCode = 1;
      return true;
    }
    throw e;
  }
}

/** 流式路径包装：命中体验配额时同时取消 reader，避免继续拉流。 */
async function emitParsedEventsUnlessQuotaStreaming(reader, events) {
  try {
    emitParsedEvents(events);
    return false;
  } catch (e) {
    if (e instanceof WindTrialQuotaExceeded) {
      await reader.cancel().catch(() => {});
      process.exitCode = 1;
      return true;
    }
    throw e;
  }
}

/** JSON-RPC error.code，KEY 无效 / 过期。 */
const KEY_MISSING_CODE = -32603;

function dieKeyMissing() {
  die("KEY_MISSING", "WIND_API_KEY 未配置或已失效", {
    extraHint:
      `CLI 已完整检查：用户全局配置 > Skill 本地配置 > WIND_API_KEY 环境变量；不要再手动检查部分来源。\n` +
      `① 获取 Key：访问 ${WIND_AIFINMARKET_PORTAL}（未登录通常会跳转登录页）。\n` +
      `② 选择 Key 存放位置：\n` +
      `   A. 全局共享【推荐 — 所有 wind skill 共用】：%USERPROFILE%\\.wind-aifinmarket\\config\n` +
      `      内容：WIND_API_KEY=<KEY>\n` +
      `   B. 仅当前 skill：${join(SKILL_DIR, "config.json")}\n` +
      `      内容：{"wind_api_key":"<KEY>"}\n` +
      `   C. 临时会话：在终端 set / $env:WIND_API_KEY=<KEY>\n` +
      `③ 重试原命令`,
  });
}

/**
 * 200 但非 text/event-stream：可能是整包 JSON、HTML，或网关误标
 * Content-Type 的 SSE 文本。
 */
function consumeNonStreamBody(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return;

  // 1) 网关误标：内容其实是 SSE
  if (trimmed.includes("data:")) {
    const sseEvents = parseSsePayload(trimmed);
    if (sseEvents.length > 0) {
      if (emitParsedEventsUnlessQuota(sseEvents)) return;
      return;
    }
  }

  // 2) JSON 数组 / 对象
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      if (emitParsedEventsUnlessQuota(parsed)) return;
      if (parsed.some((e) => e && typeof e === "object" && e.error != null)) {
        process.exitCode = 1;
      }
      return;
    }
    if (parsed && typeof parsed === "object") {
      if (parsed.jsonrpc === "2.0" && parsed.error != null) {
        if (parsed.error.code === KEY_MISSING_CODE) {
          dieKeyMissing();
        }
        console.error("request failed (jsonrpc error):");
        console.error(JSON.stringify(parsed.error, null, 2));
        process.exitCode = 1;
        return;
      }
      if (emitParsedEventsUnlessQuota([parsed])) return;
      return;
    }
  } catch {
    /* 非 JSON，按原文输出 */
  }

  console.log(trimmed);
}

async function drainSseStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { buffer: "" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const events = consumeSseText(state, chunk);
    if (await emitParsedEventsUnlessQuotaStreaming(reader, events)) return;
  }

  const remaining = decoder.decode();
  if (remaining) {
    const events = consumeSseText(state, remaining);
    if (await emitParsedEventsUnlessQuotaStreaming(reader, events)) return;
  }

  if (state.buffer.trim()) {
    const events = parseSsePayload(state.buffer);
    if (await emitParsedEventsUnlessQuotaStreaming(reader, events)) return;
  }
}

async function main() {
  const argv = parseArgs(process.argv);

  if (argv.help) {
    console.log(usage());
    return;
  }
  if (argv.command === "list-skills" || argv.listSkills) {
    printSkillList();
    return;
  }

  const { prompt, skill } = argv;
  if (!prompt || !prompt.trim()) {
    console.error("missing --prompt");
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  let skillForBody = null;
  if (skill && skill.trim()) {
    const resolved = resolveSkillName(skill);
    if (!resolved.matched) {
      console.error(
        `[warn] 未在 KNOWN_SKILLS 中匹配到 Skill "${skill}"（中英文都试过了），将按字面值拼入文本前缀提交；若服务端返回空流请用 \`wind-alice list-skills\` 核对中/英文名。`,
      );
      const raw = resolved.name;
      skillForBody = {
        nameEn: raw,
        nameZh: containsChinese(raw) ? raw : null,
      };
    } else {
      if (resolved.matchedBy === "alias") {
        console.error(
          `[info] --skill "${skill}" 已映射为标准 Skill「${resolved.entry.nameZh}」(${resolved.entry.nameEn})`,
        );
      }
      skillForBody = {
        nameEn: resolved.entry.nameEn,
        nameZh: resolved.entry.nameZh,
      };
    }
  }

  const url = getApiUrl();
  const apiKey = getApiKey();
  const headers = buildHeaders(apiKey);
  const body = buildBody(prompt, skillForBody);

  // 让下载阶段能够把 `/project/xxx` 相对路径拼成完整 URL。
  // 客户端预生成的 contextId 通常会被服务端采纳；即便服务端重签发，
  // emitParsedEvents 也会从 SSE 事件中提取并覆盖 currentSessionContextId。
  currentSessionContextId = body?.params?.message?.contextId ?? null;

  const MAX_RETRIES = 10;

  try {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * attempt, 10000);
      console.error(
        `[reconnect] attempt ${attempt}/${MAX_RETRIES}, waiting ${delay}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const requestBody =
      attempt === 0 ? body : resubscribeBody({ params: body });

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
    } catch (e) {
      console.error(`[network error] ${e.message}`);
      if (attempt < MAX_RETRIES) continue;
      console.error("max retries exceeded");
      process.exitCode = 1;
      return;
    }

    console.log("status:", response.status, response.statusText);
    console.log(
      "headers:",
      Object.fromEntries(response.headers.entries()),
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("request failed:");
      console.error(errorText);
      if (response.status >= 500 && attempt < MAX_RETRIES) continue;
      process.exitCode = 1;
      return;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const useSseReader =
      contentType.includes("text/event-stream") && response.body != null;

    if (useSseReader) {
      let streamError = null;
      try {
        await drainSseStream(response);
        await downloadCollectedFiles(apiKey);
        return;
      } catch (e) {
        streamError = e;
      }

      console.error(`[stream error] ${streamError.message}`);
      if (attempt < MAX_RETRIES) continue;
      console.error("max retries exceeded");
      process.exitCode = 1;
      return;
    }

    // 非 SSE：可能是 JSON-RPC error、整包 JSON、HTML、或网关误标的 SSE 文本
    let bodyText;
    try {
      bodyText = await response.text();
    } catch (e) {
      console.error(`[read body error] ${e.message}`);
      if (attempt < MAX_RETRIES) continue;
      console.error("max retries exceeded");
      process.exitCode = 1;
      return;
    }

    consumeNonStreamBody(bodyText);
    await downloadCollectedFiles(apiKey);
    return;
  }
  } finally {
    // Alice calls can run for a long time, so trigger updates only after the call settles.
    spawnUpdateCheck();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error("request error:");
    console.error(error);
    process.exitCode = 1;
  });
}
