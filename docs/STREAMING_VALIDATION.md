# 流式支持验证功能文档

## 📋 概述

MindForge Agent 现在支持自动验证 LLM 提供商的流式输出能力。系统会在用户配置提供商后自动测试，并将结果保存到配置文件中，帮助优化用户体验。

## 🎯 功能特性

### 1. 自动验证
- ✅ 用户保存模型配置后，可以手动触发流式验证
- ✅ 发送测试消息验证是否支持流式输出
- ✅ 15秒超时检测
- ✅ 记录首个 token 延迟

### 2. 结果保存
- ✅ 验证结果自动保存到 `settings.json`
- ✅ 包含详细信息：是否支持、延迟、错误信息
- ✅ 支持查看历史验证记录

### 3. 智能缓存
- ✅ 避免重复验证同一配置
- ✅ 切换模型时自动重新验证
- ✅ 支持强制重新验证

## 📊 验证结果结构

```typescript
interface StreamingValidationResult {
  supported: boolean;          // 是否支持流式
  duration: number;            // 验证耗时（毫秒）
  error?: string;              // 错误信息
  tokenCount?: number;         // 收到的 token 数量
  firstTokenLatency?: number;  // 首个 token 延迟（毫秒）
  timestamp: number;           // 验证时间戳
}
```

## 🔧 使用方法

### 前端调用

```typescript
// 在设置页面或模型配置后调用
const result = await window.api.settings.validateStreaming(modelId);

if (result.supported) {
  console.log(`✅ 支持流式输出`);
  console.log(`首个 token 延迟: ${result.firstTokenLatency}ms`);
} else {
  console.log(`❌ 不支持流式输出`);
  console.log(`原因: ${result.error}`);
}
```

### 验证结果示例

**支持流式的配置（快速响应）：**
```json
{
  "id": "model-123",
  "name": "OpenAI GPT-4",
  "streamingValidation": {
    "supported": true,
    "duration": 1234,
    "tokenCount": 2,
    "firstTokenLatency": 856,
    "timestamp": 1696012345678
  }
}
```

**支持流式但响应慢：**
```json
{
  "id": "model-456",
  "name": "Claude via Proxy",
  "streamingValidation": {
    "supported": true,
    "duration": 9719,
    "tokenCount": 1,
    "firstTokenLatency": 9700,
    "timestamp": 1696012345678
  }
}
```

**不支持流式：**
```json
{
  "id": "model-789",
  "name": "Custom Model",
  "streamingValidation": {
    "supported": false,
    "duration": 15000,
    "error": "验证超时（15000ms），未收到流式数据",
    "timestamp": 1696012345678
  }
}
```

## 💡 用户体验优化建议

### 基于验证结果的决策

```typescript
// 1. 快速响应（< 2秒）→ 推荐开启流式
if (result.supported && result.firstTokenLatency! < 2000) {
  recommendation = "推荐开启流式，可提供逐字显示体验";
  suggestedStreaming = true;
}

// 2. 响应慢（> 8秒）→ 推荐关闭流式
else if (result.supported && result.firstTokenLatency! > 8000) {
  recommendation = "流式响应较慢，建议关闭以避免用户等待焦虑";
  suggestedStreaming = false;
}

// 3. 不支持 → 强制关闭流式
else if (!result.supported) {
  recommendation = "该提供商不支持流式输出";
  suggestedStreaming = false;
}
```

## 📁 文件结构

```
agent/llm/streaming-validator.ts          # 验证器实现
desktop/src/main/services/settingsService.ts  # 设置服务（含验证功能）
desktop/src/shared/ipc.ts                 # IPC 通道和类型定义
```

## 🔍 工作流程

1. **用户保存配置**
   - 用户在设置页面配置模型
   - 点击"保存"按钮

2. **触发验证**（可选手动触发）
   ```typescript
   await window.api.settings.validateStreaming(modelId);
   ```

3. **执行验证**
   - 发送测试消息："Say OK"
   - 等待流式响应（最多15秒）
   - 记录首个 token 到达时间

4. **保存结果**
   - 将验证结果保存到 `settings.json`
   - 更新配置对象的 `streamingValidation` 字段

5. **用户查看**
   - 在设置页面显示验证结果
   - 显示推荐配置（是否开启流式）

## 📝 实现细节

### 验证逻辑

```typescript
async function validateStreamingSupport(config: RuntimeConfig): Promise<StreamingValidationResult> {
  // 1. 创建 LLM 实例（强制开启流式）
  const llm = makeChatModel({ ...config, streaming: true });
  
  // 2. 发送测试消息
  const testMessage = { role: 'user', content: 'Say "OK"' };
  const stream = await llm.stream([testMessage]);
  
  // 3. 监听流式数据
  for await (const chunk of stream) {
    if (收到第一个有效 token) {
      return { supported: true, firstTokenLatency: ... };
    }
  }
  
  // 4. 超时或无数据
  return { supported: false, error: '超时或无数据' };
}
```

### 缓存策略

```typescript
// 缓存键：provider-model-apiKey前8位
const cacheKey = `${provider}-${model}-${apiKey.substring(0, 8)}`;

// 读取缓存
if (cache.has(cacheKey) && !forceRevalidate) {
  return cache.get(cacheKey);
}

// 验证后更新缓存
cache.set(cacheKey, result);
```

## 🎨 前端集成建议

### 设置页面添加验证按钮

```tsx
<Button 
  onClick={async () => {
    setValidating(true);
    const result = await window.api.settings.validateStreaming(model.id);
    setValidationResult(result);
    setValidating(false);
  }}
  loading={validating}
>
  验证流式支持
</Button>

{validationResult && (
  <Alert
    type={validationResult.supported ? 'success' : 'warning'}
    message={
      validationResult.supported
        ? `✅ 支持流式输出（首个 token 延迟: ${validationResult.firstTokenLatency}ms）`
        : `❌ 不支持流式输出: ${validationResult.error}`
    }
  />
)}
```

### 自动提示推荐配置

```tsx
{model.streamingValidation && (
  <Tooltip title={getRecommendation(model.streamingValidation)}>
    <Badge 
      status={model.streamingValidation.supported ? 'success' : 'default'}
      text={model.streamingValidation.supported ? '已验证' : '不支持'}
    />
  </Tooltip>
)}
```

## 🚀 下一步优化

- [ ] 在保存模型配置后自动触发验证（可选）
- [ ] 在设置页面显示验证历史记录
- [ ] 支持批量验证所有模型配置
- [ ] 根据验证结果自动调整 `streaming` 配置
- [ ] 添加验证进度指示器
- [ ] 支持取消正在进行的验证

## 📞 API 参考

### IPC 通道
- `settings/model/validateStreaming`: 验证模型流式支持

### 前端 API
```typescript
window.api.settings.validateStreaming(modelId: string): Promise<StreamingValidationResult>
```

### 主进程服务
```typescript
settingsService.validateModelStreaming(modelId: string): Promise<StreamingValidationResult>
```

---

**最后更新**: 2025-10-01  
**版本**: 1.0.0

