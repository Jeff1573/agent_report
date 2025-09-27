// agent/tests/test-metadata.ts
/**
 * 测试元数据提取功能
 */
import '../config/env.js'
import { enrichDocuments } from '../services/metadata.js'
import { Document } from '@langchain/core/documents'

console.log('=== 测试元数据提取功能 ===\n')

// 测试1: 路径推断
console.log('1. 测试路径推断:')
const testDocs1 = [
  new Document({
    pageContent: '这是一个支付模块的中文文档。version 2.1.0 was released on 2025-09-27.',
    metadata: { source: '/docs/payments/api.zh.md' }
  }),
  new Document({
    pageContent: 'This is an English document about authentication.',
    metadata: { source: '/src/auth/guide.en.md' }
  })
]

const enriched1 = enrichDocuments(testDocs1)
enriched1.forEach((doc, i) => {
  console.log(`  Doc ${i + 1}:`)
  console.log(`    Module: ${doc.metadata.module}`)
  console.log(`    Lang: ${doc.metadata.lang}`)
  console.log(`    Version: ${doc.metadata.version}`)
  console.log(`    Source: ${doc.metadata.source}`)
  console.log()
})

// 测试2: Frontmatter 解析
console.log('2. 测试 Frontmatter 解析:')
const testDocs2 = [
  new Document({
    pageContent: `---
module: user-management
lang: zh
version: 1.5.2
tags: api, guide, auth
updatedAt: 2025-09-27
---

# 用户管理模块

这是用户管理的详细文档...`,
    metadata: { source: '/docs/user/management.md' }
  })
]

const enriched2 = enrichDocuments(testDocs2)
console.log('  Frontmatter 解析结果:')
console.log(`    Module: ${enriched2[0].metadata.module}`)
console.log(`    Lang: ${enriched2[0].metadata.lang}`)
console.log(`    Version: ${enriched2[0].metadata.version}`)
console.log(`    Tags: ${JSON.stringify(enriched2[0].metadata.tags)}`)
console.log(`    UpdatedAt: ${enriched2[0].metadata.updatedAt}`)
console.log()

// 测试3: 语言检测
console.log('3. 测试语言检测:')
const testDocs3 = [
  new Document({
    pageContent: '这是一篇中文文档，包含大量中文字符。主要介绍系统架构和设计思路。',
    metadata: { source: '/mixed/doc1.md' }
  }),
  new Document({
    pageContent: 'This is an English document with English content. It describes the system architecture.',
    metadata: { source: '/mixed/doc2.md' }
  })
]

const enriched3 = enrichDocuments(testDocs3)
enriched3.forEach((doc, i) => {
  console.log(`  Doc ${i + 1} 检测语言: ${doc.metadata.lang}`)
})
console.log()

console.log('✅ 元数据提取功能测试完成')
