import path from 'path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 这是一个配置示例文件，展示如何配置代理
// 如果需要使用代理，可以将此配置复制到 vite.config.ts

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@pc': path.resolve(__dirname, './src')
    }
  },
  server: {
    // 代理配置：解决跨域问题
    proxy: {
      '/api': {
        target: 'http://localhost:8080', // 后端服务地址
        changeOrigin: true, // 改变请求头中的 origin
        rewrite: (path) => path.replace(/^\/api/, '') // 重写路径，去掉 /api 前缀
        // 例如：前端请求 /api/users/login -> 实际请求 http://localhost:8080/users/login
      }
    }
  }
})
