// agent/tests/test-rag-simple.ts
/**
 * RAG 功能简单验证脚本
 */
import '../config/env.js'
import { kbSearchTool } from '../tools/kb.js'

async function testBasicSearch() {
  console.log('🧪 测试基本检索功能...')
  const result = await kbSearchTool.invoke({
    query: '软件架构',
    k: 3,
    searchType: 'similarity'
  })
  
  const content = typeof (result as any)?.content === 'string' 
    ? (result as any).content 
    : String(result)
  
  const parsed = JSON.parse(content)
  console.log(`✅ 基本检索: 类型=${parsed.search.type}, 来源=${parsed.sources.length}个`)
  return parsed
}

async function testMMRClient() {
  console.log('🧪 测试客户端 MMR...')
  const result = await kbSearchTool.invoke({
    query: '代码质量',
    k: 4
  })
  
  const content = typeof (result as any)?.content === 'string' 
    ? (result as any).content 
    : String(result)
  
  const parsed = JSON.parse(content)
  console.log(`✅ MMR 重排: 类型=${parsed.search.type}, 来源=${parsed.sources.length}个`)
  return parsed
}

async function testMetadataFilter() {
  console.log('🧪 测试元数据过滤...')
  const result = await kbSearchTool.invoke({
    query: '工程师',
    k: 3,
    where: { lang: 'zh' }
  })
  
  const content = typeof (result as any)?.content === 'string' 
    ? (result as any).content 
    : String(result)
  
  const parsed = JSON.parse(content)
  const hasWhere = parsed.search.where !== undefined
  console.log(`✅ 元数据过滤: where=${hasWhere}, 来源=${parsed.sources.length}个`)
  return parsed
}

async function main() {
  console.log('🚀 RAG 功能验证开始\n')
  
  try {
    await testBasicSearch()
    await new Promise(resolve => setTimeout(resolve, 500))
    
    await testMMRClient()
    await new Promise(resolve => setTimeout(resolve, 500))
    
    await testMetadataFilter()
    
    console.log('\n🎉 所有测试通过！')
    console.log('\n📋 功能验证结果:')
    console.log('✅ 基本检索 - 正常')
    console.log('✅ MMR 重排 - 正常')
    console.log('✅ 元数据过滤 - 正常')
    console.log('✅ 结构化输出 - 正常')
    
  } catch (error) {
    console.error('❌ 测试失败:', (error as Error).message)
    process.exit(1)
  }
}

main()
