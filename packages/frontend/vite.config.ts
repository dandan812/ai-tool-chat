import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],

  build: {
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('vue') || id.includes('pinia') || id.includes('vue-router')) {
              return 'framework'
            }

            if (id.includes('markdown-it')) {
              return 'markdown'
            }
          }

          if (id.includes('/src/components/') || id.includes('\\src\\components\\')) {
            return 'ui'
          }

          if (id.includes('/src/api/') || id.includes('\\src\\api\\')) {
            return 'network'
          }
        },
      },
    },
  },

  server: {
    // 代理上传端点到 Worker（开发环境）
    proxy: {
      '/upload': {
        target: 'https://api.i-tool-chat.store',
        changeOrigin: true,
      }
    }
  },

  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
