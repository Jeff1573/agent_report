# MindForge - AI Agent 桌面应用

> **MindForge** 是一个基于 ReAct Agent 的智能桌面助手，集成了知识库检索、网络搜索、MCP 工具调用等能力。

[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## ✨ 特性

- 🤖 **完整的 ReAct Agent**: 基于 LangGraph 的多步推理和工具调用
- 🔍 **知识库检索**: ChromaDB 向量数据库 + 智能 RAG
- 🌐 **网络搜索**: 集成 Tavily API 获取实时信息
- 🔧 **MCP 工具生态**: 支持 Model Context Protocol 工具
- 💬 **流式对话**: 实时展示思考过程和工具调用
- 🎨 **现代 UI**: Electron + React + Ant Design

## 🚀 快速开始

本仓库由根 `package.json` 统一转发常用命令；`desktop` 通过 `"agent": "file:../agent"` 依赖本地 `agent` 包。`agent` 会先编译到 `dist/`，再通过 package exports 被 Electron 主进程动态导入，保证开发与打包路径一致。

### 1. 安装依赖

```bash
# 在仓库根目录安装依赖；根脚本会继续安装 agent 与 desktop
npm install
```

### 2. 配置环境

在项目根目录创建 `.env` 文件（参考 `desktop/ENV_CONFIG.md`）：

```bash
OPENAI_API_KEY=sk-xxxxx
OPENAI_MODEL=gpt-4
CHROMA_URL=http://localhost:8000
KB_COLLECTION=mindforge_kb
```

也可跳过此步，等应用启动后在“设置”页面进行界面配置（推荐）。

### 3. （可选）启动 ChromaDB

```bash
docker run -p 8000:8000 chromadb/chroma
```

### 4. 运行桌面应用

```bash
# 在仓库根目录执行；会先构建 agent/dist，再启动 desktop
npm run dev
```

📖 **详细教程**: 查看 [快速入门指南](docs/QUICK_START.md)

## 📦 项目结构

```
<repo-root>/
├── desktop/          # Electron 桌面应用
│   ├── src/
│   │   ├── main/     # 主进程 (Agent Runtime)
│   │   ├── renderer/ # 渲染进程 (React UI)
│   │   ├── preload/  # 预加载脚本 (IPC 桥接)
│   │   └── shared/   # 共享类型定义
│   └── scripts/      # 工具脚本
├── agent/            # ReAct Agent 核心，本地 npm 包
│   ├── runtime/      # Agent 运行时
│   ├── tools/        # 工具集 (kb/search/mcp)
│   ├── services/     # 服务层 (RAG/embeddings)
│   ├── config/       # 配置和提示词
│   └── dist/         # TypeScript 编译产物，供 desktop 运行时消费
├── AST_Fast/         # 代码分析服务
└── docs/             # 文档
```

## 安装
- 一次性安装根目录、`agent` 与 `desktop` 依赖（在仓库根目录）：
  ```sh
  npm install
  ```
  根脚本会依次进入 `agent/` 与 `desktop/` 执行安装，`desktop/node_modules/agent` 来自 `file:../agent` 本地依赖。

## 常用命令（根目录执行）
- 桌面应用开发与构建：
  ```sh
  npm run dev          # 先构建 agent，再启动 desktop
  npm run build        # 先构建 agent，再构建 desktop
  npm run typecheck    # 先构建 agent，再检查 desktop 类型
  npm run lint
  ```
- 单独处理 `agent`：
  ```sh
  npm run build:agent
  npm run dev:agent    # tsc --watch
  ```

## Agent 工作区（Chroma 检索快速验证）

前提：
- 已有可访问的 Chroma HTTP 服务（`CHROMA_URL`）。
- 入库与检索使用相同的嵌入供应商与模型（`KB_EMBED_PROVIDER` / `KB_EMBED_MODEL`）。
- 建议在 `agent/.env` 设置 `KB_COLLECTION` 为既有集合名；未设置时会生成随机名，若该名在库中不存在将报错提示你补齐配置。

运行：

```bash
cd agent
npm run demo:kb:chroma -- --q "什么是 RAG？" --collection your_collection --k 4 --type similarity
```

说明：
- `--type` 支持 `similarity` 或 `mmr`；`mmr` 时可追加 `--lambda 0.5`。
- 输出将附带“参考来源”（去重后的 source 列表）。

## 依赖管理
- 向指定包添加依赖：
  ```sh
  cd desktop && npm install <pkg>
  cd agent && npm install <pkg>
  ```
- 重新安装桌面端依赖：
  ```sh
  cd desktop && npm install
  ```

## 常见问题
- Agent 模块找不到：先执行 `npm run build:agent`，确认 `agent/dist/runtime/index.js` 存在。
- desktop 导入 Agent：通过 `"agent": "file:../agent"` 和 `agent/package.json` 的 `exports`，不是源码别名。
- Node 版本不一致警告：若与 `engines` 不匹配，npm 仅警告（除非启用 engine-strict）。建议团队统一 Node 版本以减少锁文件漂移。

## 📚 文档

- [快速入门指南](docs/QUICK_START.md) - 5分钟快速上手
- [Electron 集成文档](docs/ELECTRON_INTEGRATION.md) - 完整架构说明
- [流式验证说明](docs/STREAMING_VALIDATION.md) - LLM 流式能力验证
- [RAG 优化方案](docs/RAG优化方案.md) - 知识库检索优化
- [项目描述-多工具智能代理](docs/项目描述-多工具智能代理.md) - 项目背景与能力描述

## 🛠️ 开发指南

### 运行 Agent 单独测试

```bash
# 在 agent/ 目录执行；start 脚本通过 tsx 在 Node 22 下执行 index.ts
cd agent
npm start -- --input "你的问题"
```

### 代码入库

```bash
# 在 agent/ 目录执行
cd agent
npm run ingest:code -- --dir ../
```

### 构建桌面应用

```bash
# 在仓库根目录执行；会先构建 agent/dist，再执行 Electron 构建/打包
npm run build:win                # Windows
cd desktop && npm run build:mac  # macOS
cd desktop && npm run build:linux # Linux
```

## 🔧 配置说明

### 必需配置

- `OPENAI_API_KEY`: LLM API 密钥
- `OPENAI_MODEL`: 使用的模型 (如 gpt-4)
- `CHROMA_URL`: ChromaDB 服务地址
- `KB_COLLECTION`: 知识库集合名
- `KB_EMBED_MODEL`: 嵌入模型

### 可选配置

- `TAVILY_API_KEY`: Tavily 搜索 API
- `RECURSION_LIMIT`: Agent 递归深度限制
- `TOOL_MAX_CALLS`: 工具调用次数限制

详见 [ENV_CONFIG.md](desktop/ENV_CONFIG.md)

## 🏗️ 架构

```
┌────────────────────────────────┐
│  React UI (Renderer Process)   │
│  - 聊天界面                     │
│  - 流式消息展示                 │
└──────────────┬─────────────────┘
               │ IPC (contextBridge)
┌──────────────┴─────────────────┐
│  Main Process (Electron)       │
│  - Agent Runtime 管理           │
│  - 事件转发                     │
└──────────────┬─────────────────┘
               │
┌──────────────┴─────────────────┐
│  ReAct Agent (LangGraph)       │
│  ├─ 推理循环                    │
│  ├─ 工具调用                    │
│  └─ 结果观察                    │
└────────────────────────────────┘
```

## 🧪 运行测试

```bash
# 类型检查
npm run typecheck
```

## 📝 依赖管理

```bash
cd desktop && npm install <package>
cd agent && npm install <package>
```

## ❓ 常见问题

查看 [快速入门指南 - 常见问题](docs/QUICK_START.md#常见问题)

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

基于以下优秀项目构建：
- [LangChain](https://github.com/langchain-ai/langchainjs)
- [LangGraph](https://github.com/langchain-ai/langgraphjs)
- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Ant Design](https://ant.design/)
