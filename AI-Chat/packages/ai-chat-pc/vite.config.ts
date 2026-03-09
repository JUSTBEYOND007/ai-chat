import path from 'path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@pc': path.resolve(__dirname, './src')
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')

          if (!normalizedId.includes('/node_modules/')) {
            return
          }

          // Router chunk should be checked first.
          if (
            normalizedId.includes('/react-router-dom/') ||
            normalizedId.includes('/react-router/') ||
            normalizedId.includes('/@remix-run/router/') ||
            normalizedId.includes('/history/')
          ) {
            return 'router'
          }

          if (
            normalizedId.includes('/react/') ||
            normalizedId.includes('/react-dom/') ||
            normalizedId.includes('/scheduler/') ||
            normalizedId.includes('/react-is/') ||
            normalizedId.includes('/loose-envify/') ||
            normalizedId.includes('/object-assign/')
          ) {
            return 'react-vendor'
          }

          if (
            normalizedId.includes('/antd/') ||
            normalizedId.includes('/@ant-design/icons/') ||
            normalizedId.includes('/@ant-design/x/')
          ) {
            return 'antd'
          }

          if (
            normalizedId.includes('/axios/') ||
            normalizedId.includes('/event-source-polyfill/')
          ) {
            return 'http'
          }

          if (normalizedId.includes('/zustand/')) {
            return 'state'
          }

          return 'vendor'
        }
      }
    }
  }
})
