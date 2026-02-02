# 项目启动指南

## 前置要求

- **Node.js**: 建议使用 Node.js 18+ 版本
- **pnpm**: 包管理器（如果未安装，运行 `npm install -g pnpm`）

## 启动步骤

### 1. 安装依赖

在项目根目录执行：

```bash
pnpm install
```

### 2. 配置后端 API 地址

项目当前配置的后端地址在 `packages/ai-chat-pc/src/constant/index.ts`：

```typescript
export const BASE_URL = 'http://aichat-2.natapp1.cc'
```

#### 情况一：使用现有的后端服务（natapp 内网穿透）

如果后端服务已经通过 natapp 等工具暴露在公网，直接使用即可：
- 当前配置的地址：`http://aichat-2.natapp1.cc`
- 如果地址变化，直接修改 `BASE_URL` 即可

#### 情况二：本地启动后端服务（推荐用于开发）

如果你有后端源码，需要在本地启动后端：

**步骤：**

1. **获取后端代码**
   - 从 Git 仓库克隆后端项目
   - 或者从团队获取后端源码

2. **在 IDEA 中启动后端**
   - 打开后端项目（通常是 Spring Boot、Node.js、Python 等）
   - 配置运行环境（JDK、Node.js 等）
   - 启动后端服务（通常在 `localhost:8080` 或 `localhost:3000`）

3. **修改前端配置**
   
   编辑 `packages/ai-chat-pc/src/constant/index.ts`：
   ```typescript
   // 如果后端运行在本地 8080 端口
   export const BASE_URL = 'http://localhost:8080'
   
   // 或者如果后端运行在其他端口
   export const BASE_URL = 'http://localhost:3000'
   ```

4. **处理跨域问题**
   
   如果后端没有配置 CORS，需要在后端添加跨域支持，或者在 Vite 配置代理：
   
   编辑 `packages/ai-chat-pc/vite.config.ts`，添加代理配置：
   ```typescript
   export default defineConfig({
     plugins: [react(), tailwindcss()],
     resolve: {
       alias: {
         '@pc': path.resolve(__dirname, './src')
       }
     },
     server: {
       proxy: {
         '/api': {
           target: 'http://localhost:8080', // 后端地址
           changeOrigin: true,
           rewrite: (path) => path.replace(/^\/api/, '')
         }
       }
     }
   })
   ```
   
   然后修改 `BASE_URL` 为：
   ```typescript
   export const BASE_URL = '/api' // 使用代理
   ```

#### 情况三：没有后端服务（使用 Mock 数据）

如果暂时没有后端服务，可以：
- 使用 Mock 服务（如 Mock.js、MSW）
- 或者修改 API 调用返回模拟数据（部分功能已有模拟数据，如分享功能）

**注意**：当前项目中的 `shareChat` 和 `getSharedChat` 已经使用了模拟数据，可以参考其实现方式。

### 3. 启动开发服务器

#### 启动 PC 端（主应用）

```bash
pnpm run dev:pc
```

或者直接进入 PC 端目录：

```bash
cd packages/ai-chat-pc
pnpm dev
```

#### 启动插件端

```bash
pnpm run dev:pg
```

### 4. 访问应用

启动成功后，通常会在以下地址访问：
- PC 端：`http://localhost:5173`（Vite 默认端口）
- 插件端：`http://localhost:5174`（如果配置了不同端口）

## 快速参考

### 后端配置快速切换

**本地开发（后端在 localhost:8080）：**
```typescript
// packages/ai-chat-pc/src/constant/index.ts
export const BASE_URL = 'http://localhost:8080'
```

**使用内网穿透（natapp）：**
```typescript
export const BASE_URL = 'http://aichat-2.natapp1.cc'
```

**使用代理（推荐，避免跨域问题）：**
```typescript
// 1. 修改 constant/index.ts
export const BASE_URL = '/api'

// 2. 修改 vite.config.ts 添加代理配置（见上方情况二）
```

## 常见问题

### 1. 后端服务不可用

如果后端服务未启动或地址不正确，前端可能无法正常使用。可以：
- 检查后端服务是否运行
- 修改 `BASE_URL` 配置为正确的后端地址
- 或者使用 Mock 数据（需要自行实现）

### 2. 端口被占用

如果默认端口被占用，Vite 会自动尝试下一个可用端口，控制台会显示实际使用的端口。

### 3. 依赖安装失败

如果 `pnpm install` 失败，可以尝试：
```bash
# 清除缓存
pnpm store prune

# 重新安装
rm -rf node_modules
pnpm install
```

## 项目结构说明

```
AI-Chat/
├── packages/
│   ├── ai-chat-pc/      # PC 端主应用
│   └── ai-chat-plug/    # 插件端（待完善）
├── package.json         # 根 package.json
└── pnpm-workspace.yaml  # pnpm workspace 配置
```

## 其他命令

- **代码检查**：`pnpm lint`
- **代码格式化**：`pnpm format`
- **构建生产版本**：`pnpm build`

