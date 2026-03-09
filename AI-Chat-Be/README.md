# AI Chat Backend

一个基于 NestJS 的 AI 聊天后端系统，支持多种 AI 功能，包括智能对话、文件处理、Agent 助手等。

## 📋 项目介绍

这是一个完整的 AI 聊天应用后端项目，主要功能包括：

### 核心功能模块

1. **用户系统** (`users/`)
   - 用户注册、登录
   - JWT 身份认证
   - 邮箱验证码注册

2. **AI 聊天** (`chat/`)
   - 支持流式对话（SSE）
   - 多轮对话历史管理
   - 支持文件上传和图片识别
   - 使用阿里云百炼 API（兼容 OpenAI）

3. **AI 服务** (`ai/`)
   - 文本对话
   - 文件内容提取和分析
   - 图片识别（使用 qwen-vl-plus 模型）
   - 长文本处理（使用 qwen-long 模型）

4. **Agent 助手** (`agent/`)
   - 古诗词生成助手
   - 小红书爆款文案生成助手
   - MBTI 咨询师助手
   - 基于 LangChain 构建

5. **文件管理** (`file/`)
   - 文件上传（支持分片上传）
   - 文件存储和管理
   - PDF 解析

6. **其他服务**
   - Redis 缓存
   - 邮件服务（注册验证码）
   - 全局异常处理
   - 响应拦截器

### 技术栈

- **框架**: NestJS 11.x
- **数据库**: MySQL 8.0 + TypeORM
- **缓存**: Redis 7
- **AI 服务**: 
  - 阿里云百炼 API（兼容 OpenAI）
  - LangChain
- **认证**: JWT
- **其他**: 
  - pnpm 包管理
  - Docker & Docker Compose
  - TypeScript

## 🚀 快速部署

### 方式一：使用 Docker Compose（推荐）

#### 1. 环境准备

确保已安装：
- Docker
- Docker Compose
- Node.js 18+ 和 pnpm（如果本地运行应用）

#### 2. 配置环境变量

在 `src/` 目录下创建 `.env` 文件：

```bash
# 数据库配置
DB_HOST=localhost
DB_PORT=3307
DB_USERNAME=root
DB_PASSWORD=630wujiayuwy  # 与 docker-compose.yml 中的密码保持一致
DB_DATABASE=aiChat

# Redis配置
redis_server_host=localhost
redis_server_port=6379
redis_server_db=0

# 邮件服务配置（用于注册验证码）
nodemailer_host=smtp.qq.com
nodemailer_port=587
nodemailer_auth_user=your-email@qq.com
nodemailer_auth_pass=your-email-auth-code

# 应用配置
PORT=3000
NODE_ENV=development
```

#### 3. 启动基础服务（MySQL + Redis）

```bash
# 启动 MySQL 和 Redis 容器
docker-compose up mysql redis -d

# 查看服务状态
docker-compose ps
```

#### 4. 安装依赖并启动应用

```bash
# 安装依赖
pnpm install

# 开发模式运行
pnpm run start:dev

# 或生产模式构建并运行
pnpm run build
pnpm run start:prod
```

应用将在 `http://localhost:3000` 启动。

### 方式二：完全 Docker 化部署

#### 1. 修改 Dockerfile（当前为开发模式）

如果需要生产环境部署，可以修改 `Dockerfile` 的启动命令：

```dockerfile
# 将最后一行改为
CMD ["pnpm", "run", "start:prod"]
```

#### 2. 构建并运行

```bash
# 构建镜像
docker build -t ai-chat-backend .

# 运行容器（需要先启动 MySQL 和 Redis）
docker run -d \
  --name ai-chat-app \
  --network aichat-network \
  -p 3000:3000 \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/src/.env:/app/src/.env \
  ai-chat-backend
```

#### 3. 使用 Docker Compose 完整部署

可以在 `docker-compose.yml` 中添加应用服务：

```yaml
services:
  # ... 现有的 mysql 和 redis 服务 ...
  
  app:
    build: .
    container_name: aichat-app
    restart: always
    ports:
      - '3000:3000'
    volumes:
      - ./uploads:/app/uploads
      - ./src/.env:/app/src/.env
    depends_on:
      - mysql
      - redis
    networks:
      - aichat-network
    environment:
      - NODE_ENV=production
```

然后运行：
```bash
docker-compose up -d
```

## 📝 开发说明

### 项目结构

```
src/
├── agent/          # Agent 助手模块
├── ai/             # AI 服务核心模块
├── chat/           # 聊天功能模块
├── file/           # 文件管理模块
├── users/          # 用户管理模块
├── email/          # 邮件服务模块
├── redis/          # Redis 缓存模块
├── filters/        # 异常过滤器
├── interceptors/   # 响应拦截器
└── main.ts         # 应用入口
```

### 常用命令

```bash
# 开发模式（热重载）
pnpm run start:dev

# 生产构建
pnpm run build

# 生产运行
pnpm run start:prod

# 代码格式化
pnpm run format

# 代码检查
pnpm run lint

# 运行测试
pnpm run test
```

### API 文档

启动应用后，可以通过以下方式访问 API：

- 基础 URL: `http://localhost:3000`
- 主要端点：
  - `/users` - 用户相关接口
  - `/chat` - 聊天相关接口
  - `/ai` - AI 服务接口
  - `/agent` - Agent 助手接口
  - `/file` - 文件管理接口

## ⚙️ 配置说明

### 数据库配置

- 默认使用 MySQL 8.0
- 数据库名：`aiChat`
- TypeORM 会自动同步实体（`synchronize: true`）

### Redis 配置

- 用于缓存和会话管理
- 默认端口：6379

### AI 服务配置

当前使用阿里云百炼 API，配置在 `src/ai/ai.service.ts` 中：
- API Key: 需要在代码中配置
- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 支持的模型：
  - `qwen-long`: 长文本处理
  - `qwen-vl-plus`: 视觉模型（图片识别）

### 邮件服务

用于发送注册验证码，需要配置 QQ 邮箱的 SMTP 服务：
1. 登录 QQ 邮箱
2. 开启 SMTP 服务
3. 获取授权码
4. 配置到 `.env` 文件中

## 🔧 常见问题

### 1. 数据库连接失败

- 检查 MySQL 容器是否正常运行：`docker-compose ps`
- 确认 `.env` 中的数据库配置与 `docker-compose.yml` 一致
- 检查端口 3307 是否被占用

### 2. Redis 连接失败

- 检查 Redis 容器是否正常运行
- 确认 Redis 配置正确

### 3. 文件上传失败

- 确保 `uploads/` 目录存在且有写权限
- 检查文件大小限制配置

### 4. AI API 调用失败

- 检查 API Key 是否有效
- 确认网络可以访问阿里云百炼 API
- 查看错误日志获取详细错误信息

## 📄 许可证

UNLICENSED
