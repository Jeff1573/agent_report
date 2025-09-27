// agent/tests/test-gemini-batch.ts
/**
 * 测试 Gemini 批量嵌入问题
 */
import '../config/env.js'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { GOOGLE_API_KEY, KB_EMBED_MODEL } from '../config/env.js'

async function testGeminiBatch() {
  console.log('🧪 测试 Gemini 批量嵌入问题...\n')
  
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: GOOGLE_API_KEY,
    model: KB_EMBED_MODEL
  })
  
  const testTexts = [
    "这是第一个测试文本",
    "这是第二个测试文本", 
    "这是第三个测试文本"
  ]
  
  console.log('📝 测试文本:')
  testTexts.forEach((text, i) => {
    console.log(`   ${i+1}. ${text}`)
  })
  
  try {
    // 测试单个向量化
    console.log('\n🔍 单个向量化测试:')
    for (let i = 0; i < testTexts.length; i++) {
      const text = testTexts[i]
      const vector = await embeddings.embedQuery(text)
      console.log(`   文本${i+1}: 维度=${vector.length}, 有效=${vector.length > 0}`)
    }
    
    // 测试批量向量化
    console.log('\n🔍 批量向量化测试:')
    const vectors = await embeddings.embedDocuments(testTexts)
    console.log(`   返回向量数: ${vectors.length}`)
    vectors.forEach((vector, i) => {
      console.log(`   向量${i+1}: 维度=${vector.length}, 有效=${vector.length > 0}`)
      if (vector.length === 0) {
        console.log(`     ❌ 空向量！对应文本: "${testTexts[i]}"`)
      }
    })
    
    // 尝试更小的批量
    console.log('\n🔍 小批量测试 (单个):')
    const singleBatch = await embeddings.embedDocuments([testTexts[0]])
    console.log(`   小批量结果: 维度=${singleBatch[0]?.length || 0}`)
    
  } catch (error) {
    console.error('❌ 测试失败:', (error as Error).message)
    console.error('Stack:', (error as Error).stack)
  }
}

testGeminiBatch()
