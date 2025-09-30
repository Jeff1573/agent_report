import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, bytecodePlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin()],
    resolve: {
      alias: {
        // 配置 agent 模块的别名，指向 workspace
        'agent': resolve('../agent')
      },
      // 添加 .ts 扩展名支持
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
    },
    build: {
      rollupOptions: {
        // 将 LangChain 相关的大型依赖标记为外部依赖
        // 这样它们会从 node_modules 中加载，而不是被打包
        external: [
          '@langchain/langgraph',
          '@langchain/langgraph-checkpoint-postgres',
          '@langchain/core',
          '@langchain/community',
          '@langchain/openai',
          '@langchain/google-genai',
          '@langchain/tavily',
          '@langchain/mcp-adapters',
          'langchain',
          'chromadb',
          'zod',
          'pg',
          'pg-native',
          'pg-pool'
        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
