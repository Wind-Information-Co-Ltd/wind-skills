---
name: wind-find-finance-skill
description: AIMarket 金融能力发现器。当用户问金融数据 / 分析 / 工具相关问题,且 AI 不确定用哪个具体 skill 时,触发本 skill 列举平台可用能力并给出安装命令。
---

# 触发时机

用户问以下任一情况时触发:

1. "有什么金融能力 / 推荐什么金融工具 / 平台能做什么"
2. 提了具体金融问题(行情 / 基金 / 财务 / 估值 / 选股 / 回测 / 复盘 / 公告 / 宏观等)但 AI 不确定用哪个 skill
3. 问 AIMarket / Wind 平台元问题

# 不触发场景

1. 用户已明确指定某个具体 skill("用 wind-mcp-skill 查茅台" / "用 buffett 分析这家公司")→ 直接走那个 skill,不绕本入口

2. 用户问的是**取数 / 查询类**问题(行情 / 财务 / 基金 / 公告 / 新闻 / 宏观),且本机**已装** wind-mcp-skill → 直接调用 wind-mcp-skill,不绕本入口

3. 用户问的是**分析类**问题(估值 / 复盘 / 选股 / 回测 / 个股研究 / 主线识别),且对应分析 skill **已装** → 直接走那个 skill,不绕本入口

> **简言之:本 skill 只在"用户需要的能力还没装好"时触发**

---

# 推荐策略(按用户提问类型路由)

| 用户提问类型 | 推什么 | 推几个 |
|---|---|---|
| **取数 / 查询**(行情、基金、财务、公告、新闻、宏观)| 数据 skill(目前 = wind-mcp-skill)| 1 个 |
| **做分析**(估值 / 复盘 / 选股 / 回测 / 个股研究 / 市场主线)| 数据 skill + 对应分析 skill 组合 | 2 个 |
| **探索**("你们能做啥" / "我想研究 A 股")| 各 category 各 1 个样例 | 3-5 个 |

**永远附 wind-mcp-skill 作数据底座**,除非用户明确不要数据。

---

# 流程

1. 用 Read 读 `references/skills-catalog.md` → 拿全清单
2. 判别用户提问类型(取数 / 分析 / 探索)
3. 按推荐策略筛 1-5 个相关 skill
4. 每个推荐 skill 输出**装包卡片**(见模板)
5. 末尾固定追加**升级提示一句话**(见下)

---

# 装包卡片模板

每个推荐的 skill 按以下格式给:

```
推荐 <name> · <一句话描述>
为什么:<基于用户问题的一句话解释>

安装命令(全局,推荐 — GitHub):
  npx skills add Wind-Information-Co-Ltd/wind-skills --skill <name> -g -y

安装命令(全局,推荐 — Gitee 镜像):
  npx skills add https://gitee.com/wind_info/wind-skills.git --skill <name> -g -y

[如果用户问"我只想在当前项目用"或类似,追加这一段:]
仅当前项目:把上面命令的 -g 去掉即可(只装到当前目录)。

[如果 catalog "装好需配置" 列 = "API Key",追加这一段:]
首次使用提示:装好后向我提一个金融数据问题,我会引导你登录
aimarket.wind.com.cn/#/user/overview 拿 API Key

[如果是分析 skill 且没在同次推荐里附数据 skill,追加:]
配套数据:推荐同时装 wind-mcp-skill 作数据底座
```

---

# 参数说明(必读)

- **`-g` / `--global`**:全局安装 — 跨项目 + 跨 AI agent 共享(自动 symlink 到机器上所有已识别 agent)。金融机构内网推荐。
- **去掉 `-g`**:仅当前项目 — 装到当前目录,只有当前项目的 AI 能识别,不污染其它项目 / agent。
- **`-y` / `--yes`**:**必加**,跳过交互菜单(不加会卡)
- **`--skill <name>`**:从 monorepo 抽指定子 skill 装;不写会装全部 skill

---

# 升级提示(每次回答末尾固定追加)

```
> 想看最新平台能力可跑 `npx skills update -g -y` 同步本地清单。
```

含义:`update` 重拉所有已装 skill 最新版,`-g` 只升级全局 skill,`-y` 跳过 scope 提示。

---

# 边界

- 本 skill **不调用任何 MCP server**,**不需要 API Key**
- 本 skill **不写用户本地任何文件**
- **不做**远端 WebFetch diff(catalog.md 由 `npx skills update -g -y` 自动同步,不需要 AI 实时比对)
- `references/skills-catalog.md` 是 skill 包打包时的快照,跟着 skill 包一起 push / update
