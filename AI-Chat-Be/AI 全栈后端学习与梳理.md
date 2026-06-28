# AI 全栈后端学习与梳理 TODO

## 目标定位

我们的求职目标可以定位为：**AI 全栈方向，主投前端，同时兼投全栈岗位**。

这个项目的后端不需要包装成“后端专家级项目”，更适合作为前端候选人的加分项：能独立理解并打通 AI 对话、用户鉴权、数据库持久化、Redis、文件上传、SSE 流式通信等完整业务链路。

面试表达建议：

> 我的主方向还是前端，但我希望自己具备 AI 全栈能力。这个项目里我不只负责页面，也梳理和参与了 NestJS 后端，包括登录鉴权、会话消息持久化、文件分片上传、SSE 流式推送、AI 服务调用和 RAG/Agent 模块。这样我在做前端复杂交互时，能更清楚地理解接口设计、数据流和性能瓶颈。

## 投递策略

- [ ] 主投前端：重点讲 React、状态管理、流式渲染、虚拟列表、大文件上传体验、工程化。
- [ ] 辅投 AI 前端：重点讲 AI 对话链路、SSE/流式响应、Markdown 渲染、Agent/RAG 业务理解。
- [ ] 选择性投全栈：重点讲 NestJS、MySQL、Redis、TypeORM、JWT、文件上传、AI 服务编排。
- [ ] 避免把自己说成纯后端专家，表达成“前端主导 + 有完整后端闭环能力”。

## 第一阶段：读懂 NestJS 项目结构

目标：能解释 NestJS 和 Spring Boot 的相似点，并能顺着代码讲清请求如何进入系统。

- [ ] 阅读 `src/main.ts`，梳理全局配置：CORS、静态资源、ValidationPipe、Interceptor、Filter。
- [ ] 阅读 `src/app.module.ts`，梳理项目模块组成：users、chat、file、ai、agent、email、redis。
- [ ] 理解 NestJS 三件套：`Module`、`Controller`、`Service`。
- [ ] 对比 Spring Boot：
  - `@Controller` 类似 `@RestController`
  - `@Injectable` 类似 `@Service`
  - `Module` 类似模块化配置和 Bean 管理
  - `Guard` 类似拦截鉴权
  - `Interceptor` 类似响应包装/切面处理
- [ ] 产出一段面试话术：为什么前端同学学 NestJS 成本更低。

验收标准：

- [ ] 能画出一个请求从 `Controller -> Service -> Repository -> DB` 的流程。
- [ ] 能说清 NestJS 和 Spring Boot 的 3 个相同点、3 个不同点。

## 第二阶段：用户系统与鉴权

目标：能讲清注册、登录、JWT 鉴权、验证码和 Redis 的关系。

- [ ] 阅读 `src/users/users.controller.ts`。
- [ ] 阅读 `src/users/users.service.ts`。
- [ ] 阅读 `src/login.guard.ts` 和 `src/custom.decorator.ts`。
- [ ] 阅读 `src/email/email.service.ts`，理解邮箱验证码发送逻辑。
- [ ] 阅读 `src/redis/redis.service.ts`，理解 Redis 在验证码/缓存中的作用。
- [ ] 梳理登录流程：用户提交账号密码 -> 后端校验 -> 生成 token -> 前端请求携带 token -> Guard 校验。
- [ ] 梳理注册验证码流程：请求验证码 -> Redis 存储验证码 -> 注册时校验。

面试重点：

- [ ] JWT 由哪几部分组成。
- [ ] 为什么 token 放请求头。
- [ ] Redis 为什么适合存验证码：过期时间、读写快、临时状态。
- [ ] Guard 和前端路由守卫有什么相似点。

建议补强：

- [ ] 确认密码是否只是 MD5，面试中可以主动说“真实生产更建议 bcrypt/argon2 + salt”。
- [ ] 梳理 token 过期、刷新、退出登录的完整策略。

## 第三阶段：MySQL 与 TypeORM 数据建模

目标：能讲清后端有哪些表、表之间是什么关系。

- [ ] 阅读 `src/users/entities/user.entity.ts`。
- [ ] 阅读 `src/chat/entities/chat.entity.ts`。
- [ ] 阅读 `src/chat/entities/message.entity.ts`。
- [ ] 阅读 `src/file/entities/file.entity.ts`。
- [ ] 阅读 `src/agent/entities/agent.entity.ts`。
- [ ] 画出核心 ER 关系：User -> Chat -> Message，Chat -> File。
- [ ] 梳理 TypeORM 常见用法：`Repository.findOne`、`create`、`save`、`find`。
- [ ] 梳理会话列表、消息列表、文件记录分别如何落库。

面试重点：

- [ ] 为什么消息需要按 `createdAt` 正序返回。
- [ ] 为什么会话删除更适合软删除 `isActive=false`。
- [ ] 文件上传为什么需要单独的 file 表记录上传状态。
- [ ] MySQL 索引可以加在哪里：`userId`、`chatId`、`fileId`、`createdAt`。

建议补强：

- [ ] 为高频查询字段设计索引，并整理理由。
- [ ] 复习事务：文件合并和数据库状态更新理论上应该如何保证一致性。

## 第四阶段：AI 对话与 SSE 流式链路

目标：能完整讲清“用户发送消息后，AI 如何一段段返回到前端”。

- [ ] 阅读 `src/chat/chat.controller.ts` 的 `@Sse('getChat/:id')`。
- [ ] 阅读 `src/chat/chat.service.ts` 的 `chatSubjects`、`getStreamEvents`、`sendMessageToChat`。
- [ ] 阅读 `src/chat/chat.service.ts` 的 `useGeminiToChat`。
- [ ] 阅读 `src/ai/ai.service.ts`，理解 AI SDK 调用和 `stream: true`。
- [ ] 梳理链路：前端建立 SSE -> 前端 POST 发送消息 -> 后端调用 AI -> 后端边接收 chunk 边推送 -> 完整消息入库。
- [ ] 梳理 SSE 消息类型：`chunk`、`complete`、`error`。

面试重点：

- [ ] 为什么用 SSE：服务端单向持续推送，适合 AI 回复。
- [ ] SSE 和 WebSocket 区别：SSE 简单、单向、基于 HTTP；WebSocket 双向、适合实时协作/游戏。
- [ ] 为什么先建立 SSE 再发送消息。
- [ ] 为什么最终还要保存完整 AI 回复到数据库。

建议补强：

- [ ] 增加 SSE 心跳，避免长连接被代理断开。
- [ ] 增加断线重连和消息恢复策略。
- [ ] 思考是否支持 `Fetch + ReadableStream` 作为大上下文 POST 流式返回方案。

## 第五阶段：大文件分片上传

目标：能把分片上传讲成项目核心亮点，而不是只说“上传文件”。

- [ ] 阅读 `src/file/file.controller.ts`。
- [ ] 阅读 `src/file/file.service.ts` 的 `checkFile`、`uploadFile`、`mergeFile`、`cancelFile`。
- [ ] 阅读 `src/file/dto/*`，理解上传接口参数。
- [ ] 梳理前后端接口：
  - `GET /file/check`：检查秒传/断点续传状态
  - `POST /file/upload`：上传单个分片
  - `POST /file/merge`：合并分片
  - `POST /file/cancel`：取消上传
- [ ] 梳理文件状态：未上传、上传中、已完成、已取消。
- [ ] 梳理 hash 的作用：文件指纹、分片完整性校验、秒传判断。

面试重点：

- [ ] 为什么大文件要分片上传：失败成本低、可并发、可续传。
- [ ] 为什么要做分片 hash：防止传输损坏。
- [ ] 为什么要做文件级 hash：识别重复文件，实现秒传。
- [ ] 为什么服务端要记录已上传分片：断点续传需要状态。

建议补强：

- [ ] 让分片上传幂等：重复上传同一分片不应重复增加 `uploadedChunks`。
- [ ] 合并前校验真实分片数量，而不只依赖数据库计数。
- [ ] 上传完成后校验整体文件 hash。
- [ ] 引入对象存储或云存储作为生产级文件存储方案。
- [ ] 前端 hash 可放到 Web Worker，避免大文件阻塞主线程。

## 第六阶段：Agent 与 RAG 模块

目标：能把项目和“AI 全栈”关联起来，而不是只停留在聊天 UI。

- [ ] 阅读 `src/agent/agent.controller.ts`。
- [ ] 阅读 `src/agent/agent.service.ts`。
- [ ] 阅读 `src/agent/services/rag.service.ts`。
- [ ] 阅读 `src/agent/services/mbti.service.ts`。
- [ ] 梳理 Agent 类型：古诗词、小红书文案、MBTI、RAG。
- [ ] 梳理 RAG 基础流程：文档解析 -> 文本切块 -> 向量化 -> 检索 -> 拼接上下文 -> 调用模型。
- [ ] 理解 LangChain 在项目中的作用。

面试重点：

- [ ] RAG 解决什么问题：让模型基于私有知识库回答。
- [ ] 为什么要文本切块：控制上下文长度，提高检索精度。
- [ ] 向量检索和关键词搜索有什么区别。
- [ ] Agent 和普通 Chat 的区别：Agent 有角色/工具/任务编排。

建议补强：

- [ ] 梳理一份“上传 PDF 后如何进入 RAG 检索”的流程图。
- [ ] 给 Agent 增加更清晰的 prompt 模板管理。
- [ ] 给 RAG 增加检索命中结果的可解释展示。

## 第七阶段：工程化与部署

目标：能证明这个项目不是只能本地跑，而是具备基础工程化意识。

- [ ] 阅读 `package.json` scripts：`start:dev`、`build`、`test`、`lint`。
- [ ] 阅读 `Dockerfile`。
- [ ] 阅读 `docker-compose.yml`。
- [ ] 阅读 `DEPLOYMENT.md`。
- [ ] 梳理本地启动依赖：Node、pnpm、MySQL、Redis、环境变量。
- [ ] 梳理生产部署流程：构建镜像、配置环境变量、启动服务。

面试重点：

- [ ] Docker Compose 为什么适合本地一键启动依赖服务。
- [ ] 环境变量为什么不能写死在代码里。
- [ ] 后端日志、错误处理、接口响应统一为什么重要。

建议补强：

- [ ] 增加 `.env.example`，明确必填环境变量。
- [ ] 增加健康检查接口，例如 `/health`。
- [ ] 增加接口文档，推荐 Swagger。
- [ ] 增加关键链路的 e2e 测试。

## 第八阶段：面试输出材料

目标：把“我看过代码”升级成“我能讲清楚设计”。

- [ ] 画 1 张整体架构图：前端、NestJS、MySQL、Redis、AI 服务、文件存储。
- [ ] 画 1 张 AI 流式对话时序图。
- [ ] 画 1 张文件分片上传时序图。
- [ ] 整理 5 个 STAR 亮点：
  - AI 流式交互
  - 大文件分片上传
  - 长会话消息渲染
  - Zustand 状态管理
  - NestJS 后端闭环
- [ ] 准备 10 个高频问答：
  - 为什么选择 SSE？
  - SSE 和 WebSocket 怎么选？
  - 分片上传怎么实现断点续传？
  - 秒传怎么判断？
  - Redis 在项目中做什么？
  - JWT 怎么鉴权？
  - MySQL 表怎么设计？
  - NestJS 和 Spring Boot 有什么区别？
  - RAG 是什么？
  - 作为前端为什么要做后端？

## 2 周学习节奏建议

第 1-2 天：

- [ ] 跑通后端项目，读 `main.ts`、`app.module.ts`、模块目录。
- [ ] 输出 NestJS vs Spring Boot 对比笔记。

第 3-4 天：

- [ ] 梳理用户、JWT、Redis、邮箱验证码。
- [ ] 输出登录鉴权流程图。

第 5-6 天：

- [ ] 梳理 MySQL 表结构和 TypeORM。
- [ ] 输出核心 ER 图。

第 7-8 天：

- [ ] 梳理 SSE 流式对话链路。
- [ ] 输出 AI 对话时序图和面试话术。

第 9-10 天：

- [ ] 梳理文件分片上传链路。
- [ ] 输出分片上传时序图和优化点。

第 11-12 天：

- [ ] 梳理 Agent/RAG 模块。
- [ ] 输出 AI 全栈项目亮点。

第 13-14 天：

- [ ] 整理简历描述。
- [ ] 准备高频问答。
- [ ] 模拟 2 次项目面试讲解。

## 最终简历定位

推荐写法：

> AI 全栈聊天应用：基于 React + NestJS 构建，前端负责流式对话渲染、长会话性能优化、文件上传交互与状态管理；后端基于 NestJS + MySQL + Redis 实现用户鉴权、会话消息持久化、SSE 流式推送、文件分片上传和 Agent/RAG 能力，形成完整 AI 应用闭环。

更偏前端岗位时：

> 前端主导 AI 聊天应用核心体验建设，同时参与 NestJS 后端接口设计与联调，打通登录鉴权、消息持久化、SSE 流式回复、大文件分片上传等完整链路，具备 AI 全栈协作能力。

更偏全栈岗位时：

> 基于 React + NestJS + MySQL + Redis 搭建 AI 全栈聊天系统，负责前端交互与后端核心模块设计，实现用户鉴权、会话管理、AI 流式响应、文件分片上传、Agent/RAG 等业务能力。

