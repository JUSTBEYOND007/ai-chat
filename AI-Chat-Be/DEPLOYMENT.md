# 部署指南

## 📦 项目确认

**是的，这就是您需要的 AI 项目后端！**

这个项目是一个完整的 AI 聊天后端系统，包含：
- ✅ AI 对话功能（支持文本、文件、图片）
- ✅ 用户认证系统
- ✅ Agent 助手（古诗词、小红书文案、MBTI 咨询）
- ✅ 文件管理
- ✅ 聊天历史管理

## 🚀 快速部署步骤

### 前置要求

- ✅ Node.js 18+ 
- ✅ pnpm（推荐）或 npm
- ✅ Docker 和 Docker Compose
- ✅ 阿里云百炼 API Key（或 OpenAI API Key）

### 第一步：启动基础服务

```bash
# 1. 进入项目目录
cd AI-Chat-Be

# 2. 启动 MySQL 和 Redis（使用 Docker）
docker-compose up mysql redis -d

# 3. 验证服务是否启动
docker-compose ps
```

应该看到 `aichat-mysql` 和 `aichat-redis` 两个容器在运行。

### 第二步：配置环境变量

在 `src/` 目录下创建 `.env` 文件：

```bash
# Windows PowerShell
New-Item -Path "src\.env" -ItemType File

# Linux/Mac
touch src/.env
```

然后编辑 `src/.env` 文件，添加以下配置：

```env
# 数据库配置（与 docker-compose.yml 保持一致）
DB_HOST=localhost
DB_PORT=3307
DB_USERNAME=root
DB_PASSWORD=630wujiayuwy
DB_DATABASE=aiChat

# Redis配置
redis_server_host=localhost
redis_server_port=6379
redis_server_db=0

# 邮件服务配置（注册验证码功能）
nodemailer_host=smtp.qq.com
nodemailer_port=587
nodemailer_auth_user=your-email@qq.com
nodemailer_auth_pass=your-email-auth-code

# 应用配置
PORT=3000
NODE_ENV=development
```

**重要提示：**
- 数据库密码需要与 `docker-compose.yml` 中的 `MYSQL_ROOT_PASSWORD` 一致
- 邮件服务用于发送注册验证码，如果不需要可以暂时不配置

### 第三步：安装依赖

```bash
# 如果没有安装 pnpm，先安装
npm install -g pnpm

# 安装项目依赖
pnpm install
```

### 第四步：配置 AI API（可选）

如果需要修改 AI API 配置，编辑以下文件：

- `src/ai/ai.service.ts` - 主要 AI 服务
- `src/agent/agent.service.ts` - Agent 服务

当前使用的是阿里云百炼 API，如需更换为其他服务，修改对应的 API Key 和 Base URL。

### 第五步：启动应用

```bash
# 开发模式（推荐，支持热重载）
pnpm run start:dev

# 或生产模式
pnpm run build
pnpm run start:prod
```

### 第六步：验证部署

1. 检查应用是否启动：
   - 访问 `http://localhost:3000`
   - 应该能看到应用响应

2. 检查数据库连接：
   - 查看控制台日志，确认没有数据库连接错误

3. 测试 API：
   - 可以使用 Postman 或 curl 测试接口
   - 例如：`GET http://localhost:3000`

## 🐳 Docker 完整部署（可选）

如果需要完全容器化部署：

### 1. 修改 docker-compose.yml

在现有文件末尾添加应用服务：

```yaml
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

### 2. 修改 Dockerfile

将最后一行改为生产模式：

```dockerfile
CMD ["pnpm", "run", "start:prod"]
```

### 3. 启动所有服务

```bash
docker-compose up -d
```

## 📋 部署检查清单

- [ ] Docker 和 Docker Compose 已安装
- [ ] MySQL 和 Redis 容器正常运行
- [ ] `src/.env` 文件已创建并配置
- [ ] 数据库密码与 docker-compose.yml 一致
- [ ] 项目依赖已安装（pnpm install）
- [ ] 应用成功启动（无错误日志）
- [ ] 可以访问 `http://localhost:3000`
- [ ] AI API Key 已配置（如果需要）

## 🔍 故障排查

### 问题 1: 数据库连接失败

**解决方案：**
```bash
# 检查 MySQL 容器状态
docker-compose ps

# 查看 MySQL 日志
docker-compose logs mysql

# 重启 MySQL
docker-compose restart mysql
```

### 问题 2: Redis 连接失败

**解决方案：**
```bash
# 检查 Redis 容器状态
docker-compose ps

# 测试 Redis 连接
docker exec -it aichat-redis redis-cli ping
# 应该返回 PONG
```

### 问题 3: 端口被占用

**解决方案：**
- 修改 `docker-compose.yml` 中的端口映射
- 或修改 `.env` 中的 `PORT` 配置

### 问题 4: 依赖安装失败

**解决方案：**
```bash
# 清除缓存重新安装
pnpm store prune
pnpm install

# 或使用 npm
npm install
```

## 📞 获取帮助

如果遇到问题：
1. 查看应用日志：`docker-compose logs app`
2. 查看数据库日志：`docker-compose logs mysql`
3. 检查环境变量配置是否正确
4. 确认所有服务容器都在运行

## 🎉 部署成功

部署成功后，您可以：
- 通过 API 接口与前端应用集成
- 使用 Postman 测试各个接口
- 查看 `src/` 目录下的各个模块了解功能详情

祝部署顺利！🚀






