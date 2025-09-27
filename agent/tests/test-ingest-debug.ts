// agent/tests/test-ingest-debug.ts
/**
 * 调试入库流程
 */
import '../config/env.js'
import * as fs from 'node:fs/promises'
import { loadDocumentsFromRaw, splitDocuments, upsertToChroma, saveRawFile } from '../services/storage.js'
import { makeKbEmbeddings } from '../services/embeddings.js'

async function debugIngestProcess() {
  console.log('🔍 调试入库流程...\n')
  
  try {
    const testFile = '/Users/fj/Desktop/Agent/mindForge_re/docs/RAG优化方案.md'
    const collectionName = 'debug_test'
    
    // 1. 读取文件
    console.log('1. 读取测试文件...')
    const buffer = await fs.readFile(testFile)
    console.log(`   文件大小: ${buffer.length} bytes`)
    
    // 2. 保存到 raw 目录
    console.log('\n2. 保存原始文件...')
    const meta = await saveRawFile('RAG优化方案.md', buffer, collectionName)
    console.log(`   相对路径: ${meta.relativePath}`)
    
    // 3. 加载文档
    console.log('\n3. 加载文档...')
    const docs = await loadDocumentsFromRaw(meta.relativePath)
    console.log(`   文档数量: ${docs.length}`)
    docs.forEach((doc, i) => {
      console.log(`   文档${i+1}: ${doc.pageContent.length} 字符`)
      console.log(`   元数据: ${JSON.stringify(doc.metadata, null, 2)}`)
    })
    
    // 4. 文档切块
    console.log('\n4. 文档切块...')
    const chunks = await splitDocuments(docs)
    console.log(`   切块数量: ${chunks.length}`)
    chunks.forEach((chunk, i) => {
      console.log(`   切块${i+1}: ${chunk.pageContent.length} 字符`)
      if (i < 3) { // 只显示前3个
        console.log(`     内容预览: ${chunk.pageContent.slice(0, 100)}...`)
      }
    })
    
    // 5. 测试向量化
    console.log('\n5. 测试向量化...')
    const embeddings = makeKbEmbeddings()
    
    // 测试单个切块
    const testChunk = chunks[0]
    console.log(`   测试切块内容长度: ${testChunk.pageContent.length}`)
    console.log(`   内容: ${testChunk.pageContent.slice(0, 200)}...`)
    
    const vector = await embeddings.embedQuery(testChunk.pageContent)
    console.log(`   向量维度: ${vector.length}`)
    console.log(`   向量是否为空: ${vector.length === 0}`)
    
    if (vector.length > 0) {
      console.log('✅ 单个切块向量化成功')
      
      // 测试批量向量化
      console.log('\n6. 测试批量向量化...')
      const texts = chunks.slice(0, 3).map(c => c.pageContent)
      const vectors = await embeddings.embedDocuments(texts)
      console.log(`   批量向量数量: ${vectors.length}`)
      vectors.forEach((v, i) => {
        console.log(`   向量${i+1}维度: ${v.length}, 空向量: ${v.length === 0}`)
      })
      
      if (vectors.some(v => v.length === 0)) {
        console.error('❌ 发现空向量！')
        vectors.forEach((v, i) => {
          if (v.length === 0) {
            console.error(`   空向量位置: ${i}, 对应文本长度: ${texts[i].length}`)
            console.error(`   文本内容: ${texts[i]}`)
          }
        })
      } else {
        console.log('✅ 批量向量化成功')
        
        // 7. 尝试写入 Chroma
        console.log('\n7. 尝试写入 Chroma...')
        await upsertToChroma(collectionName, chunks.slice(0, 2)) // 只测试前2个
        console.log('✅ Chroma 写入成功')
      }
    } else {
      console.error('❌ 单个切块向量化失败')
    }
    
  } catch (error) {
    console.error('\n❌ 调试过程出错:', (error as Error).message)
    console.error('Stack:', (error as Error).stack)
  }
}

debugIngestProcess()
