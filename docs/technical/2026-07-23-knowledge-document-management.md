# 知识库文档管理与上传限制

日期：2026-07-23  
范围：`AI-Chat-Be/src/knowledge`、`AI-Chat/packages/ai-chat-pc/src/pages/RagKnowledge`

## 背景

知识库页面已具备上传、解析、向量入库和查询能力，但失败文档无法在页面上重新入库，也不能从知识库中移除。上传入口也缺少统一的服务端文件类型和大小限制。

本次修改补齐基础文档管理能力，并限制知识库可处理的文档范围。

## 功能范围

- 删除知识库中的单份文档及其向量切片。
- 对入库失败的文档重新执行解析和向量化。
- 限制知识库文档为 TXT、Markdown 或 PDF。
- 限制单个文件最大为 20MB。
- 在前端文档列表提供重试和删除操作。

本次不包含异步入库队列、进度百分比、物理文件回收和知识库整体删除。

## API 变更

所有接口都沿用现有 JWT 登录鉴权和知识库归属校验。

### 重试文档入库

```http
POST /knowledge-bases/:knowledgeBaseId/documents/:documentId/retry
```

仅允许 `failed` 状态的文档重试。接口会清空已有失败信息和切片计数，并使用已保存的 `filePath` 重新执行文本解析、切分、embedding 和 pgvector 写入。

成功响应：

```json
{
  "documentId": "uuid",
  "status": "indexed",
  "chunkCount": 12
}
```

当文档不是失败状态时，返回 `400`；文档不存在或不属于当前用户的知识库时，返回 `404`。

### 从知识库移除文档

```http
DELETE /knowledge-bases/:knowledgeBaseId/documents/:documentId
```

接口先删除 `knowledge_chunk` 中的关联切片和向量，再删除 `knowledge_document` 记录。

成功响应：

```json
{
  "documentId": "uuid",
  "deleted": true
}
```

### 文件上传限制

上传接口仍为：

```http
POST /knowledge-bases/:knowledgeBaseId/documents/upload
```

支持扩展名：`.txt`、`.md`、`.markdown`、`.pdf`。

最大文件大小：20MB。Multer 在请求入口限制文件体积；服务层在写盘前再次校验上传 buffer 的大小，并在读取已有文件入库时通过 `stat` 再次校验实际文件大小。

服务端同时校验扩展名与 MIME 类型，避免明显不一致的文件类型进入入库流程。

## 实现说明

### 后端

新增 `knowledge.constants.ts`，集中管理最大文件大小、允许的扩展名和 MIME 类型映射。

`KnowledgeService` 将原有入库主流程提取为 `indexExistingDocument`。新建文档与失败文档重试共用该流程，保证状态流转、失败清理和 embedding 写入逻辑一致。

删除接口只移除知识库侧的数据库记录与向量切片，不删除 `uploads/` 的物理文件。原因是文件可能由聊天上传模块或其他知识库记录引用；在没有引用计数和统一文件所有权前，删除物理文件可能造成误删。

### 前端

`knowledgeApi` 新增 `retryDocument` 与 `deleteDocument`。

知识库文档列表中：

- `failed` 文档展示 Retry 按钮；
- 每个文档展示带确认提示的 Remove 按钮；
- 上传或操作失败后重新加载文档列表，使后端保留的失败状态可见；
- 删除后清空当前查询结果，避免页面展示已移除文档的引用。

## 数据影响

不新增数据表或字段。

删除文档会删除该 `documentId` 对应的 `knowledge_chunk` 行，包括 pgvector embedding；`knowledge_document` 行随后删除。`uploads/` 文件保持不变。

## 验证

已执行：

```bash
git diff --check
```

结果：通过。

已补充知识库服务聚焦测试，覆盖：

- 不支持扩展名的拒绝；
- 超过 20MB 的上传在写盘前被拒绝；
- 失败文档的重试状态重置；
- 删除文档时同时删除关联切片。

以下命令尚未能执行：

```bash
pnpm test -- knowledge.service.spec.ts --runInBand
pnpm run build
```

原因是当前环境的 pnpm 默认全局缓存目录不可写，且依赖下载授权仍受平台限制，Jest 与构建流程尚未实际启动。

## 后续建议

1. 将同步入库改为异步任务，提供解析/embedding 进度与状态轮询。
2. 增加文档重命名、同名文件策略和删除后的物理文件回收策略。
3. 在 RAG 聊天消息持久化后，将文档删除与历史引用的展示策略明确化。
