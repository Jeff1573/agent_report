# MindForge Agent Electron 集成指南

## 📋 概述

本文档介绍如何在 Electron 桌面应用中使用 MindForge Agent。

## 🏗️ 架构设计

```
┌─────────────────────────────────────────┐
│  Renderer Process (React + antd)        │
│  ├─ AgentChat 组件                       │
│  ├─ 消息展示和流式渲染                   │
│  └─ 工具调用可视化                       │
└──────────────┬──────────────────────────┘
               │ IPC (contextBridge)
               ↓
┌──────────────────────────────────────────┐
│  Main Process (Node.js)                  │
│  ├─ agentService.ts                      │
│  ├─ Agent Runtime 管理                   │
│  └─ 流式事件转发                         │
└──────────────┬──────────────────────────┘
               │
               ↓
┌──────────────────────────────────────────┐
│  Agent Runtime (ReAct Agent)             │
│  ├─ LangGraph + LangChain                │
│  ├─ 知识库检索 (Chroma)                  │
│  ├─ 网络搜索 (Tavily)                    │
│  └─ MCP 工具集成                         │
└──────────────────────────────────────────┘
```

## 🚀 快速开始

### 1. 环境准备

确保项目根目录下有正确的 `.env` 配置：

```bash
# LLM 配置
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4
OPENAI_BASE_URL=https://api.openai.com/v1

# 向量数据库
CHROMA_URL=http://localhost:8000
KB_COLLECTION=your_collection_name

# 嵌入模型
KB_EMBED_PROVIDER=openai
KB_EMBED_MODEL=text-embedding-3-small

# 搜索工具（可选）
TAVILY_API_KEY=your_tavily_key
```

### 2. 启动 ChromaDB

```bash
# 使用 Docker 启动 ChromaDB
docker run -p 8000:8000 chromadb/chroma

# 或使用 Python
pip install chromadb
chroma run --path ./chroma_data --port 8000
```

### 3. 运行应用

```bash
# 开发模式
npm run dev

# 构建生产版本
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

## 📦 已完成的集成

### ✅ IPC 通信层

**文件**: `desktop/src/shared/ipc.ts`

- 定义了 Agent 相关的 IPC 通道
- 统一的事件类型定义
- 类型安全的 API 接口

### ✅ 预加载脚本

**文件**: `desktop/src/preload/index.ts`

- 通过 `contextBridge` 安全地暴露 Agent API
- 支持流式和非流式两种调用方式
- 自动管理事件监听器生命周期

### ✅ Main 进程集成

**文件**: `desktop/src/main/services/agentService.ts`

- 懒加载 Agent Runtime（避免启动延迟）
- 流式事件处理和转发
- 支持中止正在进行的对话
- 优雅的资源清理

**文件**: `desktop/src/main/index.ts`

- 注册 IPC 处理器
- 应用退出时清理资源

### ✅ 渲染进程 UI

**文件**: `desktop/src/renderer/src/react/components/AgentChat.tsx`

- 完整的聊天界面
- 实时流式消息展示
- 工具调用过程可视化
- 消息历史管理

## 🎯 核心功能

### 1. 流式聊天

```typescript
await window.api.agent.chatStream(
  '你好，请介绍一下自己',
  (event) => {
    switch (event.type) {
      case 'model-token':
        // 逐字展示
        console.log(event.token)
        break
      case 'tool-call':
        // 显示工具调用
        console.log('调用工具:', event.name)
        break
      case 'assistant-message':
        // 完整消息
        console.log('回答:', event.content)
        break
    }
  },
  { 
    threadId: 'session-123',
    summary: false 
  }
)
```

### 2. 非流式聊天

```typescript
const response = await window.api.agent.chat('你好', {
  threadId: 'session-123'
})
console.log(response)
```

### 3. 中止对话

```typescript
await window.api.agent.stop()
```

## 🔧 配置说明

### Agent 配置

Agent 的配置继承自 `agent/.env`，主要包括：

```bash
# 递归限制（防止无限循环）
RECURSION_LIMIT=300

# 工具调用限制
TOOL_MAX_CALLS=100
TOOL_TIMEOUT_MS=45000
TOOL_RETRY_ATTEMPTS=5

# 持久化模式
CHECKPOINT_MODE=memory  # 或 postgres
THREAD_ID=default-thread
```

### Electron 打包配置

**注意**: 需要确保 agent 模块被正确打包。

在 `desktop/electron.vite.config.ts` 中添加：

```typescript
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [
          // 保持 agent 相关依赖为外部模块
          '@langchain/langgraph',
          '@langchain/core',
          'chromadb',
          // ... 其他大型依赖
        ]
      }
    }
  }
})
```

## ⚠️ 注意事项

### 1. 路径问题

在 `agentService.ts` 中，Agent 模块的导入路径需要根据打包后的实际结构调整：

```typescript
// 开发环境
const agentPath = '../../../../../agent/runtime/index.js'

// 生产环境可能需要调整
const agentPath = app.isPackaged 
  ? path.join(process.resourcesPath, 'agent/runtime/index.js')
  : '../../../../../agent/runtime/index.js'
```

### 2. 依赖打包

Agent 依赖的 LangChain 生态比较大，建议：

- 使用 `electron-builder` 的 `asarUnpack` 选项排除某些模块
- 或将整个 agent 目录作为外部资源打包

### 3. 性能优化

- **懒加载**: Agent Runtime 首次调用时才初始化
- **流式响应**: 避免长时间阻塞 UI
- **资源清理**: 应用退出时正确关闭连接

## 🐛 故障排查

### 问题 1: Agent 初始化失败

**症状**: 点击发送后没有反应或报错

**解决**:
1. 检查 `.env` 配置是否完整
2. 确认 ChromaDB 是否正常运行
3. 查看主进程控制台日志

### 问题 2: 流式消息不显示

**症状**: 长时间加载，最后才一次性显示

**解决**:
- 确认使用了 `chatStream` 而不是 `chat`
- 检查 IPC 回调通道是否正确设置

### 问题 3: 打包后无法运行

**症状**: 开发环境正常，打包后启动报错

**解决**:
1. 检查 agent 模块的路径解析
2. 确认所有依赖都正确打包
3. 使用 `--dir` 模式测试打包结果

## 📚 扩展开发

### 添加自定义工具

1. 在 `agent/tools/` 下创建新工具
2. 在 `agent/tools/registry.ts` 中注册
3. 无需修改 Electron 代码，Agent 会自动加载

### 自定义消息渲染

编辑 `AgentChat.tsx` 中的 `renderMessage` 方法：

```typescript
const renderMessage = (msg: Message) => {
  // 自定义渲染逻辑
  // 例如：Markdown 支持、代码高亮等
}
```

### 添加语音输入

可以集成 Web Speech API：

```typescript
const recognition = new webkitSpeechRecognition()
recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript
  setInput(transcript)
}
```

## 🎉 下一步

现在你可以：

1. ✅ 启动应用并测试基本对话
2. ✅ 尝试知识库检索功能
3. ✅ 测试工具调用和流式响应
4. 🔜 自定义 UI 主题和布局
5. 🔜 添加更多高级功能（历史记录、导出对话等）

## 📖 相关文档

- [Agent 实现文档](../agent/README.md)
- [工具开发指南](../agent/tools/README.md)
- [部署指南](./DEPLOYMENT.md)

---

**提示**: 如果遇到问题，请先查看主进程和渲染进程的控制台日志。
