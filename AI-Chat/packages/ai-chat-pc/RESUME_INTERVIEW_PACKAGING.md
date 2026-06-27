# AI-Chat 简历与面试包装文档

## 项目定位

AI-Chat 是一个面向智能对话与知识增强问答场景的 AI 对话平台。项目重点不是单纯完成一个聊天页面，而是围绕真实 AI 对话产品中的流式生成、长文本渲染、知识库检索、引用来源展示和前端性能优化做工程化实践。

推荐简历定位：

> 基于 React、TypeScript、Ant Design X 与 NestJS 构建 AI 智能对话平台，支持 SSE 流式生成、多会话管理、Markdown 富文本渲染、文件上传、RAG 知识库检索与引用来源展示。

## 亮点一：SSE 流式事件解析与渲染缓冲优化

简历写法：

> 基于 SSE 实现 AI 回复流式输出，封装 `StreamChatClient` 统一处理 `chunk / complete / error` 事件，并设计渲染缓冲区按固定时间片 flush 到 Zustand，降低高频 token 更新导致的 React render 压力，支持生成中断、异常状态与长文本平滑输出。

代码锚点：

- `src/utils/streamChatClient.ts`
- `src/components/AIRichInput/index.tsx`
- `src/apis/chat.ts`
- `src/store/useChatStore.ts`

实现思路：

- SSE 事件解析：基于 `EventSource` 的 `onmessage` 接收完整 SSE message，解析 `chunk / complete / error` 等业务事件。
- `renderBuffer`：缓存待渲染文本，按固定节奏 flush 到消息状态。
- `flushInterval`：控制 UI 更新频率，避免每个 token 都触发状态更新。
- `StreamStatus`：维护 `idle / connecting / streaming / completed / aborted / error` 等状态。
- `abort()`：支持中断生成，关闭当前 SSE 连接，并同步更新 UI 状态。

面试讲法：

> 最初版本里，SSE 每收到一个 chunk 就直接写入 Zustand，这种方式实现简单，但在逐 token 输出场景下会造成高频状态更新和组件重渲染。后来我抽象了 `StreamChatClient`，让它统一处理 `chunk / complete / error` 事件，并把有效文本先放入 `renderBuffer`，再按固定节奏 flush 到 UI。这样既保留了流式打字效果，又减少了 React render 压力。

### 追问：为什么不每个 chunk 都 setState？

因为大模型输出频率很高，如果每个 token 都触发 Zustand 更新和 Markdown 渲染，长文本场景下会造成明显渲染压力。通过节流 flush，可以在体验和性能之间取得平衡。

### 追问：既然 SSE 已经按 message 切好了，为什么还需要封装？

因为当前项目使用的是标准 SSE，`EventSource` 通常已经按 message 维度触发回调，所以不需要自己处理半包拼接。封装的核心价值不在网络层拼接，而在两个方面：

- 统一解析 `chunk / complete / error` 事件，收敛流式状态管理。
- 通过 `renderBuffer` 控制 UI 更新节奏，减少高频 Zustand 更新。

这样可以让“事件解析”和“UI 渲染节奏”解耦，避免每个 token 都直接触发 React render。

### 追问：如何支持中断生成？

`StreamChatClient` 暴露 `abort()` 方法。用户点击停止生成后，会先 flush 当前剩余内容，再把状态更新为 `aborted`，最后关闭 EventSource 连接，并让输入框退出 loading 状态。

## 亮点二：RAG 知识库检索与引用来源展示

简历写法：

> 接入向量检索驱动的 RAG 机制，基于 LangChain 实现文档分块、Embedding 建索引与 TopK 相似度召回，并在前端展示引用来源、召回片段与回答结果，提升复杂问答场景下的准确性与可解释性。

代码锚点：

- 后端：`AI-Chat-Be/src/agent/services/rag.service.ts`
- 后端：`AI-Chat-Be/src/agent/agent.controller.ts`
- 前端：`src/apis/agent.ts`
- 前端：`src/types/rag.ts`
- 前端：`src/pages/RagKnowledge/index.tsx`
- 前端：`src/pages/Agents/index.tsx`
- 前端：`src/router/index.tsx`

实现思路：

- 使用 `RecursiveCharacterTextSplitter` 对知识文档进行分块。
- 使用 `OpenAIEmbeddings` 将文本块转成向量。
- 使用 `MemoryVectorStore` 构建向量索引。
- 查询时通过相似度检索召回 TopK 相关文本块。
- 将召回内容作为上下文注入 Prompt，由 LLM 生成回答。
- 后端返回 `answer` 和 `sources`。
- 前端展示回答内容、来源标题、分类、召回片段和 TopK 排名。

面试讲法：

> RAG 链路主要分成四步：文档分块、Embedding 向量化、相似度召回、上下文增强生成。后端负责把知识文档切成 chunk 并建立向量索引，用户提问后先召回相关文本片段，再把这些片段作为上下文交给模型生成答案。前端不仅展示答案，还展示引用来源，包括文档标题、分类、召回片段和排名，让用户能看到答案依据，提升可解释性。

### 追问：为什么需要文档分块？

大文档不能直接整体放进模型上下文，也不适合整体向量化。分块可以控制检索粒度，让召回结果更精确。适当的 chunk overlap 可以减少上下文在边界处被截断的问题。

### 追问：为什么要展示引用来源？

RAG 不只是为了让答案更准，也要让答案更可解释。展示引用来源后，用户可以知道模型依据哪些知识片段回答，降低黑盒感，也方便判断回答是否可信。

### 追问：`MemoryVectorStore` 有什么局限？

`MemoryVectorStore` 适合 Demo 和开发验证，接入简单、调试方便。但它不持久化，也不适合大规模数据。生产环境可以替换成 Milvus、pgvector、Elasticsearch Vector Search 或云厂商向量数据库。

## 最终简历版本

项目描述：

> 面向智能对话与知识增强问答场景，构建基于大语言模型的 AI 对话平台，支持多会话管理、SSE 流式生成、Markdown 富文本渲染、文件上传、RAG 知识库检索与引用来源展示，探索 AI 对话系统在前后端分离架构下的工程化落地。

技术栈：

> React 18、Vite、TypeScript、Zustand、Ant Design X、Tailwind CSS、NestJS、TypeORM、MySQL、Redis、JWT、LangChain、SSE

项目工作：

- 基于 React 18 + Vite + TypeScript 搭建前端工程，结合 Zustand 管理用户、会话、消息、主题与国际化状态，提升复杂对话场景下的状态可维护性。
- 基于 SSE 实现 AI 回复流式输出，封装 `StreamChatClient` 统一处理 `chunk / complete / error` 事件，并通过渲染缓冲区节流 flush 降低高频 token 更新导致的 React render 压力，支持生成中断、错误状态与长文本平滑输出。
- 封装 Markdown 渲染能力，基于单例解析器、渲染结果缓存、`React.memo` 与 `useMemo` 减少长对话场景下的重复解析和重复渲染。
- 实现长对话虚拟列表，结合动态高度测量与高度缓存，降低大量消息场景下的 DOM 渲染压力。
- 接入 RAG 知识库问答能力，基于 LangChain 实现文档分块、Embedding 建索引、TopK 相似度召回与上下文增强生成。
- 在前端实现知识库问答页面，展示模型回答、引用来源、召回片段、文档分类与排名信息，提升复杂问答场景下的准确性与可解释性。
- 实现文件分片上传能力，基于文件 Hash、分片校验、并发上传、已上传分片检查与后端合并流程，提高大文件上传稳定性。

## 诚实边界

如果面试官追问生产化，可以这样回答：

- 当前 RAG 使用 `MemoryVectorStore`，适合 Demo 和功能验证；生产环境会替换为持久化向量数据库。
- 当前流式通信使用 SSE，适合服务端单向推送；如果需要双向低延迟交互，可以考虑 WebSocket。
- 当前版本重点放在流式对话和 RAG 可解释性，Function Calling / MCP 工具调用链路可以作为后续扩展方向。
