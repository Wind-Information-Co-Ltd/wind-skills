---
name: wind-mcp-skill
description: >-
  访问万得 Wind 金融数据。覆盖 A 股 / 港股 / 美股股票行情（最新价 / K 线 / 分钟）与财务基本面（财报 / 股本 / 事件 / 技术指标 / 风险）、ETF / 公募基金行情与全维数据（档案 / 财务 / 持仓 / 业绩 / 持有人 / 管理公司）、指数 / 板块行情与档案 / 基本面 / 技术、债券基本档案 / 发债主体 / 行情估值 / 主体财务、上市公司公告与财经新闻、宏观经济与行业指标。需要 WIND_API_KEY（登录 aimarket.wind.com.cn/#/user/overview 开发者中心获取）。**不包含**：欧股 / 日股、汇率 / 期货盘口、加密货币、非金融数据。
author: Wind AIMarket
homepage: https://aimarket.wind.com.cn
auto_invoke: true
security:
  child_process: true
  eval: false
  filesystem_read: true
  filesystem_write: true
  network: true
examples:
  - "贵州茅台今天最新价"
  - "腾讯控股 00700.HK 最新价和成交量"
  - "苹果公司 AAPL.O 最近 30 日 K 线"
  - "宁德时代近 30 日 K 线"
  - "贵州茅台今日分钟级走势"
  - "科创50ETF 588200.SH 最新折溢价率"
  - "易方达蓝筹精选 005827.OF 的最新规模和经理"
  - "沪深300 指数最近 1 个月走势"
  - "中证500 指数 PE / PB 历史分位"
  - "国债 2601 基本信息和最新行情"
  - "宁德时代 2024 年 ROE 和净利润增速"
  - "贵州茅台 2024 年年度报告内容"
  - "美联储 2026 年利率政策最新新闻"
  - "中国近 10 年新能源汽车产销量"
  - "贵州茅台前十大股东"
---
# Wind 万得金融数据

通过 MCP 协议访问万得 Wind 金融数据：股票（A 股 / 港股 / 美股）/ 基金 / 指数 / 债券 / 公司公告 / 财经新闻 / 宏观指标。

---

## 1. 数据范围

8 个 server_type 各自能干什么：

| server_type | 能力 | 工具清单 |
|---|---|---|
| `stock_data` | **A 股**股票行情 + 基本面（档案 / 财务 / 股本 / 事件 / 技术指标 / 风险） | `get_stock_price_indicators` / `get_stock_kline` / `get_stock_quote` / `get_stock_basicinfo` / `get_stock_fundamentals` / `get_stock_equity_holders` / `get_stock_events` / `get_stock_technicals` / `get_risk_metrics` |
| `global_stock_data` | **港股 / 美股**股票行情 + 基本面（档案 / 财务 / 股本 / 事件 / 技术指标 / 风险） | `get_global_stock_price_indicators` / `get_global_stock_kline` / `get_global_stock_quote` / `get_global_stock_basicinfo` / `get_global_stock_fundamentals` / `get_global_stock_equity_holders` / `get_global_stock_events` / `get_global_stock_technicals` / `get_global_stock_risk_metrics` |
| `fund_data` | 基金 ETF / LOF 行情 + 全维数据（档案 / 财务 / 持仓 / 业绩 / 持有人 / 管理公司） | `get_fund_price_indicators` / `get_fund_kline` / `get_fund_quote` / `get_fund_info` / `get_fund_financials` / `get_fund_holdings` / `get_fund_performance` / `get_fund_holders` / `get_fund_company_info` |
| `index_data` | 指数 / 板块行情 + 档案 / 基本面（成份股加权 PE/PB/PS）/ 技术指标 | `get_index_price_indicators` / `get_index_kline` / `get_index_quote` / `get_index_basicinfo` / `get_index_fundamentals` / `get_index_technicals` |
| `bond_data` | 债券基本档案 / 发债主体公司信息 / 行情与估值（久期 / 凸性 / 利差）/ 发债主体财务 | `get_bond_basicinfo` / `get_bond_issuer_info` / `get_bond_market_data` / `get_bond_financial_data` |
| `financial_docs` | 上市公司公告 + 财经新闻 RAG | `get_company_announcements` / `get_financial_news` |
| `economic_data` | EDB 宏观 / 行业经济指标（含 `freq` / `magnitude` / `currency` / `searchType` 等精细化字段控制） | `get_economic_data` |
| `analytics_data` | 自然语言通用入口，覆盖整个 Wind 数据库（跨域综合 / 衍生品 / 商品等） | `get_financial_data` |

> 工具组合以 `references/tool-manifest.json` 为准；CLI 会在 `call` 前校验 `server_type + tool_name`，错误组合会本地拒绝并输出候选工具。

**❌ 不触发**：欧股 / 日股 / 其它非中概非美股；汇率 / 期货盘口 / 加密货币；非金融数据。

**📅 数据时效**：行情快照 + 分钟级 = 当日准实时；K 线 = 收盘历史；财务 / 档案 = 最近一期定期报告。`WIND_API_KEY` 有日调用额度。

---

## 2. 使用方法

### 调用命令

> 路径说明：本文档中的相对路径（如 `scripts/cli.mjs`、`references/indicators.md`）均相对 **本 skill 目录**，也就是本 `SKILL.md` 所在目录解析；不要假设当前 shell 工作目录存在 `scripts/cli.mjs`。
>
> Agent 执行命令时，应优先使用 `<skill_dir>/scripts/cli.mjs` 的完整路径，或先 `cd <skill_dir>` 再运行示例命令。

```bash
node scripts/cli.mjs call <server_type> <tool_name> '<params_json>'
```

> **⚠️ Shell 转义是 `INVALID_PARAMS_JSON` 错误的首要原因。** JSON 第三参数中的双引号和花括号会被不同 shell 差异化处理，必须按当前 shell 类型选择正确写法，否则 JSON 被截断或变形：
>
> | Shell | 写法 | 示例 |
> |---|---|---|
> | **Bash / Git Bash / WSL** | 外层单引号包裹，内部双引号无需转义 | `node scripts/cli.mjs call stock_data get_stock_quote '{"windcode":"600519.SH"}'` |
> | **PowerShell 5.x / Windows PowerShell** | 外层单引号包裹，内部每个双引号前加反斜杠 `\"` 转义；如果 JSON 字符串值里有空格，把空格写成 `\u0020` | `node scripts/cli.mjs call stock_data get_stock_quote '{\"windcode\":\"600519.SH\"}'` |
> | **PowerShell stop-parsing** | `--%` 后不要再套单引号；JSON 内部双引号仍写成 `\"`；如果 JSON 字符串值里有空格，把空格写成 `\u0020` | `node scripts/cli.mjs call stock_data get_stock_quote --% {\"windcode\":\"600519.SH\"}` |
> | **cmd.exe** | 外层双引号包裹整个 JSON，内部双引号用反斜杠转义 | `node scripts/cli.mjs call stock_data get_stock_quote "{\"windcode\":\"600519.SH\"}"` |
>
> **不要混用 shell 写法。** PowerShell 中裸写 `'{"windcode":"600519.SH"}'` 或 `--% '{"windcode":"600519.SH"}'` 会导致双引号丢失；PowerShell 5.x 中 `'{\"question\":\"海光信息 688041 公司基本资料\"}'` 会在空格处被拆成多个参数；PowerShell 5.x 中把 `ConvertTo-Json` 结果作为变量裸传给 Node 也会导致双引号丢失。若不确定当前 shell，先用 `node -e "console.log(process.argv.slice(1))" <params_json>` 回显确认 Node 实际收到的参数。
>
> **PowerShell 查询语句含空格时的正确示例**：`node scripts/cli.mjs call stock_data get_stock_basicinfo '{\"question\":\"海光信息\u0020688041\u0020公司基本资料\u0020所属行业\",\"lang\":\"中文\"}'`。`JSON.parse` 会把 `\u0020` 还原为空格，后端收到的问题仍是 `海光信息 688041 公司基本资料 所属行业`。
>
> **PowerShell 读取本文档时请显式使用 UTF-8。** 本文件为 UTF-8 编码；Windows PowerShell 5.x 的 `Get-Content` 可能按系统 ANSI/GBK 读取无 BOM 的 UTF-8 文件，显示为乱码。请使用 `Get-Content -Encoding utf8 -LiteralPath 'skills/wind-mcp-skill/SKILL.md'`，或使用 PowerShell 7 / `rg` 读取。

### Codex 沙箱联网要求

调用 `<skill_dir>/scripts/cli.mjs call ...` 访问 Wind 后端时，在 Codex 环境中必须使用 `sandbox_permissions: "require_escalated"` 运行命令，并建议申请稳定的 `prefix_rule`。`require_escalated` 是 Codex 工具调用参数，不是 shell 命令参数，不能写进脚本或命令行。

对应 Codex `prefix_rule` 建议为：

```json
["node", "<skill_dir>/scripts/cli.mjs", "call"]
```

### API Key

报 `KEY_MISSING` 时按 cli.mjs stderr 给的 extraHint 配置即可（程序自动按多种方式查找 Key）；需要拿 Key 跑 `node scripts/cli.mjs open-portal` 自动打开开发者中心。

### 入参签名两类

| 类型             | 入参                                                                                      | 适用工具                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **行情类** | `{windcode, ...}` 结构化字段                                                            | `get_stock_price_indicators` / `get_stock_kline` / `get_stock_quote` / `get_global_stock_price_indicators` / `get_global_stock_kline` / `get_global_stock_quote` / `get_fund_price_indicators` / `get_fund_kline` / `get_fund_quote` / `get_index_price_indicators` / `get_index_kline` / `get_index_quote` |
| **NL 类**  | `{question, lang?}` 自然语言（`lang` enum 在不同 server_type 下取值不同，见各段说明） | 其余工具（含 `bond_data` 全部 / `financial_docs` / `economic_data` / `analytics_data`，部分入参字段名 / 取值有差异，详见工具表） |

---

## 意图判定与路由顺序（强制）

每次接到用户问题时，必须先完成意图判定，再决定 `server_type + tool_name`。按以下固定顺序执行，禁止跳步、禁止并行抢路由：

1. **文档类优先（`financial_docs`）**
   - 命中新闻/媒体/快讯/报道/评论/消息等语义：`financial_docs.get_financial_news`
   - 命中公告/年报/半年报/季报/招股书/监管披露等语义：`financial_docs.get_company_announcements`

2. **宏观指标（`economic_data`）**
   - 命中 GDP / CPI / PPI / PMI / 社融 / 利率 / 失业率 / 进出口等经济指标语义：
     `economic_data.get_economic_data`

3. **行情时序（`stock_data` / `global_stock_data` / `fund_data` / `index_data`）**
   - 命中最新价 / 涨跌幅 / 成交量 / K 线 / 分钟线 / 日内走势等行情语义时：
     先判标的类型与市场，再选对应 server 的行情类工具（`*_price_indicators` / `*_kline` / `*_quote`）。

4. **深度业务 NL（对应专项 server）**
   - 命中财务 / 股本 / 股东 / 事件 / 技术指标 / 风险 / 持仓 / 业绩 / 主体财务等深度业务语义时：
     走对应 server 的 NL 工具（如 `*_fundamentals` / `*_events` / `*_technicals` / `*_risk_metrics` 等）。

5. **通用兜底（`analytics_data`）**
   - 仅当前 1~4 步都无法命中时，才可使用：
     `analytics_data.get_financial_data`

**硬约束：**
- `analytics_data` 不得抢占已明确意图（只允许兜底）。
- 同一问句只允许一次主路由；本节不定义追问流程。
- 路由判定必须先于参数构造与调用执行。

## 3. 工具表

### 行情类（`stock_data` / `global_stock_data` / `fund_data` / `index_data` 共用 3 个工具签名）

> 4 个 server_type 共用同一组 `get_stock_price_indicators` / `get_stock_kline` / `get_stock_quote` / `get_global_stock_price_indicators` / `get_global_stock_kline` / `get_global_stock_quote` / `get_fund_price_indicators` / `get_fund_kline` / `get_fund_quote` / `get_index_price_indicators` / `get_index_kline` / `get_index_quote` 工具签名。`windcode` 字段直接传用户原话里的标的名（中文名 / 简称 / 代码均可），后端自动解析（`贵州茅台` → `600519.SH`、`小米集团` → `01810.HK`、`苹果公司` → `AAPL.O`、`易方达蓝筹精选` → `005827.OF`、`沪深300` → `000300.SH`），AI 无需自己查代码。**用户给短名 / 别名（如 `茅台` 可匹配贵州茅台 / 茅台股份 / 茅台啤酒等多只）时主动预防性反问「你问的是哪只？」——后端不会报歧义，会直接选一个，可能选错**。代码格式参考：A 股 `600519.SH` / `8XXXXX.BJ`、港股 `00700.HK`、美股 `AAPL.O` / `MSFT.O`、场外基金 `005827.OF`、ETF/LOF `588200.SH` / `159915.SZ`、指数 `000300.SH` / `000905.SH` / `HSI.HI`。

#### 行情快照工具（4 个 server_type 各 1 个，共 4 个：`get_stock_price_indicators` / `get_global_stock_price_indicators` / `get_fund_price_indicators` / `get_index_price_indicators`）

获取对应标的一个或多个具体价格指标的最新快照值。需要提供标的代码/名称和指标名称，返回当前值而非时间序列。当用户询问某只股票、基金或指数的当前/最新价格或任何单一时点指标值时，使用此工具。

| 字段         | 必填 | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `windcode` | ✅   | 标的（见行情类段头）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `indexes`  | ✅   | **中文字段名**逗号分隔。调用前必须打开 `references/indicators.md` 并逐字段确认存在；该文件是 `indexes` 的唯一权威清单。常用候选（仍需去 reference 核对后再传）：`<br>`· 通用：`中文简称,最新成交价,前收盘价,今日开盘价,今日最高价,今日最低价,成交量,成交额,涨跌,涨跌幅<br>`· 股票额外：`换手率,量比,委比,涨停价,跌停价,52周最高,52周最低,总市值1,流通市值,市盈率(TTM),市净率,股息率<br>`· 基金额外：`IOPV,贴水率,基金最新份额,基金规模,最新净值,累计净值,七日年化收益率<br>`· 指数额外：`成分股贡献点数,上涨家数,下跌家数,平盘家数`。不在 `references/indicators.md` 的字段禁止猜测、翻译、改写或用英文名替代。 |

#### K 线工具（4 个 server_type 各 1 个，共 4 个：`get_stock_kline` / `get_global_stock_kline` / `get_fund_kline` / `get_index_kline`）

获取对应标的在指定日期范围内的 K 线行情时间序列，默认日 K（`period=10`）。每条记录代表一个交易周期，通常包含开盘价、收盘价、最高价、最低价、成交量、换手率、涨跌幅、均价。当用户需要多日价格历史时，使用此工具。

| 字段           | 必填 | 默认     | 说明                                                                                                                                                                                  |
| -------------- | ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `windcode`   | ✅   |          | 标的（见行情类段头）                                                                                                                                                                  |
| `begin_date` | ✅   |          | `yyyyMMdd`，例 `20260401`                                                                                                                                                         |
| `end_date`   | ✅   |          | `yyyyMMdd`，例 `20260430`                                                                                                                                                         |
| `count`      |      |          | 数据条数：正数=从 `begin_date` 往后取 N 条；负数=从 `end_date` 往前取 N 条。不传则取 `begin_date ~ end_date` 范围内所有交易日                                                   |
| `period`     |      | `"10"` | `1`=1分 / `3`=5分 / `4`=10分 / `5`=15分 / `6`=30分 / `7`=60分 / `8`=120分 / `9`=240分 / `10`=日K / `11`=周K / `12`=月K / `13`=年K / `14`=季K / `15`=半年K |
| `aftype`     |      | `"0"`  | `0`=前复权 / `1`=后复权                                                                                                                                                           |
| `issusp`     |      | `"1"`  | `0`=不含停牌 / `1`=含                                                                                                                                                             |
| `afdate`     |      |          | 复权基准日期 `yyyyMMdd`，通常不需指定                                                                                                                                               |

#### 分钟级行情工具（4 个 server_type 各 1 个，共 4 个：`get_stock_quote` / `get_global_stock_quote` / `get_fund_quote` / `get_index_quote`）

获取对应标的在指定日期范围内的分钟级行情时间序列（默认为当日）。每条记录代表一分钟，包含价格、均价、成交量、换手率。当用户需要日内价格走势、逐分钟交易数据或任何日内时间序列数据时，使用此工具。

| 字段         | 必填 | 默认     | 说明                     |
| ------------ | ---- | -------- | ------------------------ |
| `windcode` | ✅   |          | 标的（见行情类段头）     |
| `begin`    |      | `LAST` | `yyyyMMdd` 或 `LAST` |
| `end`      |      | `LAST` | `yyyyMMdd` 或 `LAST` |

**示例：**

```bash
# A 股
node scripts/cli.mjs call stock_data get_stock_price_indicators '{"windcode":"600519.SH","indexes":"中文简称,最新成交价,涨跌幅,成交量"}'
node scripts/cli.mjs call stock_data get_stock_kline '{"windcode":"600519.SH","begin_date":"20260401","end_date":"20260430"}'
node scripts/cli.mjs call stock_data get_stock_quote '{"windcode":"600519.SH"}'

# 港股 / 美股
node scripts/cli.mjs call global_stock_data get_global_stock_price_indicators '{"windcode":"AAPL.O","indexes":"中文简称,最新成交价,涨跌幅,52周最高"}'
node scripts/cli.mjs call global_stock_data get_global_stock_kline '{"windcode":"00700.HK","begin_date":"20260401","end_date":"20260430"}'

# ETF
node scripts/cli.mjs call fund_data get_fund_price_indicators '{"windcode":"588200.SH","indexes":"中文简称,最新成交价,IOPV,贴水率"}'

# 指数
node scripts/cli.mjs call index_data get_index_price_indicators '{"windcode":"000300.SH","indexes":"最新成交价,涨跌幅,成交量,成交额"}'
node scripts/cli.mjs call index_data get_index_kline '{"windcode":"000300.SH","begin_date":"20260401","end_date":"20260430"}'
```

### NL 类（按 server_type 分）

#### `stock_data` NL（6 个，**仅 A 股**）

入参签名：`{question: string, lang?}`。

入参 `question: string`，自然语言问句，A 股标的（代码 / 中文名 / 简称）+ 业务关键词。

入参 `lang?: "English" | "中文"`，默认 `"中文"`。

| 工具                         | 说明                                                            | question 示例                           |
| ---------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| `get_stock_basicinfo`      | 公司档案（信息 / 主营 / 行业 / IPO 上市板）                     | `"600519.SH 公司基本档案"`            |
| `get_stock_fundamentals`   | 财务（盈利 / 资产负债 / 利润 / 现金流 / 增长率 / 银行业专项）   | `"贵州茅台 2024 年 ROE 和净利润增速"` |
| `get_stock_equity_holders` | 股本 + 股东（总股本 / 流通 / 前十大 / 实控人 / 限售）           | `"贵州茅台前十大股东"`                |
| `get_stock_events`         | 事件 + 资本运作（IPO / 增发 / 配股 / 并购 / ST / 分红）         | `"宁德时代 2024 年增发和并购事件"`    |
| `get_stock_technicals`     | 技术指标时间序列（MACD / KDJ / RSI / BOLL / 融资融券 / 龙虎榜） | `"贵州茅台近 60 日 MACD 走势"`        |
| `get_risk_metrics`         | 风险指标（Beta / Jensen Alpha / 波动率 / Sharpe / VaR）         | `"贵州茅台过去 1 年 Beta 和波动率"`   |

#### `global_stock_data` NL（6 个，**港股 / 美股**）

入参签名：`{question: string, lang?}`。

入参 `question: string`，自然语言问句，港股 / 美股标的（`00700.HK` / `AAPL.O` / 中英文名）+ 业务关键词。

入参 `lang?: "English" | "中文"`，默认 `"中文"`。

| 工具                                | 说明                                                                           | question 示例                          |
| ----------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| `get_global_stock_basicinfo`      | 公司档案（中英文名称 / 注册地 / 经营范围 / 上市交易所 / 行业 / 指数成份）      | `"AAPL.O 公司基本档案"`              |
| `get_global_stock_fundamentals`   | 财务（毛利率 / ROE / 资产 / 利润 / 现金流 / 增长率 / PE / PB / PS / 历史分位） | `"腾讯 00700.HK 2024 年 ROE 和营收"` |
| `get_global_stock_equity_holders` | 股本 + 股东（总股本 / 流通 / 主要股东 / 机构持仓 / 限售解禁）                  | `"腾讯 00700.HK 前十大股东"`         |
| `get_global_stock_events`         | 事件 + 资本运作（IPO / 增发 / 配股 / 并购 / 合规监管 / 分红）                  | `"腾讯 00700.HK 分红历史"`           |
| `get_global_stock_technicals`     | 技术指标 + 多周期涨跌幅（相对大盘 / MACD / KDJ / RSI / BOLL / 融资融券）       | `"AAPL.O MACD 和 RSI"`               |
| `get_global_stock_risk_metrics`   | 风险指标（Beta / Alpha / 波动率 / Sharpe / 最大回撤 / VaR / 财务安全比率）     | `"AAPL.O 过去 1 年 Beta 和波动率"`   |

#### `fund_data` NL（6 个）

入参签名：`{question: string, lang?}`。

入参 `question: string`，自然语言问句，基金代码（`*.OF` / ETF / LOF）或简称 + 业务关键词（`get_fund_company_info` 传管理公司名）。

入参 `lang?: "English" | "中文"`，默认 `"中文"`。

| 工具                      | 说明                                                | question 示例                           |
| ------------------------- | --------------------------------------------------- | --------------------------------------- |
| `get_fund_info`         | 档案（代码 / 简称 / 风格 / 业绩基准 / 费率 / 经理） | `"易方达蓝筹精选 005827.OF 基金档案"` |
| `get_fund_financials`   | 财务（利润 / 净值 / 收入 / 费用 / 分红）            | `"005827.OF 2024 年净利润和分红"`     |
| `get_fund_holdings`     | 持仓 + 资产配置（重仓股 / 申万 / Wind / 中信行业）  | `"005827.OF 最新一期重仓股"`          |
| `get_fund_performance`  | 业绩 + 排名 + ETF / 二级交易                        | `"005827.OF 近 1 年业绩排名"`         |
| `get_fund_holders`      | 持有人结构（个人 / 机构 / 申购赎回 / 规模变动）     | `"005827.OF 持有人结构"`              |
| `get_fund_company_info` | 基金管理公司档案 + 经理团队                         | `"易方达基金管理公司档案"`            |

#### `index_data` NL（3 个）

入参签名：`{question: string, lang?}`。

入参 `question: string`，自然语言问句，指数标的（代码 / 中文名）+ 业务关键词。

入参 `lang?: "English" | "中文"`，默认 `"中文"`。

| 工具                       | 说明                                                                      | question 示例                  |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| `get_index_basicinfo`    | 指数档案（发布机构 / 基日 / 基点 / 计算方法 / 成份股数量 / 分类）         | `"沪深300 指数档案"`         |
| `get_index_fundamentals` | 指数基本面（成份股加权 PE / PB / PS / 营收 / 净利润 / 现金流 / 历史分位） | `"沪深300 PE / PB 历史分位"` |
| `get_index_technicals`   | 指数技术指标（多周期涨跌幅 / 趋向 / 反趋向 / 能量 / 量价 / 波动）         | `"中证500 MACD 和 RSI"`      |

#### `bond_data` NL（4 个）

入参签名：`{question: string, lang?}`。**注意：bond_data 没有行情类工具，债券快照 / 估值通过 NL 拿。**

入参 `question: string`，自然语言问句，债券代码或简称（如 `国债 2601`）+ 业务关键词。

入参 `lang?: "English" | "中文"`，默认 `"中文"`。

| 工具                        | 说明                                                                        | question 示例                    |
| --------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| `get_bond_basicinfo`      | 基本档案（交易所 / 分类 / 发行日期 / 规模 / 价格 / 票面利率 / 期限 / 兑付） | `"国债 2601 基本信息"`         |
| `get_bond_issuer_info`    | 发债主体公司信息（名称 / 注册地 / 行业 / 股权结构 / 企业背景）              | `"国债 2601 发债主体"`         |
| `get_bond_market_data`    | 行情数据 + 估值分析（报价 / 估价 / 溢价 / 久期 / 凸性 / 利差）              | `"国债 2601 久期和凸性"`       |
| `get_bond_financial_data` | 发债主体财务（营收 / 利润 / 资产 / 负债 + 主体层面财务表现）                | `"国债 2601 主体 2024 年营收"` |

#### `financial_docs` — 公告 / 新闻（2 个）

`get_company_announcements` 获取上市公司、债券发行人及其他金融工具发行人向交易所及监管机构发布的官方公告与监管文件。返回发行人披露的文件，包括定期报告（年报、半年报、季报）、临时公告（董事会决议、股权变动、分红通知、风险提示）、以及招股说明书等。不包含第三方新闻报道或分析师评论
`get_financial_news` 获取来自第三方媒体的财经新闻报道，涵盖公司、行业、最新市场/政策/政经动态相关内容。不包含公司官方发布的公告或监管披露文件

共用入参：

| 字段      | 必填 | 类型   | 说明                                                         |
| --------- | ---- | ------ | ------------------------------------------------------------ |
| `query` | ✅   | string | 自然语言，如 `"贵州茅台 2024 年报"` / `"美联储利率政策"` |
| `top_k` |      | int    | 返回文档数                                                   |

```bash
node scripts/cli.mjs call financial_docs get_financial_news '{"query":"美联储利率政策","top_k":5}'
```

#### `economic_data` — EDB 宏观（1 个）

`get_economic_data` — EDB 宏观 / 行业经济指标，提供 `freq` / `magnitude` / `currency` 等精细化字段控制：

| 字段                        | 必填 | 说明                                                                                                                                            |
| --------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `metricIdsStr`            | ✅   | **自然语言问句**（不是指标 ID），如 `"中国 GDP"` / `"美国 CPI 同比"`                                                                  |
| `beginDate` / `endDate` |      | `yyyyMMdd`                                                                                                                                    |
| `freq`                    |      | `日`=`1` / `工作日`=`2` / `周`=`3` / `月`=`4` / `季`=`5` / `半年`=`6` / `年`=`7` / `年度`=`8`（中文或代码均可） |
| `magnitude`               |      | `个`=`1` / `千` / `万` / `百万` / `千万` / `亿` / `十亿` / `百亿` / `千亿` / `万亿`                                       |
| `currency`                |      | `USD` / `CNY` / `EUR` / `JPY` / `AUD` / `GBP` / `CHF` / `CAD` / `SGD` / `HKD` / `MYR` / `BYR`                           |
| `searchType`              |      | `深度`=`0` / `精确`=`1`                                                                                                                 |
| `ifUnion`                 |      | `开启`=`1` / `不开启`=`2`（混合搜索）                                                                                                   |

```bash
node scripts/cli.mjs call economic_data get_economic_data '{"metricIdsStr":"中国 CPI 同比","freq":"月","beginDate":"20240101","endDate":"20261231"}'
```

#### `analytics_data` — NL 通用入口（1 个）

`get_financial_data` — 自然语言入参的**结构化数据获取**工具，后端会先将 `question` 解析成具体查询口径再取数。优先用于其它 server_type 覆盖不到的跨域综合、衍生品、商品等结构化取数问题。若已知标的代码、字段、K 线、分钟线或指数行情，优先使用对应专项工具。

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `question` | ✅ | string | 简洁自然语言取数问题 |
| `lang` | | enum | `CNS`=中文（默认）/ `ENS`=英文 |

使用要求：

- **首次调用必须将用户原始问句原封不动作为 `question` 透传**，禁止任何改写、概括、意译或添加用户未提及的条件。即使问句看起来不完整或不规范，也必须先透传一次。
- 仅当透传首次调用失败（后端报错 / 返回空 / 返回不匹配）时，才可改写或拆分 `question`，此时改写后的问句仍须忠实反映用户原始意图，不得擅自添加口径、频率、筛选条件等。
- `question` 入参不要太复杂，应尽量是单一取数动作。复杂分析、归因、预测、多条件筛选后再分析等任务，先拆成多个简单取数问题，再由 AI 综合。
- 需要先发现对象 / 展开范围 / 再对范围内对象二次取数的问题必须分步；如果无法得到明确范围或后端没有对应排名口径，停止并说明限制，不要强行猜。

```bash
node scripts/cli.mjs call analytics_data get_financial_data '{"question":"查询螺纹钢主力合约最近一周的日收盘价和涨跌幅"}'
```

---

## 4. 调用前参数校验（强制）

每次调用前，必须逐字段对照 `## 3. 工具表` 中对应工具的请求参数定义完成参数有效性验证。字段名、必填项、类型、日期格式、枚举值必须与参数表一致。任一项不一致时，必须先修正参数或先向用户澄清，再调用；禁止明知不符合参数表仍试错调用。参数有效性最终判定以工具参数表为准，示例写法或经验写法不得覆盖参数表。

对 `get_stock_price_indicators` / `get_global_stock_price_indicators` / `get_fund_price_indicators` / `get_index_price_indicators`，还必须执行 `indexes` 专项校验：把 `indexes` 按英文逗号拆成单个字段，逐个到 `references/indicators.md` 查找完全一致的中文字段名（含括号、全角字符、数字位）。任一字段不在 reference 中时，不得调用快照工具；应改用对应 NL 工具，或向用户说明该快照字段不可用。

---

## 5. 注意事项（违反必失败）

| 规则                                                                                             | 后果                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 全流程禁止 Web Search 兜底                                                                       | 立即取消当前违规分支，回到 Wind 合规路径继续处理（修参数、换工具、换 server_type、拆分查询、升级 skill）；不结束整体任务 |
| 命令必须在**本文件所在目录**下执行                                                         | cli.mjs 用相对路径，否则找不到资源                                                                                       |
| K 线 `begin_date` / `end_date` **都必填**                                              | schema 已强制，缺一报错                                                                                                  |
| `get_stock_quote` / `get_global_stock_quote` / `get_fund_quote` / `get_index_quote` 字段名是 `begin / end`，**不是** `begin_date / end_date` | 字段名错参数解析报错                                                                                                     |
| K 线 `begin_date / end_date` 和 EDB `beginDate / endDate`（注意 camelCase）都用 `yyyyMMdd` | 格式不对报错                                                                                                             |
| 行情类 `indexes` 字段**只接中文名**，从 `references/indicators.md` 复制粘贴            | 自创字段名 / 写英文报错                                                                                                  |
| `aftype` 只接受 `"0"` / `"1"`（无"不复权"）                                                | 其他值报错                                                                                                               |
| A 股查 `stock_data`，港股 / 美股查 `global_stock_data`，**别混**                       | A 股财务工具会拒港股 / 美股                                                                                              |
| `server_type + tool_name` 必须存在于 `references/tool-manifest.json`                         | CLI 会在真正调用后端前返回 `UNKNOWN_TOOL_NAME`；按 stderr 候选工具重选，不要改走 `analytics_data` 试错                    |
| 单工具调用**只支持单标的**                                                                 | 逗号分隔多代码后端只识别第 1 个，其余静默忽略                                                                            |
| Codex 中调用 Wind 后端联网必须使用 `require_escalated`                                         | 否则沙箱内可能 `fetch failed`                                                                                          |
| 结果末尾**必须标注**「数据来源于万得 Wind 金融数据服务」                                   | 合规要求                                                                                                                 |

---

## 6. 使用技巧

所有技巧仅在通过第 4 节强校验且不触发第 5 节红线时使用，不能替代参数表校验。

| 场景                                    | 怎么做                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 拿单时点最新值 / 已知具体字段名         | 用 `get_stock_price_indicators` / `get_global_stock_price_indicators` / `get_fund_price_indicators` / `get_index_price_indicators`，结构化入参，`indexes` 中文名 |
| 拿过去 N 日时间序列                     | K 线 / 分钟级用 `get_stock_kline` / `get_global_stock_kline` / `get_fund_kline` / `get_index_kline` / `get_stock_quote` / `get_global_stock_quote` / `get_fund_quote` / `get_index_quote`；技术指标 / 财务时间序列用 `get_stock_technicals` / `get_global_stock_technicals` / `get_index_technicals` |
| 财务 / 档案 / 持仓 / 事件等深度业务问题 | NL 类工具，自然语言入参                                                                                    |
| `indexes` 字段                         | 每次都 Read `references/indicators.md` 并逐字段核对完全一致；常用快捷只是候选，不是权威清单；字段不在 reference 里就切 NL 或说明不可用 |
| 多标的对比（`贵州茅台 vs 五粮液`）    | 单工具单标的限制 → 并行多次调用                                                                           |
| 多市场对比（`苹果 vs 腾讯`）          | 美股走 `global_stock_data`，港股走 `global_stock_data`，分别调                                         |
| 指数行情 vs 指数基本面                  | 行情走 `index_data` 行情类；PE / PB 历史分位走 `get_index_fundamentals`（NL）                          |
| 债券需要快照？                          | `bond_data` 没有行情类 → 用 `get_bond_market_data`（NL）描述要哪些指标                                |
| NL `question` / `query` 写法          | 普通档案类可短句 |

---

## 7. 出错怎么办

cli.mjs 大部分错误会自动输出错误码 + 处理建议（stderr），照建议走即可。常见 schema 类陷阱：

### CLI 错误处理

`cli.mjs` 只输出错误码、后端消息和 `处理建议:`，不再附带额外的机器可读重试协议。处理时按 stderr 的 `处理建议:` 执行，并遵守以下规则：

- JSON 解析、未知 `server_type`、未知 `tool_name`、Key、权限、限流、余额、网络、后端 5xx 等错误，不得改走 `analytics_data`；应先修正调用方式、配置或等待后端恢复。
- 专项工具报字段、工具或口径类错误时，先按 `## 3. 工具表` 检查 `server_type` / `tool_name` / `params_json` 并重试一次。
- 若专项工具重试后仍为工具调用错误，且问题属于结构化取数，可改用 `analytics_data.get_financial_data`；fallback 前必须把复杂问题拆成简单取数问题，不要机械照搬复杂原话。
- `analytics_data.get_financial_data` 失败时（非 Key / 权限 / 网络 / 5xx 类错误），可调整 `question` 措辞重试一次（如拆分子问题、换关键词），不得改变用户原始意图。
- 如果 `analytics_data.get_financial_data` 重试后仍返回未知错误或没找到数据，停止继续 fallback，把后端原文、错误码和已尝试路径简要告知用户，然后执行以下终极兜底：

### 终极兜底：wind-alice

当以上所有工具（含 `analytics_data` 兜底）均因数据覆盖、字段不可用、口径不匹配、无结果等原因失败后，可用 `AskUserQuestion` 向用户推荐 **wind-alice** skill 作为最后选项。wind-alice 是当前 wind-skills 仓库内的另一个 skill，接受自然语言问题，能处理 wind-mcp-skill 专项工具覆盖不到的复杂场景。

若失败原因是 `KEY_MISSING` / `KEY_INVALID` / 权限 / 限流 / 余额 / 网络 / 后端 5xx / `INVALID_PARAMS_JSON` / 未知 `server_type` / 未知 `tool_name`，不得推荐 wind-alice；应先修复 Key、权限、网络、shell 转义或工具参数。wind-alice 同样依赖 `WIND_API_KEY` 和网络，切换不能解决这些根因。

**引导规则（强制）：**

1. **仅在所有 wind-mcp-skill 路径均失败后触发**——不得跳过前面的工具直接推荐 wind-alice。
2. **必须先判断客户环境是否已安装 wind-alice**：如果当前可用 skill 列表中有 `wind-alice`，或客户端能加载 `skills/wind-alice/SKILL.md`，视为已安装；否则视为未安装。当前仓库包含 `skills/wind-alice` 源码，不等于客户环境已经安装。
3. **已安装 wind-alice 时**：必须用 `AskUserQuestion` 让用户选择，不得自动切换。话术参考：
   > wind-mcp-skill 已尝试专项工具和 analytics_data，但仍未取到可用结果。当前环境已安装 **wind-alice**，可以用 Alice Agent 的自然语言链路继续尝试。是否改用 wind-alice？
   用户确认后，将用户原始问题原封不动作为 wind-alice 的 `--prompt` 传入；默认不传 `--skill`，让 Alice auto route。只有用户明确点名 Alice 子 Skill（如「公司一页纸」「事实核验」「上市公司调研问题清单」）时，才传 `--skill`。
4. **未安装 wind-alice 时**：不要假装可以直接切换。用 `AskUserQuestion` 告知用户需先安装，并给出当前项目的安装命令：
   ```bash
   # GitHub
   npx skills add Wind-Information-Co-Ltd/wind-skills --skill wind-alice -g -y

   # Gitee 镜像（国内）
   npx skills add https://gitee.com/wind_info/wind-skills.git --skill wind-alice -g -y
   ```
   说明安装完成后可继续用原问题重试；如果用户只想装到当前项目，把命令中的 `-g` 去掉。
5. **用户拒绝**：尊重选择，停止继续 fallback，简要返回已尝试路径、错误码和后端原文摘要，不再重复推荐。

| 错误                                           | 解法                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `indexes` 字段不识别 / 字段名不存在          | 按 `references/indicators.md` 复制表内字段名（不要自己拼）；仍不可用则改用对应 NL 工具或说明快照字段不可用 |
| 工具不存在 / 未知 server_type / 未知 tool_name / schema 对不上  | 先查看 `references/tool-manifest.json` 或 CLI stderr 输出的候选工具，再按 `## 1. 数据范围` 和 `## 3. 工具表` 重新核对 `server_type` / `tool_name` / `params_json` 并重试一次；仍不通过再建议升级 skill |
| 美股 / 港股调用 `stock_data` 工具返空 / 报错 | 切到 `global_stock_data` 同名工具（参数签名一致）                |
| 调用似乎啥都没报                               | 检查命令是否在本 SKILL.md 所在目录下执行                           |

---

## 8. 保持最新

每次调用 cli.mjs 后，留意 stderr 是否包含 `[wind-skills] 检测到 N 个 skill 有新版`。

**看到该提示时，会话首次必须转告用户一次**（同会话再次调用不重复）：把清单和升级命令完整带给用户，命令已含 `-g -y` 等参数，直接照搬即可。Gitee 装的 skill 升级路径跟 GitHub 不同，按 stderr 提示走。

⚠️ 如遇"工具不存在 / 字段不符"等疑似版本相关错误，先按本文档工具清单、工具表和 CLI stderr 建议重新检查 `server_type` / `tool_name` / `params_json` 并重试一次；检查仍不通过或确认本地 schema 与文档不一致后，再建议用户跑 `npx skills update -g -y` 拉最新后重试。
