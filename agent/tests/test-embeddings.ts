// agent/tests/test-embeddings.ts
/**
 * 测试嵌入模型功能
 */
import '../config/env.js'
import { makeKbEmbeddings } from '../services/embeddings.js'

async function testEmbeddings() {
  console.log('🧪 测试嵌入模型功能...\n')
  
  try {
    console.log('1. 创建嵌入实例...')
    const embeddings = makeKbEmbeddings()
    console.log(`✅ 嵌入实例创建成功: ${embeddings.constructor.name}`)
    
    console.log('\n2. 测试单个文本嵌入...')
    const testText = "这是一个测试文本"
    console.log(`   文本: "${testText}"`)
    
    const startTime = Date.now()
    const vector = await embeddings.embedQuery(testText)
    const duration = Date.now() - startTime
    
    console.log(`✅ 嵌入计算成功 (${duration}ms)`)
    console.log(`   向量维度: ${vector.length}`)
    console.log(`   向量预览: [${vector.slice(0, 5).map(n => n.toFixed(4)).join(', ')}...]`)
    
    if (vector.length === 0) {
      throw new Error('返回了空向量数组！')
    }
    
    console.log('\n3. 测试批量文本嵌入...')
    const testTexts = [
      "软件架构设计",
      "代码质量管理", 
      "用户认证系统"
    ]
    console.log(`   文本数量: ${testTexts.length}`)
    
    const startTime2 = Date.now()
    const vectors = await embeddings.embedDocuments(testTexts)
    const duration2 = Date.now() - startTime2
    
    console.log(`✅ 批量嵌入成功 (${duration2}ms)`)
    console.log(`   返回向量数: ${vectors.length}`)
    vectors.forEach((v, i) => {
      console.log(`   向量${i+1}维度: ${v.length}`)
      if (v.length === 0) {
        throw new Error(`第${i+1}个向量为空！`)
      }
    })
    
    console.log('\n🎉 所有嵌入测试通过！')
    
  } catch (error) {
    console.error('\n❌ 嵌入测试失败:', (error as Error).message)
    console.error('Stack:', (error as Error).stack)
    process.exit(1)
  }
}

testEmbeddings()
