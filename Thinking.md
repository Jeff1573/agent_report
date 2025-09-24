# 连接LLM
- 配置相对应环境变量
- 使用LangChain中的openai sdk进行连接LLm
- 可选配置
  - streaming：是否显式传递streaming参数，用于解决streamEvents模式下导致的tool调用问题
  - streamUsage：设置token 流式使用
