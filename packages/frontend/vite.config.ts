import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],

  server: {
    // 代理上传端点到 Worker（开发环境）
    proxy: {
      '/upload': {
        target: 'https://api.i-tool-chat.store',
        changeOrigin: true,
      }
    }
  }
})
