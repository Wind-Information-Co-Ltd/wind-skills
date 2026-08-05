# `economic_data` 工具契约

只用于宏观和行业 EDB 指标。自然语言统一使用 `question`；日期统一使用 `beginDate` / `endDate`。

- 日期字段使用 `beginDate` / `endDate`。
- `仅提数` / `搜索并提数` 必须提供完整日期范围或 `observation`，两者互斥。
- 后端将合法日期误报为 observation 格式错误时，视为后端问题：停止自动修正并透传错误。
- 不得把日期范围擅自改成 `observation`。

## 工具契约

### `natural_language_get_edb_data`

根据自然语言问句或 EDB 指标代码，从 Wind EDB 经济数据库中搜索指标并获取时间序列数据。
支持三种执行模式：
·仅搜索（search）：根据自然语言问句搜索匹配的 EDB 指标，返回指标列表及指标元信息（如指标名称、指标代码、频率、单位等），不返回具体数值数据。
·仅提数（fetch）：根据用户提供的一个或多个 EDB 指标代码获取时间序列数据。
·搜索并提数（searchFetch）：先根据自然语言问句搜索匹配指标，再返回对应指标的时间序列数据。

输入说明：
executionMode：执行模式，可选值为 search、fetch、searchFetch。
question：
当 executionMode=search 或 searchFetch 时，为自然语言查询字符串，例如“中国GDP”“美国CPI”。
当 executionMode=fetch 时，为一个或多个 EDB 指标代码，多个代码使用英文逗号分隔，例如 G0000069,G8411182。
beginDate、endDate：查询时间范围，格式为 yyyy-MM-dd。
observation：观测区间类型，例如 3，表示最近3期数据，与时间范围参数二选一。

调用约束：
当 executionMode=fetch 或 searchFetch 且需要返回具体数值数据时，必须显式提供 beginDate/endDate 或 observation。
不要仅将时间范围描述写入 question 中。

返回结果：
搜索模式返回指标列表及指标元信息。
提数模式返回指标时间序列数据，包含指标代码、指标名称、日期和值。
搜索并提数模式同时返回匹配指标信息及对应时间序列数据。

适用于 EDB 指标发现、指标信息查询、历史数据获取等场景。

| 参数 | 必填 | 类型 | 枚举 | 示例 / 默认 | 官方说明 |
| --- | --- | --- | --- | --- | --- |
| `executionMode` | 是 | string | 仅搜索 / 仅提数 / 搜索并提数 | — | 执行方式。仅搜索：用户只想查找、筛选或推荐宏观经济指标，不需要返回具体数值。仅提数：用户已经给出明确指标代码，需要直接提取数据。搜索并提数：用户用自然语言描述指标并要求返回具体数据，需要先搜索指标再提数。 |
| `question` | 是 | string | — | — | 查询内容。执行方式为【仅提数】时，填入指标代码，多个代码用英文逗号分隔，如 G0000069,G8411182。执行方式为【仅搜索、搜索并提数】时，填入指标或经济数据的自然语言描述，如 中国GDP、上海CPI、出口相关指标。时间范围通过 beginDate/endDate 或 observation 显式传入。 |
| `beginDate` | 否 | string | — | — | 数据提取开始日期，格式为 yyyy-MM-dd。与 observation 互斥；仅在【仅提数、搜索并提数】时生效。 |
| `endDate` | 否 | string | — | — | 数据提取结束日期，格式为 yyyy-MM-dd。与 observation 互斥；仅在【仅提数、搜索并提数】时生效。 |
| `observation` | 否 | string | — | — | 观测期数。近 N 期填写数字字符串，如“近10期”填 `10`；全量数据填 `all`。与 beginDate/endDate 互斥；仅在【仅提数、搜索并提数】时生效。 |
