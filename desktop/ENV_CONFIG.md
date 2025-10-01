# 环境配置说明

## 🎯 配置优先级系统

MindForge 支持两种配置方式，按以下优先级合并：

1. **界面配置（最高优先级）** - 在应用设置页面配置模型
2. **环境变量配置** - 通过 `.env` 文件配置

**建议使用方式：**
- ✅ **推荐**：仅使用界面配置（无需创建 `.env` 文件）
- ✅ **兼容**：使用环境变量作为默认配置，界面配置作为覆盖
- ✅ **开发**：使用 `.env` 文件配置全局默认值

## 📝 配置文件位置

**方式 1：界面配置（推荐）**
- 启动应用 → 点击设置 → 配置模型
- 配置存储在：`{userData}/settings.json`

**方式 2：环境变量配置**
- 在**项目根目录** (`mindForge_re/.env`) 创建 `.env` 文件

## ⚙️ 必需配置

### 界面配置
1. 启动应用
2. 进入设置页面
3. 添加模型配置：
   - 模型名称：`gpt-4` 或其他模型
   - API Key：`sk-your-api-key-here`
   - Base URL：`https://api.openai.com/v1`（可选）

### 环境变量配置（可选）

```bash
# LLM 配置（如果不使用界面配置，则必需）
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4
OPENAI_BASE_URL=https://api.openai.com/v1
```

## 🔧 可选配置

```bash
# 向量数据库（RAG，可选；启用内部检索需全部就绪）
CHROMA_URL=http://localhost:8000
KB_COLLECTION=mindforge_kb
KB_EMBED_PROVIDER=openai
KB_EMBED_MODEL=text-embedding-3-small   # openai 模式需要
# 或者使用 Gemini 嵌入：
# KB_EMBED_PROVIDER=gemini
# GOOGLE_API_KEY=your-google-api-key     # gemini 模式需要

# 外部搜索（可选）
TAVILY_API_KEY=tvly-your-key-here

# Agent 行为（可选）
RECURSION_LIMIT=300
TOOL_MAX_CALLS=100
TOOL_TIMEOUT_MS=45000
TOOL_RETRY_ATTEMPTS=5

# 持久化（可选）
CHECKPOINT_MODE=memory   # 或 postgres（需 CHECKPOINT_POSTGRES_URL）
THREAD_ID=default-thread
```

## ✅ 验证配置

运行检查脚本：
```bash
npm run precheck
```
提示：未配置 CHROMA_URL/KB_COLLECTION/嵌入时，检查脚本会提示"禁用内部检索（kb_search）"，但不阻止启动。

## 🔍 配置优先级测试

### 测试场景 1：仅界面配置
1. 不创建 `.env` 文件
2. 在界面设置中配置模型
3. 启动应用并发起对话
4. 预期：使用界面配置，启动和对话都成功

### 测试场景 2：仅环境变量
1. 创建 `.env` 文件并配置
2. 不在界面设置中配置模型（或删除配置）
3. 启动应用并发起对话
4. 预期：使用环境变量，向后兼容正常工作

### 测试场景 3：两者都有（界面优先）
1. 创建 `.env` 文件：`OPENAI_MODEL=gpt-3.5-turbo`
2. 界面设置：`model: gpt-4`
3. 查看日志输出
4. 预期：使用 `gpt-4`（界面配置优先）

### 测试场景 4：配置缺失
1. 删除 `.env` 文件
2. 删除界面配置
3. 启动应用
4. 预期：启动成功（宽松验证），但首次对话失败并提示配置缺失

## 🐛 配置调试

启动应用后，查看日志中的配置来源信息：

```
[AgentService] 用户数据目录: /Users/xxx/Library/Application Support/mindforge
[AgentService] 找到 .env 文件: /path/to/.env
配置验证通过（宽松模式）：环境变量可选，将在对话时合并界面配置
使用合并配置构建 Agent: {
  llm: {
    model: 'gpt-4',
    modelSource: 'ui',      // 来自界面配置
    apiKey: 'ui',           // 来自界面配置
    baseURL: 'env'          // 来自环境变量
  }
}
```

配置来源标识：
- `ui` - 来自界面配置（优先）
- `env` - 来自环境变量
- `default` - 使用默认值
- `missing` - 未配置
