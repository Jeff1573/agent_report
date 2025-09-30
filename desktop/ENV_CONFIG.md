# 环境配置说明

## 📝 配置文件位置

在**项目根目录** (`mindForge_re/.env`) 创建 `.env` 文件

## ⚙️ 必需配置（最小可运行）

```bash
# LLM 配置（必需）
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
提示：未配置 CHROMA_URL/KB_COLLECTION/嵌入时，检查脚本会提示“禁用内部检索（kb_search）”，但不阻止启动。
