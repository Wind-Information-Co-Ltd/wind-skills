# wind-skills

> **Wind 万得金融 Skill 集合（monorepo）** · 通过 MCP 协议把万得金融数据接入 Claude / OpenClaw / Hermes 等 AI Agent，并一站式收录 wind 自家数据 + 社区分析工作流共 12 个金融 skill

[![GitHub](https://img.shields.io/badge/GitHub-Wind--Information--Co--Ltd%2Fwind--skills-blue?logo=github)](https://github.com/Wind-Information-Co-Ltd/wind-skills)

---

## 📦 收录的 Skill

### 数据发现类

| Skill | 能力域 |
|---|---|
| [`wind-find-finance-skill`](./skills/wind-find-finance-skill) | **金融能力入口**：列举平台所有 skill 并按用户问题推荐，引导安装 / 升级 |
| [`wind-mcp-skill`](./skills/wind-mcp-skill) | **访问万得 Wind 金融数据**：股票（行情与财务）、基金（行情与全维数据）、公司公告与新闻、宏观经济指标 |

### 金融分析类（社区 winus 收录）

| Skill | 一句话 |
|---|---|
| [`a-share-primary-theme-identification`](./skills/a-share-primary-theme-identification) | A 股市场主线识别（题材周期 / 资金行为） |
| [`backtest-expert`](./skills/backtest-expert) | 量化策略系统化回测（压力测试） |
| [`buffett`](./skills/buffett) | 巴菲特投资思维体系（护城河 / 安全边际） |
| [`dcf-model`](./skills/dcf-model) | DCF 估值建模（WACC + 敏感性分析） |
| [`earnings-analysis`](./skills/earnings-analysis) | 季报点评（beat/miss + 估值更新） |
| [`equity-investment-thesis`](./skills/equity-investment-thesis) | 个股投资逻辑深度研究（券商研究员风格） |
| [`market-environment-analysis`](./skills/market-environment-analysis) | 全球市场环境分析（risk-on / risk-off） |
| [`position-sizer`](./skills/position-sizer) | 仓位管理（风险 / Kelly / ATR） |
| [`post-market-debrief`](./skills/post-market-debrief) | 盘后复盘（市场全景 / 主线轮动） |
| [`theme-detector`](./skills/theme-detector) | 跨板块主题检测（FINVIZ + 生命周期） |
| [`valuation-pricing-framework`](./skills/valuation-pricing-framework) | 估值与定价框架（重估空间判断） |

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

机器可读引导文件见 [`README-skills.md`](./README-skills.md)。已发布到：

```text
https://aimarket.wind.com.cn/skill.md
```

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

跨平台自动调浏览器（macOS `open` / Linux `xdg-open` / Windows `start`），打开 `https://aimarket.wind.com.cn/#/user/overview`：

- **已登录** → 直接看到个人中心，复制 API Key
- **未登录** → SPA 自动跳到 `/#/login`，登录后回到 overview 即可

### 拿到 Key 后配置（推荐方式 3）

```bash
mkdir -p ~/.wind-aimarket && echo "WIND_API_KEY=ak_xxx" > ~/.wind-aimarket/config
```

### 三级兜底（按优先级）

1. 环境变量 `WIND_API_KEY`
2. SKILL.md 同目录 `config.json`
3. 全局 `~/.wind-aimarket/config`（**推荐**，所有 wind skill 共享）

---

## 🧭 wind-mcp-skill 的 server_type 选择守则

| 你想问 | server_type |
|---|---|
| 茅台**最新价 / K 线 / 分钟级行情** | `stock_data`（行情类工具） |
| 茅台**财报 / 营收 / 净利润 / ROE / 股本 / 技术指标 / 风险** | `stock_data`（NL 类工具） |
| ETF / 基金**最新价 / K 线** | `fund_data`（行情类工具） |
| 任何**基金**（档案 / 持仓 / 业绩 / 经理） | `fund_data`（NL 类工具） |
| 茅台**最新公告 / 年报 / 招股书 / 财经新闻** | `financial_docs` |
| **GDP / CPI / M2 / 行业经济**指标 | `economic_data` |
| 不确定 / 跨域综合查询 | `analytics_data` |

> fund_data / stock_data 各包含两类工具：行情类（结构化代码参数）+ NL 类（自然语言）。

更详细的工具表见 [`skills/wind-mcp-skill/SKILL.md`](./skills/wind-mcp-skill/SKILL.md)。

---

## 📂 目录结构（v6.0 平铺）

```
wind-skills/
├── README.md                       ← 你现在看的这份
├── skill.md                        ← 面向 AI Agent 的站点级入口引导
└── skills/                         ← 所有 skill 直接平铺，对齐 npx skills 协议
    ├── wind-find-finance-skill/    ← 入口（无 cli.mjs，纯 SKILL.md + references）
    ├── wind-mcp-skill/             ← 万得 Wind 金融数据访问
    ├── a-share-primary-theme-identification/
    ├── backtest-expert/
    ├── buffett/
    ├── dcf-model/
    ├── earnings-analysis/
    ├── equity-investment-thesis/
    ├── market-environment-analysis/
    ├── position-sizer/
    ├── post-market-debrief/
    ├── theme-detector/
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

## 🗺️ 路线图

- [x] 全平台 SKILL.md 守则驱动，AI 按问题自动路由
- [x] wind-mcp-skill：访问万得 Wind 全维金融数据
- [x] 顶层 `README-skills.md` 双路径引导（发现器 / 直接装数据 skill）
- [ ] 触发率回归测试集（50 条真实金融问句）
- [x] 将 `README-skills.md` 发布到 `https://aimarket.wind.com.cn/skill.md`
- [ ] 评估收录第三方数据源作为可选数据 skill

---

## 📝 许可

© Wind AIMarket 2026
