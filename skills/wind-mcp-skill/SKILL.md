---
name: wind-mcp-skill
description: >-
  访问万得 Wind 金融数据。覆盖 A 股 / 港股股票行情（最新价 / K 线 / 分钟）与财务基本面（财报 / 股本 / 事件 / 技术指标 / 风险）、ETF / 公募基金行情与全维数据（档案 / 财务 / 持仓 / 业绩 / 持有人 / 管理公司）、上市公司公告与财经新闻、宏观经济与行业指标。需要 WIND_API_KEY（登录 aimarket.wind.com.cn/#/user/overview 开发者中心获取）。**不包含**：美股 / 欧股 / 日股、汇率 / 期货盘口、加密货币、非金融数据。
author: Wind AIMarket
homepage: https://aimarket.wind.com.cn
auto_invoke: true
security:
  child_process: true       # open-portal 子命令 spawn 浏览器拿 API Key
  eval: false
  filesystem_read: true     # 读 ~/.wind-aimarket/config 与 skill 内 config.json
  filesystem_write: true    # tools/list 24h 缓存到 ~/.cache/wind-aimarket/tools/
  network: true             # 调用 mcp.wind.com.cn 5 个 endpoint
examples:
  - "贵州茅台今天最新价"
  - "宁德时代近 30 日 K 线"
  - "易方达蓝筹精选 005827.OF 的最新规模和经理"
  - "宁德时代 2024 年 ROE 和净利润增速"
  - "贵州茅台 2024 年年度报告内容"
  - "美联储 2026 年利率政策最新新闻"
  - "中国近 10 年新能源汽车产销量"
  - "贵州茅台前十大股东"
---

# Wind 万得金融数据

访问万得 Wind 金融数据：股票（行情与财务基本面）、基金（行情与全维数据）、上市公司公告与新闻、宏观经济指标。

> ⚠️ **运行环境**：所有 `node scripts/cli.mjs ...` 命令**必须在本文件（SKILL.md）所在目录下执行**。从其它目录跑会失败。

> 🔑 **入参模式提示**：fund_data / stock_data 各**包含两类工具**：
> - **行情类**（`*_price_indicators` / `*_kline` / `*_quote`）— **结构化代码参数**（`windcode + indexes/period/...`）
> - **NL 类**（财务 / 档案 / 持仓 / 事件等）— **自然语言**（`{question}`）
>
> 选错入参会失败，下方工具表会标注每个工具属于哪一类。

## 何时使用

**✅ 触发场景：**

| 场景 | server_type |
|---|---|
| **A 股 / 港股股票行情**（最新价、K 线、分钟级）| `stock_data` |
| 股票档案 / 财务基本面 / 股本结构 / 公司事件 / 技术指标 / 风险 | `stock_data` |
| **基金 ETF / LOF 行情**（最新价、K 线、分钟级）| `fund_data` |
| 基金任何维度（档案 / 财务 / 持仓 / 业绩 / 持有人 / 管理公司） | `fund_data` |
| 上市公司公告、财经新闻 | `financial_docs` |
| 宏观经济、行业经济指标（EDB） | `economic_data` |
| 不确定归属或跨域综合查询（fallback） | `analytics_data` |

**❌ 不触发场景：**
- 美股 / 欧股 / 非中概股
- 汇率 / 期货盘口 / 加密货币
- 非金融数据

## 工作流程

> 🚨 以下所有命令在**本文件（SKILL.md）所在目录下执行**。

### Step 1: 看可用工具

```bash
node scripts/cli.mjs list-tools <server_type>
```

24h 缓存。返回工具 schema 数组。

### Step 2: 调用工具

```bash
node scripts/cli.mjs call <server_type> <tool_name> '<params_json>'
```

### Step 3: 没 Key 时引导用户

如果第一次调用报"WIND_API_KEY 未配置"：

1. **先问用户是否同意打开浏览器**（避免突然弹）
2. 同意后跑：`node scripts/cli.mjs open-portal`
3. 用户登录 / 拿 Key 后，按 cli.mjs 提示三选一配置（推荐 C：全局 `~/.wind-aimarket/config`，所有 wind skill 共享）

## 工具表

### server_type=fund_data

**行情类（3 个，结构化代码参数 `{windcode, ...}`）：**

| 工具 | 说明 | 必填入参 |
|---|---|---|
| `get_fund_price_indicators` | 场内基金（ETF/LOF）行情快照（最新价 / 开盘 / 涨跌等） | `windcode, indexes` |
| `get_fund_kline` | 场内基金（ETF/LOF）日 / 周 / 月 K 线 | `windcode` |
| `get_fund_quote` | 场内基金（ETF/LOF）当日盘中分钟级行情 | `windcode` |

**NL 类（6 个，入参 `{question, lang?, version?}`）：**

| 工具 | 说明 |
|---|---|
| `get_fund_info` | 基金基本档案（代码 / 简称 / 投资风格 / 业绩基准 / 费率 / 现任经理） |
| `get_fund_financials` | 基金财务（利润 / 净值 / 收入 / 费用 / 分红） |
| `get_fund_holdings` | 持仓 + 资产配置（重仓股 / 申万 Wind 中信行业 / 投资风格） |
| `get_fund_performance` | 业绩 + 排名 + ETF / 二级交易数据 |
| `get_fund_shareholders` | 持有人结构（个人 / 机构 / 申购赎回 / 规模变动） |
| `get_fund_company_info` | 基金管理公司档案 + 经理团队指标 |

### server_type=stock_data

**行情类（3 个，结构化代码参数 `{windcode, ...}`）：**

| 工具 | 说明 | 必填入参 |
|---|---|---|
| `get_stock_price_indicators` | 股票行情快照（最新价 / 开盘 / 涨跌 / 成交等） | `windcode, indexes` |
| `get_stock_kline` | 股票日 / 周 / 月 K 线（前复权 / 后复权 / 不复权） | `windcode` |
| `get_stock_quote` | A 股股票指定交易日分钟级行情 | `windcode` |

**NL 类（6 个，入参 `{question, lang?, version?}`）：**

| 工具 | 说明 |
|---|---|
| `get_stock_basicinfo` | 股票基本档案（公司信息 / 主营 / 行业分类 / IPO 上市板） |
| `get_stock_fundamentals` | 财务基本面（盈利能力 / 资产负债 / 利润 / 现金流 / 增长率 / 杠杆） |
| `get_stock_equity_holders` | 股本 + 股东（总股本 / 流通 / 前十大 / 实控人 / 限售解禁） |
| `get_stock_events` | 事件 + 资本运作（IPO / 增发 / 配股 / 并购 / ST / 合规） |
| `get_stock_technicals` | 技术指标 + 交易（涨跌幅 / MACD / KDJ / RSI / BOLL / 融资融券 / 龙虎榜 / 涨跌停） |
| `get_risk_metrics` | 风险指标（Beta / Jensen Alpha / 波动率 / Sharpe） |

### server_type=financial_docs（文档检索）

| 工具 | 说明 | 入参 |
|---|---|---|
| `get_company_announcements` | 公司公告 / 监管文件 / 招股书 / 业绩公告 / 致股东信 | `query`（必填）+ `top_k / start_date / end_date` |
| `get_financial_news` | 财经新闻报道 | 同上 |

### server_type=economic_data（宏观 / 行业指标）

| 工具 | 说明 | 入参 |
|---|---|---|
| `get_economic_data` | EDB 宏观 / 行业经济指标（自动 NL → 指标 ID） | `metricIdsStr`（必填，自然语言问句）+ `beginDate / endDate / freq / magnitude / currency` |

> ⚠️ economic_data 报 `TOOL_RUNTIME_ERROR` 时，换 `analytics_data.get_financial_data` 兜底（同样问句通常能成功）。

### server_type=analytics_data（通用兜底）

入参：`{question, lang?, version?}`。

| 工具 | 说明 |
|---|---|
| `get_financial_data` | 自然语言 → Wind 通用数据（覆盖 fund / stock 之外的杂项 / 跨域综合查询） |

## 行情类参数速查（fund_data + stock_data 共用）

⚠️ 行情类 6 个工具（`*_kline` / `*_quote` / `*_price_indicators`）参数跟 NL 类**不一样**，按下方"高频用例"直接抄，**别凭直觉填**（`period:"D"` 不行，要 `"10"`）。

### 字段速查

| 字段 | 取值 |
|---|---|
| `period` | `1`=1分钟 / `3`=5分钟 / `4`=10分钟 / `5`=15分钟 / `6`=30分钟 / `7`=60分钟 / **`10`=日**（默认）/ `11`=周 / `12`=月 |
| `count` | **负数 = 从最新往前 N 根**（推荐！）/ 正数 = 从最早开始 N 根 |
| `rangeflag` | `0` = 用 count（推荐）/ `1` = 从上市相对位置 / `2` = 用 begin+end 绝对日期 |
| `begin` / `end` | rangeflag=2 时绝对日期，**数字格式 yyyymmdd**（如 `20250101`）；分钟工具用字符串如 `"20260415"` 或 `"LAST"` |
| `aftype` | `0` = 前复权（默认）/ `1` = 后复权 / `2` = 不复权 |
| `indexes` | 逗号分隔的英文字段名：`NAME` 简称 / `MATCH` 最新价 / `PRECLOSE` 前收 / `OPEN` 开盘 / `HIGH` 最高 / `LOW` 最低 / `CHANGERANGE` 涨跌幅 / `CHANGE` 涨跌额 / `VOLUME` 成交量 / `TURNOVER` 成交额 |

### 高频用例（直接抄，把 `windcode` 换成你要的代码）

| 用户问 | server_type | 工具 + 参数 |
|---|---|---|
| 茅台**最新价 / 涨跌幅** | `stock_data` | `get_stock_price_indicators` `{"windcode":"600519.SH","indexes":"NAME,MATCH,CHANGERANGE"}` |
| 茅台**最新价 + 成交** | `stock_data` | `get_stock_price_indicators` `{"windcode":"600519.SH","indexes":"NAME,MATCH,CHANGERANGE,VOLUME,TURNOVER"}` |
| 茅台**最近 30 日 K** | `stock_data` | `get_stock_kline` `{"windcode":"600519.SH","rangeflag":0,"count":-30,"period":"10"}` |
| 茅台 **2025 Q1 日 K** | `stock_data` | `get_stock_kline` `{"windcode":"600519.SH","rangeflag":2,"begin":20250101,"end":20250331,"period":"10"}` |
| 茅台**最近 12 周 K** | `stock_data` | `get_stock_kline` `{"windcode":"600519.SH","rangeflag":0,"count":-12,"period":"11"}` |
| 茅台**后复权 K** | `stock_data` | 上面任意 + `"aftype":"1"` |
| 茅台**今天分钟行情** | `stock_data` | `get_stock_quote` `{"windcode":"600519.SH","begin":"LAST","end":"LAST"}` |
| 茅台**某日分钟行情** | `stock_data` | `get_stock_quote` `{"windcode":"600519.SH","begin":"20260415","end":"20260415"}` |
| 588200 ETF **最新价** | `fund_data` | `get_fund_price_indicators` `{"windcode":"588200.SH","indexes":"NAME,MATCH,CHANGERANGE"}` |
| 588200 ETF **最近 30 日 K** | `fund_data` | `get_fund_kline` `{"windcode":"588200.SH","rangeflag":0,"count":-30,"period":"10"}` |
| 588200 ETF **某日分钟** | `fund_data` | `get_fund_quote` `{"windcode":"588200.SH","begin":"20260415","end":"20260415"}` |

> 用户场景跟上表不完全一样时，**比对最像的一行**，按字段速查改 `period` / `count` / `aftype` / `indexes` 即可。

## 使用技巧

> 这些经验帮 AI 用得更准、少走弯路。

1. **🚨 运行环境**：所有运行脚本都在**本文件（SKILL.md）所在目录下执行**。
2. **fund_data / stock_data 入参分两组**：
   - **行情类工具**（名字含 `price_indicators` / `kline` / `quote`）→ 结构化代码参数 `{windcode, indexes/period/...}`
   - **NL 类工具**（财务 / 档案 / 持仓 / 事件等）→ 自然语言 `{question}`
   - **混用会失败**：行情类传 `{question}` 报错；NL 类传 `{windcode}` 报错。
3. **先 list-tools 再 call**：第一次用某 server 时先 `list-tools` 看可用工具与 schema，**不要凭印象写工具名**。一旦缓存（24h），后续 call 无需再 list。
4. **NL 问句要简洁**：fund_data / stock_data 的 NL 工具 `question` 字段**不要把用户原话直接抄进去**。提取关键实体（标的代码 / 简称 + 维度 + 时间）即可：
   - ✅ `"易方达蓝筹精选 005827.OF 基金档案"`
   - ❌ `"帮我查一下易方达基金的资料看看"`
5. **economic_data 失败时换 `analytics_data.get_financial_data` 兜底**。
6. **server_type 选错的代价**：选错会导致工具不存在或参数不匹配。优先按"何时使用"段的场景表选 server，再选具体工具。
7. **跨域查询用 analytics_data**：用户问题落不进前 4 个 server 的明确归属时，用 `analytics_data.get_financial_data` 自然语言兜底。

## 数据来源标注（必做）

向用户呈现查询结果时，**必须在结果末尾标注**：

```
数据来源于万得 Wind 金融数据服务
```

这是品牌承诺，不可省略。

## 典型示例

```bash
# 股票行情类（结构化代码参数）
node scripts/cli.mjs call stock_data get_stock_price_indicators '{"windcode":"600519.SH","indexes":"NAME,MATCH,CHANGERANGE,VOLUME"}'
node scripts/cli.mjs call stock_data get_stock_kline '{"windcode":"600519.SH","period":"10","count":30}'

# 股票深度（NL）
node scripts/cli.mjs call stock_data get_stock_fundamentals '{"question":"贵州茅台 2024 年 ROE 和净利润增速"}'
node scripts/cli.mjs call stock_data get_stock_basicinfo '{"question":"600519.SH 公司基本档案"}'

# 基金行情类
node scripts/cli.mjs call fund_data get_fund_price_indicators '{"windcode":"588200.SH","indexes":"NAME,MATCH,CHANGERANGE"}'
node scripts/cli.mjs call fund_data get_fund_kline '{"windcode":"588200.SH","period":"10","count":30}'

# 基金深度（NL）
node scripts/cli.mjs call fund_data get_fund_info '{"question":"易方达蓝筹精选 005827.OF 基金档案"}'
node scripts/cli.mjs call fund_data get_fund_holdings '{"question":"005827.OF 最新一期重仓股"}'

# 文档
node scripts/cli.mjs call financial_docs get_company_announcements '{"query":"贵州茅台 2024 年报","top_k":3}'
node scripts/cli.mjs call financial_docs get_financial_news '{"query":"美联储利率政策","top_k":5}'

# 宏观
node scripts/cli.mjs call economic_data get_economic_data '{"metricIdsStr":"中国GDP"}'

# 通用 fallback
node scripts/cli.mjs call analytics_data get_financial_data '{"question":"中证 500 最近一周表现"}'
```

## 错误恢复

| 问题 | 解决方案 |
|---|---|
| `WIND_API_KEY 未配置` | 先问用户是否同意打开浏览器 → `node scripts/cli.mjs open-portal` → 引导用户配置全局 `~/.wind-aimarket/config` |
| `MCP HTTP 401/403` | API Key 无效或过期 → 重新生成（开发者中心） |
| `MCP HTTP 5xx` | 服务端异常 → 稍后重试，或查 status.wind.com.cn |
| 后端响应"单日请求次数超限" | API Key 当日额度用尽 → 等次日刷新或换 Key |
| `economic_data` 报 `TOOL_RUNTIME_ERROR` | 换 `analytics_data.get_financial_data` 兜底 |
| 行情类工具入参报错 | 行情工具用结构化参数 `{windcode, indexes}`，不要传 `{question}` |
| NL 类工具入参报错 | NL 工具用 `{question}`，不要传 `{windcode}` |
| 工具名报"未知 server_type" 或 "工具不存在" | 先 `list-tools <server_type>` 拿真 schema，按工具表选名 |
| 调用失败但目录不对 | 在本文件（SKILL.md）所在目录下执行命令 |

## 响应前自查

- 🚨 **在本文件（SKILL.md）所在目录下执行命令吗？** 否则一切失败。
- 用户问题是 A 股 / 港股 / 中国宏观 / 中概？是 → 用本 skill；否 → 不要套
- **选对 server_type**（最常出错处）：
  - 股票行情 / K 线 / 分钟 / 档案 / 财务 / 股本 / 事件 / 技术 / 风险 → `stock_data`
  - 基金行情 / K 线 / 分钟 / 档案 / 财务 / 持仓 / 业绩 / 持有人 / 公司 → `fund_data`
  - 公告 / 新闻 → `financial_docs`
  - EDB 宏观 / 行业 → `economic_data`
  - 不确定 / 杂项跨域 → `analytics_data`
- **选对入参模式**（fund_data / stock_data 两类工具）：
  - 行情类（含 `price_indicators` / `kline` / `quote`）→ `{windcode, ...}` 结构化
  - NL 类（财务 / 档案 / 持仓等）→ `{question}` 自然语言
- 工具名拼对：先 `list-tools` 查；不要凭印象写
- 报"未配置 Key"时**先问用户**再跑 `open-portal`，不要无打招呼弹浏览器
- `economic_data` 报错时换 `analytics_data.get_financial_data` 兜底
- 结果呈现时**末尾标注**："数据来源于万得 Wind 金融数据服务"
