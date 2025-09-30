// agent/tests/test-embeddings.ts
/**
 * 测试嵌入模型工厂（P0-2）
 * 
 * 测试目标：
 * - makeKbEmbeddings() 正确验证 API Key
 * - 支持 OpenAI 和 Gemini 两种提供商
 * - API Key 缺失时抛出清晰的错误
 */
import '../config/env.js'

console.log('=== 测试嵌入模型工厂 ===\n')

// 保存原始环境变量
const originalEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  KB_EMBED_PROVIDER: process.env.KB_EMBED_PROVIDER,
  KB_EMBED_MODEL: process.env.KB_EMBED_MODEL
}

async function testEmbeddingsFactory() {
  console.log('1. 测试 OpenAI 嵌入模型创建:')
  try {
    process.env.KB_EMBED_PROVIDER = 'openai'
    process.env.KB_EMBED_MODEL = 'text-embedding-3-small'
    
    // 重新导入以应用新的环境变量（使用查询参数绕过缓存）
    const { makeKbEmbeddings } = await import(`../services/embeddings.js?t=${Date.now()}`)
    
    const embeddings = makeKbEmbeddings()
    console.log('  ✅ OpenAI 嵌入模型创建成功')
    console.log(`  模型: ${(embeddings as any).model}\n`)
  } catch (error) {
    console.log('  ❌ 创建失败:', (error as Error).message, '\n')
  }

  console.log('2. 测试缺失 OPENAI_API_KEY:')
  try {
    const saved = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    process.env.KB_EMBED_PROVIDER = 'openai'
    
    delete require.cache[require.resolve('../services/embeddings.js')]
    const { makeKbEmbeddings } = await import('../services/embeddings.js')
    
    makeKbEmbeddings()
    console.log('  ❌ 应该抛出错误但没有\n')
    if (saved) process.env.OPENAI_API_KEY = saved
  } catch (error) {
    const errorMsg = (error as Error).message
    if (errorMsg.includes('OPENAI_API_KEY') || errorMsg.includes('OpenAI API Key')) {
      console.log('  ✅ 正确检测到缺失 OPENAI_API_KEY')
      console.log(`  错误消息: ${errorMsg.split('\n')[0]}\n`)
    } else {
      console.log('  ⚠️ 错误消息不正确:', errorMsg, '\n')
    }
    if (originalEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  }

  console.log('3. 测试缺失 KB_EMBED_MODEL:')
  try {
    const saved = process.env.KB_EMBED_MODEL
    delete process.env.KB_EMBED_MODEL
    process.env.KB_EMBED_PROVIDER = 'openai'
    
    delete require.cache[require.resolve('../services/embeddings.js')]
    const { makeKbEmbeddings } = await import('../services/embeddings.js')
    
    makeKbEmbeddings()
    console.log('  ❌ 应该抛出错误但没有\n')
    if (saved) process.env.KB_EMBED_MODEL = saved
  } catch (error) {
    const errorMsg = (error as Error).message
    if (errorMsg.includes('KB_EMBED_MODEL') || errorMsg.includes('嵌入模型名称')) {
      console.log('  ✅ 正确检测到缺失 KB_EMBED_MODEL')
      console.log(`  错误消息: ${errorMsg.split('\n')[0]}\n`)
    } else {
      console.log('  ⚠️ 错误消息不正确:', errorMsg, '\n')
    }
    if (originalEnv.KB_EMBED_MODEL) process.env.KB_EMBED_MODEL = originalEnv.KB_EMBED_MODEL
  }

  console.log('4. 测试 Gemini 嵌入模型（如果配置了 API Key）:')
  if (originalEnv.GOOGLE_API_KEY && originalEnv.GOOGLE_API_KEY.trim().length > 0) {
    try {
      process.env.KB_EMBED_PROVIDER = 'gemini'
      process.env.GOOGLE_API_KEY = originalEnv.GOOGLE_API_KEY
      
      delete require.cache[require.resolve('../services/embeddings.js')]
      const { makeKbEmbeddings } = await import('../services/embeddings.js')
      
      const embeddings = makeKbEmbeddings()
      console.log('  ✅ Gemini 嵌入模型创建成功')
      console.log(`  模型: ${(embeddings as any).model}\n`)
    } catch (error) {
      console.log('  ❌ 创建失败:', (error as Error).message, '\n')
    }
  } else {
    console.log('  ⏭️  跳过（未配置 GOOGLE_API_KEY）\n')
  }

  console.log('5. 测试缺失 GOOGLE_API_KEY（Gemini 模式）:')
  try {
    const saved = process.env.GOOGLE_API_KEY
    delete process.env.GOOGLE_API_KEY
    process.env.KB_EMBED_PROVIDER = 'gemini'
    
    delete require.cache[require.resolve('../services/embeddings.js')]
    const { makeKbEmbeddings } = await import('../services/embeddings.js')
    
    makeKbEmbeddings()
    console.log('  ❌ 应该抛出错误但没有\n')
    if (saved) process.env.GOOGLE_API_KEY = saved
  } catch (error) {
    const errorMsg = (error as Error).message
    if (errorMsg.includes('GOOGLE_API_KEY') || errorMsg.includes('Google API Key')) {
      console.log('  ✅ 正确检测到缺失 GOOGLE_API_KEY')
      console.log(`  错误消息: ${errorMsg.split('\n')[0]}\n`)
    } else {
      console.log('  ⚠️ 错误消息不正确:', errorMsg, '\n')
    }
    if (originalEnv.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = originalEnv.GOOGLE_API_KEY
  }
}

// 运行测试
testEmbeddingsFactory()
  .then(() => {
    // 恢复所有环境变量
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    })
    console.log('✅ 嵌入模型工厂测试完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 测试失败:', error)
    // 恢复所有环境变量
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value
      }
    })
    process.exit(1)
  })
