import './assets/main.css'
import { createRoot } from 'react-dom/client'
import { App } from './react/App'

// 渲染入口：React 18 使用 createRoot 挂载到 #root
const container = document.getElementById('root')
if (!container) {
  throw new Error('未找到根节点 #root')
}
const root = createRoot(container)
root.render(<App />)
