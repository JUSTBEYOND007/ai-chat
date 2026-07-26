# AI Chat

AI Chat 是一个前后端一体的 AI 对话平台，包含 PC 端聊天界面、NestJS 后端服务、大文件分片上传、SSE 流式输出，以及正在升级中的 PostgreSQL + pgvector + RAG / Agent 能力。

项目目标不是只做一个普通聊天页面，而是把「AI 对话、文件上传、知识库问答、Agent 工具调用」串成一个可以持续扩展的 AI 应用工程。

## 项目结构

```text
ai-Chat-all/
  AI-Chat/       # 前端项目，包含 ai-chat-pc
  AI-Chat-Be/    # 后端项目，NestJS + TypeORM + AI 服务
```

## 核心功能

### AI 流式对话

- 支持多会话聊天
- 支持用户消息和 AI 消息持久化
- 后端通过 SSE 向前端推送模型输出
- 前端实现打字机式流式渲染
- 支持按 generationId 真正取消服务端模型、Agent 工具和检索链路
- 支持 Markdown 渲染和代码高亮
- 对弱网、刷新、消息状态做了可靠性优化

### 大文件上传

项目实现了前端到后端之间的大文件上传链路：

- 前端对文件进行分片
- 使用 MD5 生成文件指纹
- 支持上传前检查文件状态
- 支持断点续传和秒传判断
- 后端校验分片 hash
- 后端合并分片并存储到本地 `uploads/`
- 文件记录会和会话关联，方便后续 AI 对话引用

这部分重点解决的是：浏览器不能一次性稳定上传大文件时，如何把文件拆成多个小块，逐块上传，再由后端合并。

### 后端 AI 服务

后端使用 NestJS 组织模块，主要能力包括：

- 用户注册、登录、JWT 鉴权
- 会话和消息管理
- 大文件上传与静态文件访问
- 对接 DashScope / OpenAI 兼容模型 API
- 支持文本模型和视觉模型调用
- 已有 RAG / Agent 原型模块
- 使用 LangChain.js 做文档切分、embedding 和检索实验

## 技术栈

### 前端

- React
- TypeScript
- Vite
- Ant Design / Ant Design X
- Zustand
- Axios
- EventSource / SSE
- SparkMD5
- Markdown-it
- highlight.js

### 后端

- NestJS
- TypeScript
- TypeORM
- PostgreSQL
- pgvector
- Redis
- JWT
- LangChain.js
- OpenAI-compatible SDK
- pdf-parse

### 工程环境

- pnpm
- Docker / Docker Compose
- WSL Linux 开发环境
- PostgreSQL 16 + pgvector
- Redis 7

## 当前架构

```text
用户浏览器
  ↓
React 前端
  ↓ HTTP / SSE
NestJS 后端
  ↓
PostgreSQL / Redis / 本地 uploads
  ↓
DashScope / 大模型 API
```

普通 AI 对话流程：

```text
用户发送消息
-> 后端保存用户消息
-> 后端调用大模型 API
-> 大模型返回流式内容
-> 后端通过 SSE 推送给前端
-> 前端逐字渲染
-> 后端保存最终 AI 回复
```

大文件上传流程：

```text
选择文件
-> 前端计算文件指纹
-> 前端切分 chunk
-> 后端检查已上传分片
-> 前端并发上传缺失分片
-> 后端校验并保存分片
-> 后端合并为完整文件
-> 数据库记录文件信息
```

## PostgreSQL 与 pgvector 改造

项目后端已经从 MySQL 迁移到 PostgreSQL，并使用支持 pgvector 的 PostgreSQL 镜像，为后续 RAG 能力做准备。

迁移后的价值：

- 更适合复杂查询和结构化数据管理
- 可以通过 pgvector 存储 embedding 向量
- 可以在数据库层进行相似度检索
- 适合扩展知识库、文档问答和 Agent 记忆检索

后续 RAG 的目标流程：

```text
文档上传
-> 文本解析
-> 文档切片
-> 生成 embedding
-> 存入 PostgreSQL pgvector
-> 用户提问
-> 问题生成 embedding
-> 检索相关 chunks
-> 拼接上下文
-> 大模型生成回答
-> 返回答案和引用来源
```

## RAG / Agent 规划

项目接下来会从「普通 AI 聊天」升级为「智能文档问答助手」。

计划中的核心能力：

- 创建知识库
- 上传 PDF / TXT / MD 文档
- 文档解析入库
- chunk 切分和 embedding 生成
- pgvector 相似度检索
- RAG 问答返回引用来源
- Agent 调用知识库检索工具
- Agent 调用计算器等简单工具
- 多轮对话记忆
- 前端展示引用来源和工具调用过程

目标技术路线：

```text
React + TypeScript + 流式对话 UI + 文档上传
NestJS + PostgreSQL + pgvector + LangChain.js
RAG 检索增强生成 + Agent 工具调用 + 引用溯源
```

## 项目亮点

- 前后端完整闭环，不只是单页面 Demo
- 支持 SSE 流式输出，接近真实 AI 产品体验
- 大文件上传采用分片、校验、续传、合并方案
- 后端模块化设计，便于继续扩展 RAG 和 Agent
- PostgreSQL + pgvector 为知识库问答打下基础
- 既能展示前端交互能力，也能体现后端 AI 工程能力

## 后续方向

短期目标：

- 完成知识库表结构设计
- 完成文档解析、切片和向量入库
- 完成基于 pgvector 的 RAG 查询接口
- 前端增加知识库管理页面

中期目标：

- RAG 回答支持流式输出
- 回答中展示引用来源
- Agent 支持工具调用 trace
- 普通聊天、RAG 问答、Agent 问答统一到会话体系

长期目标：

- 支持更多文档类型
- 支持更稳定的上传任务状态管理
- 支持异步文档入库任务
- 支持多 Agent 协作和长期记忆

## 说明

本项目目前处于持续开发阶段，重点是围绕 AI 对话平台逐步补齐工程化能力。当前已经具备聊天、流式输出、大文件上传和 PostgreSQL / pgvector 基础设施，后续会继续完善 RAG 与 Agent 相关能力。
