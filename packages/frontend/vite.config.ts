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
          const moduleId = id.replaceAll('\\', '/')
          if (moduleId.includes('/node_modules/')) {
            if (moduleId.includes('/node_modules/element-plus/')) {
              return 'element'
            }
            if (
              ['@vue/', 'vue/', 'pinia/', 'vue-router/'].some((name) =>
                moduleId.includes('/node_modules/' + name)
              )
            ) {
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
        }
      }
    }
  },

  server: {
    // Keep account cookies and API requests on the frontend origin.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3201',
        changeOrigin: true
      },
      '/upload': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },

  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true
  }
})
