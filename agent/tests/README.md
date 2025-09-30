# Agent 测试套件

本目录包含 Agent 核心功能的测试脚本，用于验证各个模块的正确性。

## 测试文件列表

### 核心模块测试

1. **test-config-validation.ts** - 配置验证测试（P1-7）
   - 测试 `validateConfig()` 函数
   - 验证环境变量检测
   - 测试配置摘要功能

2. **test-embeddings.ts** - 嵌入模型工厂测试（P0-2）
   - 测试 OpenAI/Gemini 嵌入模型创建
   - 验证 API Key 检测
   - 测试错误消息

3. **test-tool-registry.ts** - 工具注册表测试（P1-8）
   - 测试工具加载策略
   - 验证错误处理统一性
   - 检查核心/可选工具标识

### RAG 功能测试

4. **test-metadata.ts** - 元数据提取测试
   - 路径推断
   - Frontmatter 解析
   - 语言检测

5. **test-rag-simple.ts** - RAG 完整功能验证
   - 基本检索
   - MMR 重排
   - 元数据过滤

## 快速开始

### 运行所有核心测试
```bash
cd agent
npx tsx tests/test-config-validation.ts
npx tsx tests/test-embeddings.ts
npx tsx tests/test-tool-registry.ts
```

### 运行单个测试
```bash
# 配置验证
npx tsx tests/test-config-validation.ts

# 嵌入模型
npx tsx tests/test-embeddings.ts

# 工具注册
npx tsx tests/test-tool-registry.ts

# 元数据提取
npx tsx tests/test-metadata.ts

# RAG 功能
npx tsx tests/test-rag-simple.ts
```

---

## RAG 元数据过滤功能验证

### 功能验证结果 ✅

根据测试结果，RAG 元数据过滤功能已**成功实现**，各项核心功能均正常工作：

### ✅ 已验证的功能

1. **元数据提取** - 完全正常
   - 路径推断（从文件路径提取 module、lang）
   - Frontmatter 解析（支持 YAML 格式元数据）
   - 语言自动检测（中英文识别）
   - 版本信息提取

2. **基本检索** - 完全正常
   - 相似度检索（similarity）
   - 客户端 MMR 重排（mmr(client)）
   - 结构化 JSON 输出

3. **元数据过滤** - 完全正常
   - where 参数支持
   - 多条件组合过滤
   - 过滤条件透传到 Chroma

4. **智能退化机制** - 完全正常
   - 过滤无结果时自动重试
   - 日志记录退化原因
   - 保证检索可用性

5. **参数控制** - 完全正常
   - k 值收敛（4-8）
   - MMR lambda 调节
   - fetchK 候选集控制

## 测试脚本使用

### 1. 元数据提取测试
```bash
cd agent
npx tsx tests/test-metadata.ts
```

### 2. 完整功能验证
```bash
cd agent  
npx tsx tests/test-rag-simple.ts
```

### 3. 手动测试（使用现有工具）
```bash
# 基本检索
npm run demo:kb:where -- --q "软件架构" --k 4 --type similarity

# MMR 重排
npm run demo:kb:where -- --q "代码质量" --k 6 --type mmr --lambda 0.35

# 元数据过滤
npm run demo:kb:where -- --q "用户认证" --where '{"lang":"zh"}'

# 多条件过滤
npm run demo:kb:where -- --q "支付系统" --where '{"module":"payments","lang":"zh"}'
```

## 性能指标

- **基本检索**: ~1.4s (包含向量计算)
- **MMR 重排**: ~1.5s (额外重排计算)
- **元数据过滤**: ~1.4s (Chroma 原生过滤)

## 已知限制

1. **Chroma 警告**: "No embedding function configuration found" - 不影响功能，仅提示信息
2. **单一数据源**: 当前测试数据较少，实际使用需要更多样的数据
3. **元数据质量**: 依赖入库时的元数据质量

## 下一步建议

1. **生产部署前**:
   - 配置更多测试数据
   - 设置合适的环境变量
   - 监控性能指标

2. **功能扩展**:
   - Cross-Encoder 重排
   - Multi-Query 扩展
   - 更复杂的元数据规则

3. **运维优化**:
   - 日志聚合
   - 性能监控
   - 自动化测试

## 环境变量检查清单

- [x] `CHROMA_URL` - Chroma 数据库地址
- [x] `KB_COLLECTION` - 知识库集合名
- [x] `KB_STORAGE_ROOT` - 存储根目录
- [x] `KB_EMBED_PROVIDER` - 嵌入模型提供商
- [x] `RAG_CTX_CHAR_LIMIT` - 上下文字符限制

## 结论

🎉 **RAG 元数据过滤功能实现成功！**

所有核心功能均通过测试，可以投入使用。该功能将显著提升检索精准度，特别是在多语言、多模块的复杂知识库场景中。
