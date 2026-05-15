---
name: aimarket-skills-catalog
description: AIMarket 平台 skill 清单本地副本。由 npx skills update -g -y 随 wind-find-finance-skill 一起更新。
---

# AIMarket Skill 目录

> 平台所有可装 skill 的清单。
> 由 `npx skills update -g -y` 随 wind-find-finance-skill 一起更新。

---

## 数据类(取数 / 查询)

> 取数 / 查询:行情、基金、股票财务、公告、新闻、宏观指标。

| 名称                  | category                              | 装好需配置     | 一句话                                                                                                                                  |
| --------------------- | ------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| wind-mcp-skill        | 数据-行情/基金/股票/宏观/文档         | API Key        | 访问万得 Wind 金融数据:A 股 / 港股股票(行情与财务) + ETF / 公募基金(行情与全维数据) + 公司公告 + 财经新闻 + 宏观经济指标                |
| wind-alice            | Alice 专业金融分析 Agent              | API Key        | Alice 综合分析入口,适合事实核验、公司一页纸、调研问题清单、财报点评、主题选股、基金分析、宏观/债券/信用分析、市场规模测算和可比公司分析 |
| ifind-finance-data    | 数据-行情/基金/宏观/新闻公告/智能选股 | API Key        | 访问同花顺 iFinD 金融数据:股票、基金、宏观经济、行业经济、新闻公告,并支持智能选股、选基与指标搜索                                       |
| mx-finance-data       | 数据-结构化查询/行情/财务/估值/多资产 | 依赖 + API Key | 访问东方财富数据库:覆盖 A 股 / 港股 / 美股、基金、债券等多资产结构化数据,输出 xlsx 与结果说明文件                                       |
| tushare-finance-skill | 数据-行情/财务/宏观/多资产            | 依赖 + Token   | 访问 Tushare Pro 金融数据:覆盖 A 股、港股、美股、基金、期货、债券、财务报表与宏观经济指标                                               |

---

## 工作流类(决策 / 分析)

> 决策 / 工作流:估值、复盘、选股、回测、个股研究、市场主线。

| 名称                                 | category                 | 装好需配置 | 一句话                                                                                                                                  |
| ------------------------------------ | ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| dcf-model                            | 估值                     | 无         | DCF 估值建模(WACC + 敏感性分析)                                                                                                         |
| earnings-analysis                    | 估值-季报                | 无         | 季报点评(beat/miss + 估值更新)                                                                                                          |
| valuation-pricing-framework          | 估值                     | 无         | 估值与定价框架(重估空间判断)                                                                                                            |
| equity-investment-thesis             | 个股研究                 | 无         | 个股投资逻辑深度研究(券商研究员风格)                                                                                                    |
| a-share-primary-theme-identification | 市场主线                 | 无         | A 股市场主线识别(题材周期 / 资金行为)                                                                                                   |
| market-environment-analysis          | 市场主线                 | 无         | 全球市场环境分析(risk-on / risk-off)                                                                                                    |
| theme-detector                       | 市场主线                 | 无         | 跨板块主题检测(FINVIZ + 生命周期)                                                                                                       |
| post-market-debrief                  | 复盘                     | 无         | 盘后复盘(市场全景 / 主线轮动)                                                                                                           |
| position-sizer                       | 仓位                     | 无         | 仓位管理(风险 / Kelly / ATR)                                                                                                            |
| backtest-expert                      | 回测                     | 无         | 量化策略系统化回测(压力测试)                                                                                                            |
| valuation_snapshot_skill             | 估值                     | 无         | 快速判断个股估值高低、所处分位与重估触发条件                                                                                            |
| bull_bear_case_builder_skill         | 个股研究                 | 无         | 同步搭建看多与看空逻辑，压缩确认偏误并找出核心分歧                                                                                      |
| peer_comparison_decision_skill       | 个股研究                 | 无         | 横向比较候选公司质量、成长、估值与催化，辅助二选一                                                                                      |
| moat_strength_review_skill           | 个股研究                 | 无         | 评估公司竞争优势是否真实、可持续且能转化为回报                                                                                          |
| business_model_decoder_skill         | 个股研究                 | 无         | 把公司如何获客、赚钱、扩张和受限讲清楚                                                                                                  |
| major_announcement_impact_skill      | 事件/公告/财报文档       | 无         | 分析并购、减持、定增等重大公告的核心影响，服务突发事件判断                                                                              |
| conference_call_takeaway_skill       | 事件/公告/财报文档       | 无         | 提炼业绩会关键信息、管理层表态和警讯，服务会后快速吸收要点                                                                              |
| guidance_change_impact_skill         | 事件/公告/财报文档       | 无         | 解释业绩指引上修下修的含义、可信度与后续影响                                                                                            |
| sec_filing_question_answer_skill     | 事件/公告/财报文档       | 无         | 从 10-K、10-Q、招股书等长文档中精准答疑，服务监管文件快读                                                                               |
| sector_rotation_radar_skill          | 市场主线                 | 无         | 识别板块强弱切换、资金迁移与风格变化，服务市场主线判断                                                                                  |
| market_regime_switch_skill           | 市场主线                 | 无         | 判断市场处于进攻、防守、震荡或切换阶段，服务总仓位与风格判断                                                                            |
| institutional_position_shift_skill   | 市场主线                 | 无         | 识别机构持仓变化与共识迁移，服务季报持仓研究                                                                                            |
| theme_leader_identification_skill    | 市场主线/选股            | 无         | 识别热门题材中的龙头、中军和跟随股，判断谁最值得跟踪                                                                                    |
| breakout_candidate_finder_skill      | 选股                     | 无         | 筛选形态成熟、放量待发的突破候选股，并给出触发条件                                                                                      |
| pullback_opportunity_finder_skill    | 选股                     | 无         | 寻找回调充分但趋势未破坏的候选股，定位低吸观察区                                                                                        |
| high_quality_compounder_finder_skill | 选股                     | 无         | 筛选高 ROE、高护城河、可长期复利的核心候选股                                                                                            |
| trade_plan_builder_skill             | 交易执行                 | 无         | 下单前生成包含入场、仓位、止损止盈的完整计划                                                                                            |
| position_sizing_decision_skill       | 交易执行/仓位            | 无         | 按风险预算和波动水平给出单笔仓位与分批建议                                                                                              |
| stop_loss_discipline_skill           | 交易执行                 | 无         | 设计价格、逻辑、时间三类止损规则与执行动作                                                                                              |
| take_profit_ladder_skill             | 交易执行                 | 无         | 为盈利仓设计分层兑现、保本上移与尾仓持有规则                                                                                            |
| wind-alice                           | Alice 专业金融分析 Agent | API Key    | Alice 综合分析入口,适合事实核验、公司一页纸、调研问题清单、财报点评、主题选股、基金分析、宏观/债券/信用分析、市场规模测算和可比公司分析 |

---

## category 索引(用户问"探索"时用)

| category                      | 含 skill 数 | 代表 skill                           |
| ----------------------------- | ----------- | ------------------------------------ |
| 数据-行情/基金/股票/宏观/文档 | 4           | wind-mcp-skill                       |
| Alice 专业金融分析 Agent      | 1           | wind-alice                           |
| 估值                          | 4           | dcf-model                            |
| 个股研究                      | 5           | equity-investment-thesis             |
| 事件/公告/财报文档            | 4           | major_announcement_impact_skill      |
| 市场主线                      | 7           | a-share-primary-theme-identification |
| 选股                          | 4           | breakout_candidate_finder_skill      |
| 复盘                          | 1           | post-market-debrief                  |
| 仓位                          | 2           | position-sizer                       |
| 交易执行                      | 4           | trade_plan_builder_skill             |
| 回测                          | 1           | backtest-expert                      |

---

## 安装公式

把命令里的 `<name>` 换成上表"名称"列的值:

```bash
# 全局安装(推荐 — 跨项目 + 跨 AI agent 共享)
# 国外(GitHub)
npx skills add Wind-Information-Co-Ltd/wind-skills --skill <name> -g -y
# 国内(Gitee 镜像)
npx skills add https://gitee.com/wind_info/wind-skills.git --skill <name> -g -y
```

> 想限制在当前项目内用,把上面命令的 `-g` 去掉即可。

参数说明:

- `-g`:全局安装 — 跨项目 + 自动 symlink 到机器上所有已识别 AI agent(Claude Code / Cursor / OpenClaw / Hermes 等)。金融机构内网推荐。
- 去掉 `-g`:仅当前项目 — 装到当前目录,不影响其它项目 / agent。
- `-y`:**必加**,跳过交互菜单(不加会卡)

---

## 升级所有已装 skill

```bash
npx skills update -g -y
```

含义:`update` 重拉所有已装 skill 最新版,`-g` 只升级全局,`-y` 跳过 scope 提示。
