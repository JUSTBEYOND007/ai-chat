# Flow-Chat Agentic RAG 秋招开发路线 TODO

初始日期：2026-07-23  
最近重规划：2026-07-25  
目标岗位：前端开发、AI 前端、偏前端的 AI 全栈岗位  
当前定位：具备流式可靠性、文件处理与知识库问答能力的 AI 全栈聊天平台

## 最终项目定位

将当前项目深化为：

```text
一个具备可靠流式通信、可观测工具调用、多轮记忆、
可解释混合检索和离线评测能力的 Agentic RAG 平台。
```

开发原则：

- 前端能力是主线：复杂状态管理、Agent Trace、流式渲染和交互可靠性必须可讲清楚。
- Agent 能力做深不做多：优先完成受控的单 Agent 工具调用闭环。
- 全栈能力作为加分项：接口、数据模型、任务状态、安全边界和测试形成闭环。
- 每个功能都要有设计取舍、失败处理、验收标准和技术文档。
- 未完成运行验证的功能，不在简历中描述为“已稳定上线”。

## 当前基础能力

- [x] React + TypeScript + Zustand 前端架构。
- [x] NestJS + TypeORM + PostgreSQL 后端架构。
- [x] JWT 登录鉴权和用户、会话、消息基础模型。
- [x] SSE 流式回答与打字机渲染。
- [x] `generationId + seq` 断流续传与事件去重。
- [x] `clientMessageId` 消息幂等。
- [x] IndexedDB 本地消息缓存和弱网待发送队列。
- [x] 大文件分片上传、Hash 校验、断点续传与服务端合并。
- [x] PostgreSQL + pgvector 文档知识库。
- [x] TXT、Markdown、PDF 文档解析和向量入库。
- [x] RAG 回答与引用来源展示。
- [x] RAG 接入正式聊天 SSE 和消息历史持久化。
- [x] 知识库文档删除、失败重试和类型/大小限制。
- [x] 轻量 Tool Registry、`knowledge_search`、`calculator` 和受控 Agent Loop。
- [x] 结构化 Agent SSE、断流事件重放和 Agent Trace。
- [x] Context Builder、Token Budget 和跨知识库历史隔离。
- [x] 分作用域 Summary Memory 和摘要失败回退。

## 阶段一：轻量 Agent Runtime

优先级：P0  
目标：让模型根据问题自主决定是否调用工具，形成真正的 Agent 闭环。

### 1.1 Agent 数据协议

- [x] 定义 `AgentContext`：用户、会话、知识库、消息和生成批次信息。
- [x] 定义 `AgentTool` 接口：名称、描述、参数 Schema 和执行函数。
- [x] 定义 `ToolCall`、`ToolResult`、`AgentStep`、`AgentRunResult` 类型。
- [x] 定义工具执行状态：`pending | running | completed | failed`。
- [x] 定义 Agent 运行状态：`planning | tool_running | answering | completed | failed`。
- [x] 使用 Zod 或等价方案校验模型生成的工具参数。
- [x] 为工具调用生成稳定的 `toolCallId`，用于 SSE、数据库和前端关联。

### 1.2 Tool Registry

- [x] 实现 `ToolRegistry`，支持注册、查找和列出可用工具。
- [x] 禁止模型调用未注册工具。
- [x] 为每个工具配置最大执行时间。
- [x] 统一工具成功、失败和超时返回结构。
- [x] 工具执行器当前不记录密钥、原始上下文或敏感用户数据。

### 1.3 第一批工具

- [x] `knowledge_search`：检索用户拥有的指定知识库。
- [x] `calculator`：执行受控数学运算，不允许直接 `eval`。
- [ ] `document_summary`：获取指定文档片段并生成摘要。
- [x] 按工具风险补充参数校验和用户权限校验。
- [x] 为 Registry、执行器和首批工具补充正常、参数错误、无权限和超时测试。

### 1.4 Agent 执行循环

- [x] 模型首次调用时携带当前上下文可用的工具定义。
- [x] 解析模型返回的 OpenAI-compatible Tool Calling。
- [x] 执行工具后将结构化结果追加回模型上下文。
- [x] 模型可以继续调用工具或输出最终回答。
- [x] 最大工具调用轮数默认限制为 3 次，防止无限循环。
- [x] Agent 总执行时间默认设置为 45 秒。
- [x] 工具失败后允许模型根据结构化错误生成可理解的最终回答。
- [x] 普通文本对话和 Agent 对话共用消息持久化体系。
- [x] 保存完整 `toolCalls`、耗时和最终回答状态。

### 1.5 阶段验收

- [ ] 普通问候不调用工具，直接回答。
- [ ] 文档问题由模型自主调用 `knowledge_search`。
- [ ] 数学问题由模型自主调用 `calculator`。
- [x] 不存在或当前上下文不可用的工具不会被执行。
- [x] 连续工具调用超过上限时安全终止。
- [x] 刷新后能从消息历史恢复工具调用记录。
- [x] 新增当前迭代技术文档并记录架构取舍。

## 阶段二：结构化 SSE 与 Agent Trace UI

优先级：P0  
目标：实时展示 Agent 的规划、工具执行、检索和回答过程，突出 AI 前端能力。

### 2.1 SSE 事件协议

- [x] 定义统一事件：`generation_start`。
- [x] 定义统一事件：`planning`。
- [x] 定义统一事件：`tool_start`。
- [x] 定义统一事件：`tool_result`。
- [x] 定义统一事件：`answer_chunk`。
- [x] 定义统一事件：`complete`。
- [x] 定义统一事件：`error`。
- [x] 所有事件统一携带 `generationId`、`seq` 和时间戳。
- [x] 工具事件携带 `toolCallId`，保证开始事件和结果事件可以配对。
- [x] 断流重连继续使用 `generationId + afterSeq` 重放遗漏事件。

### 2.2 前端 StreamChatClient

- [x] 将现有 chunk/complete/error 解析扩展为 Agent 事件解析。
- [x] 对重复 `seq` 事件进行过滤。
- [x] 重连后根据稳定 Step ID 合并已接收的工具事件。
- [x] 切换会话时，事件继续写入原会话状态。
- [x] 用户主动停止生成时，将前端未完成 Agent Step 标记为 interrupted。
- [x] 页面刷新后从消息历史的 `agentSteps` 恢复 Agent Trace。

### 2.3 Agent Trace 组件

- [x] 实现 Agent 执行时间线组件。
- [x] 展示正在分析、正在调用工具和正在生成回答等状态。
- [x] 展示工具名称、参数、耗时和执行状态。
- [x] `knowledge_search` 展示命中数量，并保留引用片段展示。
- [x] 工具结果默认折叠，支持展开查看。
- [ ] 工具失败时提供重试入口。
- [x] 工具失败时展示失败原因。
- [x] Agent 完成后仍保留执行过程。
- [x] 虚拟列表通过 ResizeObserver 响应 Trace 展开/折叠高度变化。

### 2.4 阶段验收

- [ ] 用户能实时看到 Agent 从规划到回答的完整过程。
- [x] 工具开始和结果事件通过 `toolCallId` 配对。
- [x] 断网重放事件按 `seq` 去重，Step 按稳定 ID 合并。
- [x] 刷新后 Trace、回答和引用均可从消息历史恢复。
- [x] 新增本阶段技术文档和 SSE 事件协议说明。

## 阶段三：多轮记忆与上下文管理

优先级：P1  
目标：解决长会话上下文无限增长，并支持基于历史语义的多轮追问。

### 3.1 Context Builder

- [x] 新增统一 `ContextBuilder`。
- [x] 组合系统提示词、最近消息和紧凑历史工具摘要。
- [x] 将历史摘要纳入 Context Builder。
- [ ] 将 RAG 片段统一纳入 Context Builder。
- [x] 最近消息按照会话时间顺序加载。
- [x] 过滤失败、重复、当前重生成消息和跨知识库助手答案。
- [ ] 区分普通聊天、RAG 和 Agent 三种上下文策略。

### 3.2 Token Budget

- [x] 实现 Token 数量估算。
- [x] 为系统提示词、历史消息和工具结果分配预算。
- [ ] 为检索片段增加独立预算和相关度/成本选择。
- [x] 超出预算时优先保留最近消息。
- [x] 对过长历史消息和工具结果做有界截断。
- [ ] 对引用片段按相关度和 Token 成本选择。
- [x] 记录最终上下文的估算 Token 数。

### 3.3 Summary Memory

- [x] 为会话增加按普通聊天/知识库作用域隔离的摘要存储结构。
- [x] 达到阈值后将较早消息压缩为摘要。
- [x] 摘要失败时回退到最近消息模式并保留旧快照。
- [x] 新消息生成后按最小增量批次更新摘要。
- [ ] 支持清除会话记忆。
- [ ] 支持关闭会话记忆。

### 3.4 前端上下文调试面板

- [x] 在 Agent Trace 展示本次使用的历史消息数量。
- [x] 在 Agent Trace 展示估算 Token 数和预算占用。
- [x] 在 Agent Trace 展示是否使用了历史摘要及覆盖消息数。
- [ ] 展示使用的知识库和引用数量。
- [ ] 提供清除记忆和关闭记忆入口。

### 3.5 阶段验收

- [ ] “它还有哪些优点”等追问能理解上一轮语境。
- [ ] 长会话不会把全部历史无上限发送给模型。
- [ ] 切换知识库后不会错误使用无关引用。
- [ ] 清除记忆后后续回答不再依赖旧上下文。
- [ ] 新增本阶段技术文档并记录 Token Budget 策略。

## 阶段四：可评测的混合检索闭环

优先级：P0  
目标：从“向量检索能返回内容”升级为“查询可改写、召回可融合、结果可过滤、效果可量化、过程可解释”。

这一阶段必须纵向完成，不能只单独实现 Query Rewrite 或只加一个全文检索 SQL。

### 4.1 检索评测基线

- [ ] 建立第一版不少于 20 条问题的 JSON 评测集。
- [ ] 覆盖可回答、不可回答、专有名词、错误码、多文档冲突、口语化追问和模糊指代。
- [ ] 每条样本记录知识库、期望文档、期望关键词和是否应拒答。
- [ ] 固化当前纯向量检索结果，作为改造前 baseline。
- [ ] 实现 Hit@K、MRR、引用文档命中率和无关问题拒答率。
- [ ] 记录 P50/P95 检索耗时和平均召回片段数。
- [ ] 输出可提交到仓库的 Markdown 与 JSON 报告。

### 4.2 文档切片与检索元数据

- [ ] Markdown 优先按照标题层级切片，并保存父级标题路径。
- [ ] 普通文本保留固定长度和 overlap 回退策略。
- [ ] PDF 保存页码或段落位置，保证引用可以定位原文。
- [ ] 避免空白、过短和高度重复 chunk。
- [x] 记录 chunk 字符数、估算 Token、内容 Hash 和文档版本。
- [ ] 在 baseline 中单独记录由切片质量造成的失败样本，不盲目同时调整所有参数。

### 4.3 Query Rewrite

- [x] 对“它还有哪些优点”等依赖历史的问题生成独立检索 query。
- [x] Rewrite 输入使用当前问题、受限最近历史和 Summary Memory，不直接拼接全部对话。
- [x] 保存 `originalQuery`、`rewrittenQuery`、耗时和是否回退。
- [x] Query Rewrite 超时、空结果或异常时使用原始问题回退。
- [x] 校验改写结果保留原问题中的显式错误码、版本号和数字条件。
- [x] 普通完整问题允许跳过 Rewrite，避免无意义的额外模型调用。

### 4.4 PostgreSQL 双路召回

- [x] 保留 pgvector 语义召回，并记录原始向量分数和排名。
- [x] 为 chunk 增加 PostgreSQL `tsvector` 字段和 GIN 索引。
- [x] 增加全文/关键词召回，覆盖专有名词、版本号、错误码和数字单位。
- [x] 使用参数化 SQL，并继续限制到当前用户拥有的知识库。
- [x] 向量和关键词通道分别配置候选数量，不直接把全部结果送入模型。
- [x] 任一路召回失败时允许另一通道独立回退。

### 4.5 融合、阈值与结果多样性

- [x] 使用 RRF 合并向量排名和关键词排名；明确 RRF 是排名融合，不冒充模型 reranker。
- [x] 保留每个候选的 vector rank、keyword rank 和 fused score。
- [ ] 根据评测集校准最低相关阈值，不凭主观设置固定魔法数字。
- [ ] 无候选通过阈值时返回 `NO_RELIABLE_CONTEXT`，由 Agent 明确拒答或追问。
- [x] 对同文档相邻 chunk、文本完全重复 chunk 做去重。
- [x] 限制单篇文档进入最终上下文的片段数量，提升来源多样性。
- [ ] 可选实现 MMR 或等价策略，在相关性和多样性之间取舍。
- [ ] 先完成确定性融合与过滤；只有离线指标证明有收益时，再增加 cross-encoder/LLM reranker。
- [ ] 文档新鲜度默认不参与排序；只有知识库具有明确时效语义时才作为可配置特征。

### 4.6 RAG Context Budget 与引用

- [ ] 将最终检索片段统一交给 Context Builder，而不是由工具结果无限回填。
- [x] 为 RAG 片段分配独立 Token Budget。
- [x] 综合融合排名、来源多样性和 Token 成本选择最终片段。
- [x] 保存最终采用和被过滤的候选及原因。
- [ ] 回答引用与最终送入模型的片段严格一致。
- [ ] 点击引用可以打开对应文档、页码或 chunk 预览。

### 4.7 检索 Trace 与调试面板

- [ ] 扩展检索事件/结果协议，携带 `originalQuery` 和 `rewrittenQuery`。
- [ ] 展示 Query Rewrite 是否执行、耗时及回退原因。
- [ ] 展示向量召回和关键词召回的候选、分数与原始排名。
- [ ] 展示阈值过滤、重复过滤和单文档数量限制的原因。
- [ ] 展示 RRF 融合后的排名及最终采用片段。
- [ ] 展示每个最终片段的 Token 成本和总检索耗时。
- [ ] 普通用户默认看到简洁过程，调试详情保持折叠。
- [ ] 刷新后可从消息历史恢复最终检索元数据。

### 4.8 检索缓存（正确性完成后）

优先级：P2，不阻塞阶段四验收。

- [ ] 缓存 query embedding，key 包含 embedding 模型版本和规范化 query hash。
- [ ] 缓存检索候选，key 至少包含 userId、knowledgeBaseId、知识库版本和 query hash。
- [ ] 文档新增、删除、重建索引后使相关检索缓存失效。
- [ ] 设置短 TTL、容量上限和命中率统计。
- [ ] 不缓存失败结果、权限错误和低可信拒答。
- [ ] 用 P50/P95 延迟与模型调用次数证明缓存收益后再写入简历。

### 4.9 阶段验收

- [ ] 精确错误码和专有名词查询指标优于纯向量 baseline。
- [ ] 口语化追问经 Rewrite 后的期望文档命中率提升。
- [ ] 不可回答问题不会强行引用弱相关片段。
- [ ] 最终引用不存在同文档相邻 chunk 大量重复。
- [ ] 前端可以解释 query 如何改写、候选如何召回、为何过滤及最终为何采用。
- [ ] 输出纯向量、混合检索和完整策略的对比评测报告。
- [ ] 新增本阶段技术文档和面试讲解材料。

## 阶段五：真正的端到端停止生成

优先级：P0  
目标：让“停止生成”从关闭浏览器 SSE 变成服务端模型、工具和检索资源真实取消。

### 5.1 服务端 Generation 生命周期

- [x] 以 `generationId` 保存服务端 AbortController 和 chat/user 归属。
- [x] 新增取消接口，并校验当前用户只能取消自己的 generation。
- [x] 将统一 AbortSignal 继续传给模型调用、Query Rewrite、检索和工具；摘要刷新只在 completed 后触发。
- [x] generation 完成、失败、超时或取消后清理 Controller，避免内存泄漏。
- [x] 重复取消保持幂等。
- [x] 区分 `cancelled`、`failed` 和 `timed_out`，不要全部映射为普通错误。

### 5.2 前端停止与竞态处理

- [x] 停止按钮先调用取消 API，再关闭当前 SSE 连接。
- [x] 将未完成 planning/tool/answer Step 标记为 cancelled/interrupted。
- [x] 处理 complete 与 cancel 同时到达的竞态，以服务端最终状态为准。
- [x] 取消后保留已生成文本，并允许重新生成。
- [x] 切换会话不等于取消原会话生成。

### 5.3 阶段验收

- [ ] 点击停止后，模型请求和正在执行的可取消工具收到 AbortSignal。
- [ ] 取消后不会继续产生 answer_chunk 或写入 completed 消息。
- [ ] SSE 重连不会把已取消 generation 恢复成进行中。
- [ ] 重复取消、完成后取消和越权取消均有确定行为。
- [x] 新增取消协议、状态机和竞态测试技术文档。

## 阶段六：文档异步入库任务

优先级：P1  
目标：展示 Redis 队列、任务状态机、幂等和复杂前端任务交互。

### 6.1 后端任务模型

- [ ] 使用 Redis + BullMQ 或等价方案建立入库队列。
- [ ] 定义状态：`pending | parsing | chunking | embedding | indexing | completed | failed | cancelled`。
- [ ] 上传接口只保存文件并创建任务，不同步等待全部向量化完成。
- [ ] 保存任务当前阶段、处理进度、总 chunk 数、重试次数和失败原因。
- [ ] 支持指数退避重试和人工重试。
- [ ] 支持任务取消，并定义已经写入向量时的补偿清理策略。
- [ ] 同一用户、知识库和文件 Hash 重复提交时保持幂等。
- [ ] Worker 异常退出后任务能够恢复或重新执行。

### 6.2 前端任务体验

- [ ] 上传后立即显示任务卡片。
- [ ] 展示 parsing、chunking、embedding 和 indexing 阶段。
- [ ] 使用 SSE、轮询或 Redis 事件桥接展示进度。
- [ ] 支持失败重试和任务取消。
- [ ] 页面刷新后恢复任务状态。
- [ ] 文档完成后自动刷新知识库文档列表并失效相关检索缓存。

### 6.3 阶段验收

- [ ] 大文档入库不会长时间占用 HTTP 请求。
- [ ] 任务失败后可以看到阶段、原因并安全重试。
- [ ] 重复上传不会创建重复文档或向量数据。
- [ ] Worker 重启后任务状态不会永久卡在 processing。
- [ ] 新增任务状态机、幂等和失败补偿技术文档。

## 阶段七：AI 产品交互增强

优先级：P2  
目标：在核心 Agentic RAG 闭环完成后增强产品交互。

- [ ] 提供会话记忆状态查询、清除当前作用域摘要和关闭记忆入口。
- [ ] 支持同一用户消息的多个回答版本。
- [ ] 支持重新生成并切换回答版本。
- [ ] 支持编辑历史问题，并从该节点创建新对话分支。
- [ ] 支持普通对话、知识库和 Agent 模式切换。
- [ ] 支持会话级 Agent 参数配置。
- [ ] 设计树状消息结构或分支索引，避免复制整段历史。
- [ ] 新增本阶段技术文档和消息分支数据模型说明。

## 工程质量持续任务

这些任务不作为当前功能开发主线，但在涉及相关代码时同步收口。

- [ ] 每次功能修改新增或更新 `docs/technical/` 技术文档。
- [ ] 每次完成任务后更新本 TODO 的勾选状态。
- [ ] 为新核心逻辑补充聚焦单元测试。
- [ ] 为 SSE 事件和 Agent 状态机补充确定性测试。
- [ ] JWT secret 改为环境变量。
- [ ] CORS 改为可配置白名单。
- [ ] 补齐聊天读取、删除、标题修改等接口的用户归属校验。
- [ ] 将 TypeORM `synchronize: true` 替换为 migration。
- [ ] 统一 AI 服务命名，清理 `useGeminiToChat` 等历史名称。
- [ ] 统一助手角色命名，评估 `system` 迁移为 `assistant`。
- [ ] 清理仍描述 MySQL 的过期文档。
- [ ] 依赖环境恢复后执行前后端 build、lint 和聚焦测试。

## 暂缓事项

当前阶段不优先开发：

- [ ] 多 Agent 协作。
- [ ] MCP 工具市场。
- [ ] Neo4j 知识图谱。
- [ ] 模型微调。
- [ ] OCR 和复杂多模态文档识别。
- [ ] 多租户和复杂 RBAC。
- [ ] 完整生产监控和成本核算平台。
- [ ] 大规模 UI 视觉重构。
- [ ] 正式公网部署与高可用基础设施。

这些功能只有在阶段四检索闭环、阶段五真实取消和阶段六异步入库完成或明确取舍后，再根据秋招时间决定是否投入。

## 推荐迭代顺序

```text
迭代 1：Agent 数据协议 + Tool Registry
迭代 2：knowledge_search + calculator + Agent Loop
迭代 3：结构化 SSE 事件 + Agent Trace UI
迭代 4：Context Builder + Token Budget
迭代 5：Summary Memory
迭代 6：RAG 评测 baseline + 检索数据协议
迭代 7：Query Rewrite + pgvector/tsvector 双路召回
迭代 8：RRF + 阈值 + 多样性 + 检索 Trace
迭代 9：真正的端到端停止生成
迭代 10：BullMQ 异步文档入库
迭代 11：检索缓存与可选模型 reranker（由指标决定）
迭代 12：记忆控制、消息分支等产品增强（时间允许时）
```

## 下一步立即执行

从阶段一开始，第一轮开发范围为：

- [x] 新建 Agent 核心类型和运行上下文。
- [x] 实现 Tool Registry。
- [x] 实现安全 calculator 工具。
- [x] 将现有知识库检索封装为 `knowledge_search` 工具。
- [x] 为 Tool Registry、执行器和两个工具补充测试。
- [x] 新增本轮技术文档。

第一轮不修改前端 UI，也不实现完整 Agent Loop。先稳定工具抽象和执行边界，下一轮再接入模型自主调用与 SSE 事件。

第二轮受控 Agent Loop 开发范围：

- [x] 新增 OpenAI-compatible 模型适配层。
- [x] 将 Zod 工具定义转换为原生 Tool Calling 参数。
- [x] 实现工具执行结果回填和多轮调用。
- [x] 实现最大 3 轮工具调用和 45 秒总超时。
- [x] 将纯文本正式聊天切换到 Agent Runner。
- [x] 持久化完整工具结果、知识库引用和失败状态。
- [x] 保留上传文件的现有多模态链路。
- [x] 补充 Agent Loop、模型适配和聊天集成测试。
- [x] 新增本轮技术文档。

第三轮结构化 Agent SSE 与 Trace UI 开发范围：

- [x] 定义完整 Agent SSE 事件联合类型。
- [x] Runner 通过观察回调实时上报规划、工具和回答事件。
- [x] ChatService 统一分配 `seq`、缓存并支持断线重放。
- [x] 新增消息 `agentSteps` JSON 持久化字段。
- [x] StreamChatClient 解析并去重 Agent 事件。
- [x] Zustand 将事件归并到原会话的助手消息。
- [x] 实现可折叠 Agent Trace 时间线和工具详情。
- [x] 区分用户中断和执行错误状态。
- [x] 刷新后从历史消息恢复 Trace。
- [x] 新增本轮技术文档。

第四轮 Context Builder 与 Token Budget 第一阶段开发范围：

- [x] ChatService 加载最近 50 条已完成历史消息。
- [x] Context Builder 统一组合系统提示词、预算内历史和当前问题。
- [x] 过滤失败、重复、当前重生成消息和跨知识库助手答案。
- [x] 配置最近消息数量、输入 Token 和工具结果预算。
- [x] 超出预算时优先保留最近历史，并对临界长消息做截断。
- [x] 大工具结果回填模型前转换为有界结构化 preview。
- [x] `contextUsage` 接入 SSE、消息持久化和 Agent Trace。
- [x] 补充 Context Builder、Runner 和 ChatService 测试。
- [x] 新增本轮技术文档。

第五轮 Summary Memory 开发范围：

- [x] Chat 增加 `memoryEnabled` 和多作用域 `memorySnapshots`。
- [x] 普通聊天和不同知识库使用独立摘要作用域。
- [x] 达到阈值后压缩较早消息，保留最近消息原文。
- [x] 使用 `throughMessageId` 和最小新增消息数增量更新摘要。
- [x] 限制摘要源、摘要结果和正式上下文中的摘要 Token。
- [x] 摘要读取、生成和更新失败时不影响正常回答。
- [x] Context Builder 校验摘要作用域并优先纳入预算。
- [x] Agent Trace 展示摘要使用状态和覆盖消息数量。
- [x] 补充 Summary Memory、Context Builder 和聊天集成测试。
- [x] 新增本轮技术文档。

第六轮 RAG 评测 baseline 与检索协议计划：

- [x] 定义评测样本 JSON Schema 和目录结构。
- [x] 根据独立可复现的 Flow-Chat fixture 文档建立 26 条问题。
- [x] 覆盖普通可回答、不可回答、专有名词、错误码、多文档冲突和依赖历史追问。
- [x] 实现纯向量检索评测 Runner。
- [x] 输出 Hit@K、MRR、引用文档命中率、拒答率和耗时。
- [ ] 固化纯向量 baseline Markdown/JSON 报告。
- [x] 定义后续双路召回需要的候选、排名、分数和过滤原因协议。
- [x] 设计 Agent Trace 检索调试信息的数据结构，不在本轮提前实现完整 UI。
- [x] 新增本轮技术文档。

真实 baseline 报告仍需可运行的 PostgreSQL/pgvector、Embedding API 和已上传 fixture 的专用知识库。本轮保留 `vector-baseline-not-run.md` 说明，未伪造指标。

第七轮 Query Rewrite 与双路召回开发范围：

- [x] 实现按需 Query Rewrite、受限历史输入和原问题回退。
- [x] 保存改写状态、原因、耗时和显式实体保护结果。
- [x] 新增 `tsvector` 字段、已有数据回填和 GIN 索引。
- [x] 实现 pgvector 与关键词通道并行召回。
- [x] 保存两路原始排名、分数、候选数量和通道失败状态。
- [x] 任一路失败时允许另一通道保留调试候选。
- [x] 保持正式聊天继续使用纯向量结果，避免无融合候选进入回答。
- [x] 补充 Query Rewrite 与双路召回单元测试和技术文档。
- [ ] 在可运行环境中输出纯向量与双路召回的真实对比指标。

第八轮 RRF、阈值、结果多样性与 Token Budget 开发范围：

- [x] 实现确定性 RRF，保留原始通道分数和 fused 排名。
- [x] 实现可选的 vector/keyword 分数阈值配置，不预置未校准阈值。
- [x] 实现完全重复内容和相邻 chunk 过滤。
- [x] 实现单文档 chunk 配额和独立 RAG Token Budget。
- [x] 为所有未选中候选记录明确过滤原因。
- [x] 新增 `hybrid_rrf` 调试策略和 Selection Trace。
- [x] 评测 CLI 支持 vector baseline 与 hybrid RRF 对比。
- [x] 补充融合选择测试和本轮技术文档。
- [ ] 根据真实报告校准最低阈值，并决定相邻过滤默认值。
- [ ] 将完整 hybrid 策略切换到正式 `knowledge_search`。

第九轮端到端停止生成开发范围：

- [x] 前端预生成 generationId，并用于发送、SSE 和取消接口。
- [x] 服务端注册 generation 的 chat/user 归属和 AbortController。
- [x] 接通 Agent、模型、工具、Query Rewrite 和检索的 AbortSignal。
- [x] 新增幂等取消 API 和 cancelled SSE 终态。
- [x] 持久化区分 completed、failed、cancelled 和 timed_out。
- [x] 处理 complete/cancel 竞态、事件隔离和五分钟重放缓存清理。
- [x] 补充取消、越权、幂等、完成后取消测试代码和技术文档。
- [ ] 在可运行环境完成真实模型、工具与 SSE 端到端取消验证。

下一步需要在另一台可运行电脑并行完成两类真实验证：一是 baseline/hybrid 对比和阈值校准，二是端到端取消测试。验证通过后将 hybrid 策略接入正式 `knowledge_search`，随后进入 BullMQ 异步文档入库。

## 秋招完成标准

在秋招简历中将项目描述为 Agentic RAG 项目前，至少完成：

- [x] 模型可以自主选择并调用至少两个工具。
- [x] 前端能够实时展示结构化 Agent Trace。
- [x] 工具参数校验、超时和最大调用轮数真实存在。
- [x] 多轮上下文有明确 Token Budget 策略。
- [ ] RAG 有一套可复现的离线评测结果。
- [ ] Query Rewrite、双路召回、融合、阈值和多样性均有对比指标。
- [ ] 前端能够解释检索候选如何被召回、过滤和选入上下文。
- [x] 停止生成已接通服务端模型和工具 AbortSignal（真实环境验证待完成）。
- [ ] 每个核心功能都有对应技术文档和可讲清楚的设计取舍。
