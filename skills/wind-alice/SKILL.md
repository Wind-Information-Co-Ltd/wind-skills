---
name: wind-alice
description: 调用万得 Alice Agent（A2A 协议，SSE 流式）执行指定 Skill 并获取分析结果的 CLI 工具。当用户要求"用 Alice 跑某个 Skill"、"出一份某公司的调研问题清单"、"做一页纸投资备忘"、"核验一段金融信息"等需要点名 Alice 子 Skill 的场景使用。
---

# wind-alice

> 一个 CLI：把用户问题 + 指定的 **Alice Skill（中文或英文名均可）** 送到万得 Alice Agent 接口，按 SSE 流式拉取并打印 `agentResult.value`。

---

## 关键机制（必读）

实测：Alice 服务端**不是**通过 `selectedSkillIds` / `activatedSkills` 来选择 Skill 的，而是通过 **prompt 文本前缀**：

```text
Using "<英文 Skill 名>" skill:<原 prompt>
```

同时把 `chatMode` 切到 `"12"`、`originalChatMode` 设为 `"4"`，且**不携带** `metadata.agentCard`。本 CLI 已在 `buildBody` 里封装这套行为；外部只需要传 `--skill "<Skill 名>"`。

因此：

- `--skill` **同时支持中文名和英文名**，不是 id。例如下列写法等价：
  - `--skill "上市公司调研问题清单"` （中文 nameZh）
  - `--skill "Stock DD List"`            （英文 nameEn）
  - `--skill "stock-dd-list"`            （英文模糊：忽略大小写/空格/`-_`）
- 命中后 CLI **统一回填英文名**拼入文本前缀（服务端按英文识别 Skill）。
- 未在 `KNOWN_SKILLS` 中登记的名称会以 `[warn]` 提示，但仍按字面值拼接前缀提交（portal 上新建/改名的 Skill 也能立刻使用）。

---

## 何时使用本技能

满足任一条件就用：

- 用户明确说："用 Alice 跑 / 调 / 执行 …"、"用 Wind 的 XX 技能跑 …"。
- 用户点名 Alice 的某个专业子 Skill（如「上市公司调研问题清单」「公司一页纸」「事实核验」「按主题选股」等）。
- 用户的问题与某个 Skill 的能力高度匹配，且希望走专业链路而不是 auto 路由。

不要用本技能的场景：用户只是普通金融问答、不在意走哪个子 Skill — 让 Alice 自己 auto 路由即可（不传 `--skill`）。

---

## 调用方式（Agent 工作流）

1. 拿到用户问题 → 决定 Skill：
   - 用户点名 Skill → 直接传该 Skill 的**中文名或英文名**到 `--skill`（脚本会自动归一化并回填英文名）；
   - 用户没点名但问题明显属于某 Skill（如「核查事实」「公司调研问题清单」「财报点评」）→ 可建议并征询后再指定；
   - 否则不传 `--skill`，走 auto。
2. **发起调用前**用一句话告知用户：Alice 专业 Skill 耗时常为 **数分钟到十几分钟**（复杂研报、一页纸、可比分析等更久），属正常现象，请耐心等待，**不要中途取消命令或重复发起相同请求**。
3. **先定位本 skill 目录**：下面命令里的 `scripts/wind-alice.mjs` 是相对当前 `SKILL.md` 所在的 `wind-alice` 目录。若当前工作目录不是该目录，先 `cd` 到该目录再执行。
4. 执行（任一种写法都可以）：

```bash
node scripts/wind-alice.mjs --prompt "<USER_QUESTION>" --skill "<中文 Skill 名>"
node scripts/wind-alice.mjs --prompt "<USER_QUESTION>" --skill "<英文 Skill 名>"
```

5. 等流式输出结束后，基于 `agentResult.value` 汇总回复给用户。等待期间若终端长时间无新输出，仍应继续等至进程退出，勿误判为卡死。

> 也可以先列已知 Skill 给用户挑：
>
> ```bash
> node scripts/wind-alice.mjs list-skills
> ```

---

## 一次性配置

1. Node.js 18+（自带 `fetch`）。
2. 配置 **WIND_API_KEY**：
   - 优先级：`WIND_API_KEY` 环境变量 > 本 skill 目录 `config.json`（`{"wind_api_key":"..."}`） > `%USERPROFILE%\.wind-aimarket\config`（dotenv：`WIND_API_KEY=...`）。
   - Key 获取入口：<https://aimarket.wind.com.cn/#/user/overview>。
3. 可选：`WIND_ALICE_API_URL` 覆盖默认接口地址。

---

## 安全要求

- 绝不要输出真实 `WIND_API_KEY`、Bearer token、`config.json` 内容或 `%USERPROFILE%\.wind-aimarket\config` 内容。
- 若需要说明下载方式，只展示 `Authorization: Bearer <WIND_API_KEY>` 这种占位格式；不要拼出含真实 Key 的 curl、PowerShell 或 HTTP 示例。
- Alice 返回的报告 URL 可以在当前用户会话中用于交付和下载；写入 README、示例、工单、提交信息等长期材料时使用占位 URL。

---

## 文件下载处理

许多 Skill（公司一页纸 / 调研问题清单 / 季报点评 / 市场规模测算 / 可比公司分析 等）的 `agentResult.value` 末尾会附一个可下载文件链接。

CLI 在每次调用结束时会自动扫描 value 中的可下载文件链接，并把鉴权头格式提示打到 **stderr**：

```text
下载方式：HTTP GET，请求头携带 Bearer Token
  Authorization: Bearer <WIND_API_KEY>
  (WIND_API_KEY 为万得 AI Market 提供的 apiKey)
```

**重要事实**：

1. 文件接口与 Agent 接口 **共用同一份 `WIND_API_KEY`**（即万得 AI Market 提供的 apiKey），浏览器外的 GET 必须自带 `Authorization: Bearer <WIND_API_KEY>`，否则 401/403。
2. CLI **不会把 Key 打印到日志**，只展示鉴权头格式。
3. 该提示打到 **stderr**，不会污染 stdout 的 `agentResult.value` 主体。

如果用户问"怎么下载这个报告/文件"：可告知文件 URL 和 `Authorization: Bearer <WIND_API_KEY>` 鉴权头格式；不要输出真实 Key。

---

## 硬性要求

1. **PowerShell 下读取本文档必须显式使用 UTF-8**：例如 `Get-Content -Encoding UTF8 skills\wind-alice\SKILL.md`；若看到中文乱码，先按 UTF-8 重新读取，不能基于乱码内容执行。
2. **`--skill` 接受中文或英文 Skill 名**（与 `KNOWN_SKILLS` / portal 一致）。脚本会按 nameEn → nameZh → normalize(nameEn) → normalize(nameZh) 顺序匹配；命中后**统一以 `nameEn` 拼入文本前缀**提交，服务端必须看到英文名才识别。中文别名/缩写/口语表述不会自动翻译，请勿擅自意译；不确定时先 `list-skills`。
3. **Prompt 必须非空**：空白或缺失时直接退出码 2，不发请求。
4. **不得把 Key 打印到日志**：脚本仅在 `Authorization` 头里使用，不会输出到 stdout/stderr。
5. **流式必须等到结束**：CLI 已在父子进程间 `await` 子进程退出；切勿改成"发完即返"。
6. **耗时预期与耐心提示**：调用前须提醒用户 Alice Skill 可能较慢；执行中不得因等待过久而中断 CLI、改走其它工具或并行重复调用同一任务。
7. **不要凭空构造 `selectedSkillIds` / `agentCard` 之类的旧字段去指定 Skill** — 已实测不生效，必须走文本前缀。


## 更新提示处理

每次调用 wind-alice.mjs 后，留意 stderr 是否包含 `[wind-skills] 检测到 N 个 skill 有新版`。

**看到该提示时，会话首次必须转告用户一次**（同会话再次调用不重复）：把清单和升级命令完整带给用户，命令已含 `-g -y` 等参数，直接照搬即可。Gitee 装的 skill 升级路径跟 GitHub 不同，按 stderr 提示走。
