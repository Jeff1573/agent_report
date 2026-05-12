import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// 从 agent/package.json 动态读取依赖列表，作为 external 的唯一来源
const agentPkg = JSON.parse(
  readFileSync(resolve('../agent/package.json'), 'utf-8')
)
const agentDeps = Object.keys(agentPkg.dependencies || {})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        'agent': resolve('../agent')
      },
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
    },
    build: {
      rollupOptions: {
        external: (id: string) => {
          // agent 的 dependencies 自动被 externalize
          if (agentDeps.some((pkg) => id === pkg || id.startsWith(pkg + '/'))) {
            return true
          }
          // agent 依赖的传递依赖（如 chromadb → @chroma-core/default-embed）
          const transitiveExternals = ['@chroma-core/', 'pg', 'pg-native', 'pg-pool']
          return transitiveExternals.some(
            (pkg) => id === pkg || id.startsWith(pkg + '/')
          )
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    server: {
      host: '0.0.0.0',  // 明确指定监听 IPv4 地址
    }
  }
})
