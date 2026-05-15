# wind-alice

> **CLI · 调用万得 Alice Agent，执行指定 Skill 并流式输出分析结果**

`wind-alice` 是一个本机 CLI，把用户问题与 **指定的 Alice Skill（中/英文均可）** 一并送到万得 Alice Agent（A2A 协议，SSE 流式）：

- 通过 `--skill "<Skill 名>"` 选择 Alice 下的专业子 Skill（如 `上市公司调研问题清单` / `Stock DD List`、`公司一页纸` / `Company One-Page Investment Memo`、`事实核验` / `Fact Check` …）。
- 不传 `--skill` 时由服务端 auto 路由。
- 流式拉取 SSE 事件，自动抽取并打印 `agentResult.value`。

---

## 使用注意

- 不要把真实 `WIND_API_KEY` 写入文档、工单、邮件或聊天记录；示例统一使用 `<WIND_API_KEY>` / `<KEY>` 占位。
- `config.json`、`%USERPROFILE%\.wind-aimarket\config` 和本地环境变量只用于本机配置。
- Alice 返回的报告链接可用于当前用户下载报告；产品文档和公开示例中使用占位 URL 即可。

---

## 关键机制

实测：Alice 服务端**不靠 `selectedSkillIds` 选 Skill**，而是看 prompt 文本前缀：

```text
Using "<英文 Skill 名>" skill:<原 prompt>
```

同时把 `chatMode` 切到 `"12"`、`originalChatMode` 设为 `"4"`，**不携带** `metadata.agentCard`。本 CLI 已在 `scripts/request.js` 的 `buildBody` 里封装：

- 传了 `--skill` → 自动按上面格式拼前缀 + 精简 data。
- 没传 `--skill` → 沿用经过验证的 auto 旧格式（`chatMode:"0"` + 简化 `agentCard`），不影响普通问答。

---

## 安装 / 链接为终端命令

包内已声明 `bin`：

- `wind-alice`
- 短别名 `wa`

### 方式一：`npm link`

先进入 `wind-alice` 目录。`<wind-skills-repo>` 指包含 `skills\wind-alice` 的仓库根目录或项目目录；如果已经在该目录下，也可以直接 `cd skills\wind-alice`：

```powershell
cd <wind-skills-repo>\skills\wind-alice
npm link
```

确保 npm 全局 bin 目录（Windows 默认 `%AppData%\npm`）在 `PATH` 里。然后：

```powershell
wind-alice --help
wa list-skills
```

### 方式二：不 link，用 npx 指向本目录

同样先进入 `wind-alice` 目录：

```powershell
cd <wind-skills-repo>\skills\wind-alice
npx . --prompt "贵州茅台调研问题清单" --skill "Stock DD List"
```

> 若 PowerShell 因执行策略阻止 `npx.ps1`，改用 `npx.cmd .` 或直接 `node .\scripts\wind-alice.mjs ...`。

---

## 配置

需要 `WIND_API_KEY`，按以下优先级查找：

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1 | 环境变量 `WIND_API_KEY` | 临时会话最常用 |
| 2 | `<skill 目录>\config.json` | JSON：`{"wind_api_key":"..."}` |
| 3 | `%USERPROFILE%\.wind-aimarket\config` | dotenv：`WIND_API_KEY=...`；多个 wind skill 共用 |

可选：`WIND_ALICE_API_URL` 覆盖默认接口地址（默认 `https://alice.wind.com.cn/Weaver/ChatAgent`）。

获取 Key：<https://aimarket.wind.com.cn/#/user/overview>。

---

## 用法

```text
wind-alice --prompt <QUESTION> [--skill <SKILL_NAME>]
wind-alice list-skills
wind-alice --help

Options:
  --prompt, -p <QUESTION>     用户提问（必填，list-skills 除外）
  --skill,  -s <SKILL_NAME>   Alice Skill 名，**中英文均可**：
                                · 中文：如 "上市公司调研问题清单"
                                · 英文：如 "Stock DD List"
                              英文部分忽略大小写/空白/连字符/下划线模糊匹配；
                              不传走 auto。
  --list-skills               列出已知 Skill
  --help,   -h                查看帮助
```

### 匹配规则 / 模糊示例

按以下顺序匹配，**命中即停**；命中后**统一以英文名（nameEn）拼入文本前缀**提交（服务端按英文识别 Skill）：

1. `nameEn` 字面相等
2. `nameZh` 字面相等
3. `normalize(nameEn)` 相等（小写化 + 去 `空白/-_&"'`）
4. `normalize(nameZh)` 相等

下列写法都会解析到 `Stock DD List`：

| `--skill` 输入 | 命中方式 |
| --- | --- |
| `Stock DD List` | nameEn 字面 |
| `上市公司调研问题清单` | nameZh 字面 |
| `stock dd list` / `stock-dd-list` / `Stock_DD_List` / `stockddlist` | nameEn 模糊 |

不在 `KNOWN_SKILLS` 中的名称会以 `[warn]` 提示，但仍按字面值拼前缀提交（portal 上新建/改名的 Skill 也能立刻使用，只是不可靠）。

### 调用示例

```powershell
# 列出已知 Skill
wind-alice list-skills

# 用中文名调用（推荐：与用户口径一致）
wind-alice --prompt "贵州茅台" --skill "上市公司调研问题清单"
wa -p "贵州茅台 600519" -s "公司一页纸"
wind-alice -p "贵州茅台 2025 年营收 1720 亿，请核查" -s "事实核验"

# 用英文名调用
wind-alice --prompt "贵州茅台" --skill "Stock DD List"
wa -p "贵州茅台 600519" -s "Company One-Page Investment Memo"

# 英文模糊匹配也行
wind-alice -p "贵州茅台" -s stock-dd-list

# 不指定 skill（auto）
wind-alice --prompt "今日 A 股要点"
```

---

## 已知 Skill

> `--skill` 同时接受中文名（第一列）和英文名（第二列），下表为当前内置的已知 Skill 清单。

| 中文名 | 英文 Skill 名（`--skill` 传值） | 一句话说明 |
| --- | --- | --- |
| 通胀情景债券轮动策略 | `Inflation Bond Strategy` | CPI/PPI 拐点信号驱动的债券-货基切换或久期轮动，含回测 |
| 宏观数据解读 | `Macro Data Interpretation` | CPI/PPI/PMI/GDP/社融 等宏观指标 → 研究周报式解读 |
| 按主题选股 | `Thematic Stock Screening` | 拆解市场主线、验证逻辑、筛真受益标的并给估值/交易视角 |
| 债券利率走势研判 | `Bond Rate Outlook` | 交易/策略/配置三视角，五维度量化打分 + 压力测试 |
| 信用分析 | `Credit Analysis` | 主体信用、财务/现金流、评级对标、违约概率（接 Wind 风险评分） |
| 基金对比分析 | `Fund Compare` | 多只基金业绩/风险/持仓/管理对比报告，可中立或带倾向 |
| 基金筛选与投资建议 | `Fund Screening & Investment Advisory` | 投顾视角的多维筛选、对比与个性化配置建议 |
| 投资标的创意与筛选 | `Investment Idea Generation` | 量化因子 + 主题扫描，输出含逻辑/催化剂/风险的一页纸 |
| 公司一页纸 | `Company One-Page Investment Memo` | 上市公司一页纸投资报告（A/港/美 等） |
| 上市公司调研问题清单 | `Stock DD List` | 买方视角调研备忘录 + 3-5 深度议题与管理层提问 |
| 全球上市公司季报点评 | `Global Share Quarterly Earnings Review` | 卖方风格「标题 + 五段式」一页财报点评 |
| 市场规模测算与战略建模 | `Market Sizing & Strategic Modeling` | 结构化市场规模建模：Top-down/Bottom-up/交叉验证 + 情景敏感性 |
| 可比公司分析 | `fsi-comps-analysis` | 机构级 Comps Analysis（Excel + 文字报告） |
| 事实核验 | `Fact Check` | 粘贴文本逐点核查金融数据/声明/事件，输出结构化报告 |

> 服务端如新增 / 改名 Skill，请以 `wind-alice list-skills` 的输出为准。

---

## 目录结构

```text
wind-alice/
├── README.md              # 使用说明
├── SKILL.md               # Agent 调用规则
├── package.json           # 命令入口声明
└── scripts/
    ├── wind-alice.mjs     # CLI 入口
    ├── request.js         # 请求、流式解析与结果输出
    ├── uuidv7.js          # ID 生成
    ├── update-check.mjs   # 更新检查
    └── update-notify.mjs  # 更新提示
```

---

## 文件下载

许多 Skill 的输出（如「公司一页纸」「上市公司调研问题清单」「全球上市公司季报点评」「市场规模测算」「可比公司分析」）末尾会附一个 Markdown 链接，例如：

```text
[贵州茅台_600519_SH_一页纸投资报告_20260514.md](https://alice.wind.com.cn/weaver/files/<uuid>/贵州茅台_600519_SH_一页纸投资报告_20260514.md)
```

这个 `alice.wind.com.cn/weaver/files/...` 接口受**同一份 `WIND_API_KEY`** 鉴权（与调用 Agent 用的是同一个 Key）；浏览器外直接 GET 会 401/403。

`wind-alice` 在每次调用结束时会**自动扫描 `agentResult.value` 中的可下载文件链接**（基于 `/files/` 路径或常见文件后缀），并把带鉴权头格式的下载提示打印到 **stderr**，不会污染 stdout 的主输出。文档示例使用占位 URL；实际使用时按 CLI 输出的链接下载即可：

```text
=== 检测到 1 个可下载文件 ===
- 贵州茅台_600519_SH_一页纸投资报告_20260514.md
  URL: https://alice.wind.com.cn/weaver/files/<uuid>/贵州茅台_600519_SH_一页纸投资报告_20260514.md

下载方式：HTTP GET，请求头携带 Bearer Token
  Authorization: Bearer <WIND_API_KEY>
  (WIND_API_KEY 为万得 AI Market 提供的 apiKey)
```

**注意事项**

- 该提示打到 **stderr**，与 stdout 的 `agentResult.value` 主体分离；`wind-alice ... 1>out.txt` 不会把下载提示重定向到 `out.txt`。
- 文件名按 URL path 末段 `decodeURIComponent` 取得；URL 末尾的标点（`)`、`,` 等）会自动剥离。
- 文件接口与 Agent 接口**共用同一份 `WIND_API_KEY`**，下载请求必须带 `Authorization: Bearer <KEY>`，否则 401/403。

## 实现要点

- **指定 Skill 走文本前缀**
  - `parts[0].text = 'Using "<nameEn>" skill:<原 prompt>'`
  - `parts[1].data = { chatMode:"12", originalChatMode:"4", switchMode:"auto", timezone:"Asia/Shanghai" }`
  - 不带 `metadata.agentCard`、不带 `selectedSkillIds`、不带 `activatedSkills`。
- **auto 模式（不指定）维持旧格式**：`chatMode:"0"` + 简化 `agentCard`，与历史已验证调用一致。
- **`switchMode` 固定 `auto`**：实测 `manual` 会立即返回 `200 + 空 SSE 流`。
- **环境变量覆盖**：`WIND_ALICE_API_URL` 可覆盖默认接口地址；`WIND_API_KEY` 是必填鉴权。
- **稳定退出**：CLI 入口 `wind-alice.mjs` 通过 `await once(child, "exit")` 等子进程结束，避免 Windows 终端下父进程提前退出导致只看到 `status/headers`。

## 升级

```bash
npx skills update wind-alice -g -y
```

调用时 stderr 若提示有新版，按提示走即可。
