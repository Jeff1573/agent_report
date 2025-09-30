# 环境配置说明

## 📝 配置文件位置

在**项目根目录** (`mindForge_re/.env`) 创建 `.env` 文件

## ⚙️ 必需配置

```bash
# LLM 配置
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4
OPENAI_BASE_URL=https://api.openai.com/v1

# 向量数据库
CHROMA_URL=http://localhost:8000
KB_COLLECTION=mindforge_kb

# 嵌入模型
KB_EMBED_PROVIDER=openai
KB_EMBED_MODEL=text-embedding-3-small
```

## 🔧 可选配置

```bash
# 外部搜索
TAVILY_API_KEY=tvly-your-key-here

# Agent 行为
RECURSION_LIMIT=300
TOOL_MAX_CALLS=100
TOOL_TIMEOUT_MS=45000
TOOL_RETRY_ATTEMPTS=5

# 持久化
CHECKPOINT_MODE=memory
THREAD_ID=default-thread
```

## ✅ 验证配置

运行检查脚本：
```bash
npm run precheck
```
