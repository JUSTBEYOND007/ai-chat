# 本地启动指南

这份文档只记录当前项目在本地电脑上的启动方式。

## 1. 项目结构

```text
ai-Chat-all/
  AI-Chat/       # 前端项目
  AI-Chat-Be/    # 后端项目
```

常用端口：

| 服务 | 默认地址 |
| --- | --- |
| 后端 API | http://localhost:3000 |
| 前端 PC 端 | http://localhost:5173 |
| MySQL | localhost:3307 |
| Redis | localhost:6379 |

## 2. 首次准备

本地需要提前安装：

- Node.js 18 或更高版本
- pnpm
- Docker / Docker Desktop

安装 pnpm：

```bash
npm install -g pnpm
```

## 3. 启动后端

进入后端目录：

```bash
cd AI-Chat-Be
```

启动 MySQL 和 Redis：

```bash
docker compose up mysql redis -d
```

后端配置文件位置是：

```text
AI-Chat-Be/src/.env
```

如果还没有这个文件，创建 `src/.env`，内容参考：

```env
DB_HOST=localhost
DB_PORT=3307
DB_USERNAME=root
DB_PASSWORD=630wujiayuwy
DB_DATABASE=aiChat

redis_server_host=localhost
redis_server_port=6379
redis_server_db=0

nodemailer_host=smtp.qq.com
nodemailer_port=587
nodemailer_auth_user=你的邮箱@qq.com
nodemailer_auth_pass=你的邮箱授权码

DASHSCOPE_API_KEY=你的阿里云百炼API Key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_TEXT_MODEL=qwen-long
DASHSCOPE_VISION_MODEL=qwen-vl-plus
DASHSCOPE_AGENT_MODEL=qwen-long
DASHSCOPE_MBTI_MODEL=qwen-plus
DASHSCOPE_RAG_MODEL=qwen-long
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v1

PORT=3000
NODE_ENV=development
```

安装依赖并启动后端：

```bash
pnpm install
pnpm run start:dev
```

后端启动后访问：

```text
http://localhost:3000
```

## 4. 启动前端

另开一个终端，进入前端目录：

```bash
cd AI-Chat
```

安装依赖并启动 PC 端：

```bash
pnpm install
pnpm run dev:pc
```

前端启动后访问：

```text
http://localhost:5173
```

当前前端后端地址配置在：

```text
AI-Chat/packages/ai-chat-pc/src/constant/index.ts
```

默认应为：

```ts
export const BASE_URL = 'http://localhost:3000'
```

如果后端端口改了，这里也要同步修改。

## 5. 日常启动顺序

以后已经安装过依赖后，日常启动通常只需要：

```bash
# 终端 1：启动数据库和 Redis
cd AI-Chat-Be
docker compose up mysql redis -d

# 终端 2：启动后端
cd AI-Chat-Be
pnpm run start:dev

# 终端 3：启动前端
cd AI-Chat
pnpm run dev:pc
```

然后打开：

```text
http://localhost:5173
```

## 6. 停止服务

停止前端和后端：

```text
在对应终端按 Ctrl + C
```

停止 MySQL 和 Redis：

```bash
cd AI-Chat-Be
docker compose down
```
