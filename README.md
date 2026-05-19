# wind-skills

> **Wind 万得金融 Skill 集合（monorepo）** · 通过 MCP 协议把万得金融数据接入 Claude / OpenClaw / Hermes 等 AI Agent，并一站式收录 wind 自家数据 + 社区分析工作流共 36 个金融 skill

[![GitHub](https://img.shields.io/badge/GitHub-Wind--Information--Co--Ltd%2Fwind--skills-blue?logo=github)](https://github.com/Wind-Information-Co-Ltd/wind-skills)

---

## 📦 收录的 Skill

### 技能发现类

| Skill                                                         | 能力域                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`wind-find-finance-skill`](./skills/wind-find-finance-skill) | **金融能力入口**：列举平台所有 skill 并按用户问题推荐，引导安装 / 升级                                                              |

### 数据获取类

| Skill                                                     | 能力域                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`wind-mcp-skill`](./skills/wind-mcp-skill)                   | **访问万得 Wind 金融数据**：股票（A 股/港股/美股行情与财务）、基金（行情与全维数据）、指数/板块、债券、公司公告与新闻、宏观经济指标 |
| [`ifind-finance-data`](./skills/ifind-finance-data)           | **访问同花顺 iFinD 金融数据**：股票、基金、宏观经济、行业经济、新闻公告，支持智能选股/选基                                          |
| [`mx-finance-data`](./skills/mx-finance-data)                 | **访问东方财富金融数据**：A 股/港股/美股、基金、债券等多资产行情与财务，输出 xlsx                                                   |
| [`tushare-finance-skill`](./skills/tushare-finance-skill)     | **访问 Tushare Pro 金融数据**：A 股、港股、美股、基金、期货、债券、财务报表与宏观经济指标                                           |
| [`finance-stream-fetch`](./skills/finance-stream-fetch)       | **金融流式接口调用**：通过本地 Node 脚本向金融 Agent 接口发起 SSE / streamable fetch 请求                                           |

### 金融技能类

| Skill                                                                                   | 一句话                                                       |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`a-share-primary-theme-identification`](./skills/a-share-primary-theme-identification) | A 股市场主线识别（题材周期 / 资金行为）                      |
| [`backtest-expert`](./skills/backtest-expert)                                           | 量化策略系统化回测（压力测试）                               |
| [`breakout_candidate_finder_skill`](./skills/breakout_candidate_finder_skill)           | 筛选形态成熟、放量待发的突破候选股，并给出触发条件           |
| [`bull_bear_case_builder_skill`](./skills/bull_bear_case_builder_skill)                 | 同步搭建看多与看空逻辑，压缩确认偏误并找出核心分歧           |
| [`business_model_decoder_skill`](./skills/business_model_decoder_skill)                 | 把公司如何获客、赚钱、扩张和受限讲清楚                       |
| [`conference_call_takeaway_skill`](./skills/conference_call_takeaway_skill)             | 提炼业绩会关键信息、管理层表态和警讯，服务会后快速吸收要点   |
| [`dcf-model`](./skills/dcf-model)                                                       | DCF 估值建模（WACC + 敏感性分析）                            |
| [`earnings-analysis`](./skills/earnings-analysis)                                       | 季报点评（beat/miss + 估值更新）                             |
| [`equity-investment-thesis`](./skills/equity-investment-thesis)                         | 个股投资逻辑深度研究（券商研究员风格）                       |
| [`guidance_change_impact_skill`](./skills/guidance_change_impact_skill)                 | 解释业绩指引上修下修的含义、可信度与后续影响                 |
| [`high_quality_compounder_finder_skill`](./skills/high_quality_compounder_finder_skill) | 筛选高 ROE、高护城河、可长期复利的核心候选股                 |
| [`institutional_position_shift_skill`](./skills/institutional_position_shift_skill)     | 识别机构持仓变化与共识迁移，服务季报持仓研究                 |
| [`major_announcement_impact_skill`](./skills/major_announcement_impact_skill)           | 分析并购、减持、定增等重大公告的核心影响，服务突发事件判断   |
| [`market_regime_switch_skill`](./skills/market_regime_switch_skill)                     | 判断市场处于进攻、防守、震荡或切换阶段，服务总仓位与风格判断 |
| [`market-environment-analysis`](./skills/market-environment-analysis)                   | 全球市场环境分析（risk-on / risk-off）                       |
| [`moat_strength_review_skill`](./skills/moat_strength_review_skill)                     | 评估公司竞争优势是否真实、可持续且能转化为回报               |
| [`peer_comparison_decision_skill`](./skills/peer_comparison_decision_skill)             | 横向比较候选公司质量、成长、估值与催化，辅助二选一           |
| [`position_sizing_decision_skill`](./skills/position_sizing_decision_skill)             | 按风险预算和波动水平给出单笔仓位与分批建议                   |
| [`position-sizer`](./skills/position-sizer)                                             | 仓位管理（风险 / Kelly / ATR）                               |
| [`post-market-debrief`](./skills/post-market-debrief)                                   | 盘后复盘（市场全景 / 主线轮动）                              |
| [`pullback_opportunity_finder_skill`](./skills/pullback_opportunity_finder_skill)       | 寻找回调充分但趋势未破坏的候选股，定位低吸观察区             |
| [`sec_filing_question_answer_skill`](./skills/sec_filing_question_answer_skill)         | 从 10-K、10-Q、招股书等长文档中精准答疑，服务监管文件快读    |
| [`sector_rotation_radar_skill`](./skills/sector_rotation_radar_skill)                   | 识别板块强弱切换、资金迁移与风格变化，服务市场主线判断       |
| [`stop_loss_discipline_skill`](./skills/stop_loss_discipline_skill)                     | 设计价格、逻辑、时间三类止损规则与执行动作                   |
| [`take_profit_ladder_skill`](./skills/take_profit_ladder_skill)                         | 为盈利仓设计分层兑现、保本上移与尾仓持有规则                 |
| [`theme_leader_identification_skill`](./skills/theme_leader_identification_skill)       | 识别热门题材中的龙头、中军和跟随股，判断谁最值得跟踪         |
| [`theme-detector`](./skills/theme-detector)                                             | 跨板块主题检测（FINVIZ + 生命周期）                          |
| [`trade_plan_builder_skill`](./skills/trade_plan_builder_skill)                         | 下单前生成包含入场、仓位、止损止盈的完整计划                 |
| [`valuation_snapshot_skill`](./skills/valuation_snapshot_skill)                         | 快速判断个股估值高低、所处分位与重估触发条件                 |
| [`valuation-pricing-framework`](./skills/valuation-pricing-framework)                   | 估值与定价框架（重估空间判断）                               |

> `wind-find-finance-skill` 是入口型 meta-skill，不调 MCP server、不需要 API Key。
> `wind-mcp-skill` 用于访问万得 Wind 金融数据，按数据域分类调用。

---

## 🚀 安装

### 📍 关于安装位置（先看一眼）

下方所有命令默认带 `-g`（全局）：

- ✅ **全局** `-g`：装一次，所有项目 + 机器上**所有已识别的 AI agent** 都能用（Claude Code / Cursor / OpenClaw / Hermes 等）。
- 🔒 **仅当前项目**：把命令里的 `-g` **去掉**即可。只装到当前目录，不影响其它项目 / agent。

不确定就用全局（适合金融机构内网跨项目复用）。

### 推荐入口：先装金融能力发现器

```bash
# GitHub
npx skills add Wind-Information-Co-Ltd/wind-skills --skill wind-find-finance-skill -g -y

# Gitee 镜像（国内）
npx skills add https://gitee.com/wind_info/wind-skills.git --skill wind-find-finance-skill -g -y
```

> 想限制在当前项目内，去掉 `-g` 即可。

装好后，用户直接问金融问题即可。AI 会通过 SKILL.md 守则按用户问题筛 1-3 个相关 skill 推荐安装。

### 装单个 skill

```bash
npx skills add Wind-Information-Co-Ltd/wind-skills --skill <skill-name> -g -y
```

把 `<skill-name>` 换成上方表格里的任意 Skill 名称即可。

### 列出仓库内所有可装 skill

```bash
npx skills add Wind-Information-Co-Ltd/wind-skills --list
```

> `-y` 跳过交互菜单（必加）。`-g` 含义见上方"关于安装位置"段。

---

## 🔑 配置 API Key（仅 wind-mcp-skill 需要）

### 让 AI 帮你打开开发者中心拿 Key（推荐）

装好 wind-mcp-skill 后，第一次问行情 / 基金 / 财务 / 公告问题，AI 会发现没 Key 并**主动询问**："要我现在帮你打开万得开发者中心吗？" 同意后，AI 在 SKILL.md 所在目录下运行：

```bash
node scripts/cli.mjs open-portal
```

跨平台自动调浏览器（macOS `open` / Linux `xdg-open` / Windows `start`），打开 `https://aifinmarket.wind.com.cn/#/user/overview`：

- **已登录** → 直接看到个人中心，复制 API Key
- **未登录** → SPA 自动跳到 `/#/login`，登录后回到 overview 即可

### 拿到 Key 后配置（推荐方式 3）

macOS / Linux / Git Bash:

```bash
mkdir -p ~/.wind-aifinmarket && echo "WIND_API_KEY=ak_xxx" > ~/.wind-aifinmarket/config
```

Windows cmd:

```bat
if not exist "%USERPROFILE%\.wind-aifinmarket" mkdir "%USERPROFILE%\.wind-aifinmarket"
echo WIND_API_KEY=ak_xxx > "%USERPROFILE%\.wind-aifinmarket\config"
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.wind-aifinmarket"
Set-Content -Path "$env:USERPROFILE\.wind-aifinmarket\config" -Value "WIND_API_KEY=ak_xxx" -Encoding UTF8
```

### 三级兜底（按优先级）

1. 环境变量 `WIND_API_KEY`
2. SKILL.md 同目录 `config.json`
3. 全局 `~/.wind-aifinmarket/config`（**推荐**，所有 wind skill 共享）

---

## ✅ 验证安装

在支持 skills 的客户端里，直接问一个金融问题即可：

```text
贵州茅台最新股价
```

如果客户端支持查看本地 skill 目录，也可以确认已出现 `wind-find-finance-skill` 和 `wind-mcp-skill`。

---

## 💡 使用示例

安装并配置 Key 后，直接向 AI 提金融问题：

```text
贵州茅台今天最新价
从各个维度分析 600183
查一下科创50ETF最近一个月走势
看一下大盘和各板块怎么样
```

AI 会根据问题自动选择可用能力。取数类问题优先使用 `wind-mcp-skill`；需要分析工作流时，先通过 `wind-find-finance-skill` 推荐合适能力。

---

## 🧭 wind-mcp-skill 的 server_type 选择守则

| 你想问                                                      | server_type                |
| ----------------------------------------------------------- | -------------------------- |
| A 股**最新价 / K 线 / 分钟级行情**                          | `stock_data`（行情类工具） |
| A 股**财报 / 营收 / 净利润 / ROE / 股本 / 技术指标 / 风险** | `stock_data`（NL 类工具）  |
| 港股 / 美股**行情与财务**                                   | `global_stock_data`        |
| ETF / 基金**最新价 / K 线**                                 | `fund_data`（行情类工具）  |
| 任何**基金**（档案 / 持仓 / 业绩 / 经理）                   | `fund_data`（NL 类工具）   |
| 指数 / 板块**行情 / PE/PB / 技术指标**                      | `index_data`               |
| 债券**档案 / 行情估值 / 发债主体**                          | `bond_data`                |
| **公告 / 年报 / 招股书 / 财经新闻**                         | `financial_docs`           |
| **GDP / CPI / M2 / 行业经济**指标                           | `economic_data`            |
| 不确定 / 跨域综合查询                                       | `analytics_data`           |

> `stock_data` / `global_stock_data` / `fund_data` 各包含两类工具：行情类（结构化代码参数）+ NL 类（自然语言）。

更详细的工具表见 [`skills/wind-mcp-skill/SKILL.md`](./skills/wind-mcp-skill/SKILL.md)。

---

## 📂 目录结构

```
wind-skills/
├── README.md                       ← 你现在看的这份
└── skills/                         ← 所有 skill 直接平铺，对齐 npx skills 协议
    ├── wind-find-finance-skill/    ← 入口（无 cli.mjs，纯 SKILL.md + references）
    ├── wind-mcp-skill/             ← 万得 Wind 金融数据访问
    ├── ifind-finance-data/         ← 同花顺 iFinD 金融数据
    ├── mx-finance-data/            ← 东方财富金融数据
    ├── tushare-finance-skill/      ← Tushare Pro 金融数据
    ├── finance-stream-fetch/       ← 金融流式接口调用
    ├── a-share-primary-theme-identification/
    ├── backtest-expert/
    ├── breakout_candidate_finder_skill/
    ├── bull_bear_case_builder_skill/
    ├── business_model_decoder_skill/
    ├── conference_call_takeaway_skill/
    ├── dcf-model/
    ├── earnings-analysis/
    ├── equity-investment-thesis/
    ├── guidance_change_impact_skill/
    ├── high_quality_compounder_finder_skill/
    ├── institutional_position_shift_skill/
    ├── major_announcement_impact_skill/
    ├── market_regime_switch_skill/
    ├── market-environment-analysis/
    ├── moat_strength_review_skill/
    ├── peer_comparison_decision_skill/
    ├── position_sizing_decision_skill/
    ├── position-sizer/
    ├── post-market-debrief/
    ├── pullback_opportunity_finder_skill/
    ├── sec_filing_question_answer_skill/
    ├── sector_rotation_radar_skill/
    ├── stop_loss_discipline_skill/
    ├── take_profit_ladder_skill/
    ├── theme_leader_identification_skill/
    ├── theme-detector/
    ├── trade_plan_builder_skill/
    ├── valuation_snapshot_skill/
    └── valuation-pricing-framework/
```

---

## 🛠️ 兼容 Agent

经实测兼容（同一份 SKILL.md，零适配）：

- ✅ Claude Code / Claude Desktop
- ✅ OpenClaw
- ✅ Hermes Agent
- 🔄 其他遵循 [Anthropic Skill 规范](https://github.com/vercel-labs/skills) 的 agent 理论上可用

---

## 📝 许可

© Wind AIFinMarket 2026
