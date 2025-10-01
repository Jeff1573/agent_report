# 🚀 MindForge Agent 快速入门指南

## 📝 前提条件

- ✅ Node.js 22.x
- ✅ npm 或 pnpm
- ✅ Git

## 🎯 5分钟快速启动

### 步骤 1: 克隆并安装依赖

```bash
# 已克隆项目，跳过此步
# git clone <your-repo-url>
# cd mindForge_re

# 安装所有 workspace 的依赖
npm install
```

### 步骤 2: 配置模型

MindForge 支持两种配置方式，**推荐使用界面配置**：

#### 方式 1：界面配置（推荐）⭐
1. 先跳过此步骤，直接启动应用
2. 在应用中进入"设置"页面
3. 添加模型配置并填写 API Key
4. 保存后即可使用

#### 方式 2：环境变量配置（可选）
在项目**根目录**创建 `.env` 文件：

```bash
# 必需（如果不使用界面配置）
OPENAI_API_KEY=sk-xxxxx
OPENAI_MODEL=gpt-4
OPENAI_BASE_URL=https://api.openai.com/v1

# 可选：启用内部检索（RAG）需全部就绪
CHROMA_URL=http://localhost:8000
KB_COLLECTION=mindforge_kb
KB_EMBED_PROVIDER=openai
KB_EMBED_MODEL=text-embedding-3-small   # openai 模式需要
# 或者使用 Gemini 嵌入：
# KB_EMBED_PROVIDER=gemini
# GOOGLE_API_KEY=xxxx                   # gemini 模式需要

# 可选：外部搜索工具
TAVILY_API_KEY=tvly-xxxxx
```

**配置优先级：** 界面配置 > 环境变量。两者可以混用，界面配置会覆盖环境变量。

### 步骤 3: （可选）启动 ChromaDB（启用 RAG 时）

选择以下任一方式：

**方式 A: Docker (推荐)**
```bash
docker run -p 8000:8000 chromadb/chroma
```

**方式 B: Python**
```bash
pip install chromadb
chroma run --path ./chroma_data --port 8000
```

### 步骤 4: (可选) 入库代码知识

如果要使用知识库检索功能：

```bash
# 切换到 agent workspace
cd agent

# 入库当前项目代码
npm run ingest:code -- --dir ../
```

### 步骤 5: 运行环境检查

```bash
cd desktop
npm run precheck
```

如果所有检查通过，你会看到：
```
✓ 所有必需项检查通过！
可以运行: npm run dev
```
未配置 RAG 时会看到提示：“禁用内部检索（kb_search）”，不影响启动与聊天功能。

### 步骤 6: 启动应用

```bash
# 在 desktop 目录下
npm run dev

# 或在项目根目录
npm run dev
```

## 🎨 界面预览

启动后你会看到：

```
┌─────────────────────────────────────┐
│ 🤖 MindForge Agent 聊天              │
├─────────────────────────────────────┤
│                                     │
│  开始与 MindForge Agent 对话         │
│  Agent 具备知识库检索、网络搜索、    │
│  MCP工具调用等能力                   │
│                                     │
├─────────────────────────────────────┤
│ [输入消息...]            [发送]      │
└─────────────────────────────────────┘
```

## 💬 试试这些问题

### 测试基本对话
```
你好，请介绍一下自己
```

### 测试知识库检索
```
这个项目的主要功能是什么？
```

### 测试网络搜索
```
2024年最新的 AI 技术趋势是什么？
```

### 测试多步推理
```
帮我分析一下这个项目的架构，并给出优化建议
```

## 🔧 常见问题

### Q1: Agent 初始化失败

**错误**: `Agent 初始化失败: 无法找到 Agent 模块`

**解决**:
1. 确认在项目根目录运行了 `npm install`
2. 检查 `agent/` 目录是否存在
3. 尝试重新构建: `cd agent && npm run typecheck`

### Q2: ChromaDB 连接失败

**错误**: `✗ ChromaDB 无法连接`

**解决**:
1. 确认 ChromaDB 正在运行: `curl http://localhost:8000/api/v1/heartbeat`
2. 检查端口是否被占用
3. 检查 `.env` 中的 `CHROMA_URL` 配置

### Q3: 知识库检索返回空结果

**原因**: 还没有入库数据

**解决**:
```bash
cd agent
npm run ingest:code -- --dir ../
```

### Q4: 流式响应不显示

**检查**:
1. 打开开发者工具 (F12)
2. 查看 Console 中的错误信息
3. 确认 Main 进程日志

### Q5: API Key 配置错误

**错误**: `401 Unauthorized`

**解决**:
1. 检查 `.env` 文件位置（应在项目根目录）
2. 确认 `OPENAI_API_KEY` 格式正确
3. 重启应用以重新加载环境变量

## 📊 开发模式 vs 生产模式

### 开发模式
```bash
npm run dev
# 特点：
# - 热重载
# - 可以打开 DevTools
# - 详细的日志输出
```

### 跳过环境检查
```bash
npm run dev:skip-check
# 跳过启动前的环境检查，直接启动
```

### 生产构建
```bash
# Windows
npm run build:win

# 输出位置: desktop/dist
```

## 🎓 下一步

1. ✅ 测试基本对话功能
2. ✅ 查看工具调用过程
3. ✅ 尝试复杂的多步推理任务
4. 📖 阅读完整文档: [ELECTRON_INTEGRATION.md](./ELECTRON_INTEGRATION.md)
5. 🛠️ 自定义 UI 样式
6. 🔧 开发自定义工具

## 📚 相关文档

- [完整集成指南](./ELECTRON_INTEGRATION.md)
- [Agent 实现分析](./AGENT_ANALYSIS.md)
- [工具开发指南](../agent/tools/README.md)
- [RAG 优化方案](./RAG优化方案.md)

## 🆘 获取帮助

如果遇到问题：

1. 查看控制台日志 (Main 进程和 Renderer 进程)
2. 检查 `.env` 配置
3. 运行环境检查: `npm run precheck`
4. 查看完整文档

---

**提示**: 首次启动可能需要几秒钟初始化 Agent Runtime，请耐心等待。
