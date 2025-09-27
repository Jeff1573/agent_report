#!/usr/bin/env npx tsx
// agent/scripts/ingest-docs.ts
/**
 * 文档入库脚本 - 在 Agent 执行前预先处理和存储文档
 * 
 * 使用方法:
 *   npx tsx scripts/ingest-docs.ts --collection my-kb --file ./docs/api.md
 *   npx tsx scripts/ingest-docs.ts --collection my-kb --dir ./docs/
 *   npx tsx scripts/ingest-docs.ts --list-collections
 */

import '../config/env.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ingestFile, listRawFiles } from '../services/storage.js'
import { logger } from '../utils/logger.js'

interface CliArgs {
  collection?: string
  file?: string
  dir?: string
  listCollections?: boolean
  chunkSize?: number
  chunkOverlap?: number
  help?: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--list-collections') {
      args.listCollections = true
    } else if (arg === '--collection' && argv[i + 1]) {
      args.collection = argv[++i]
    } else if (arg === '--file' && argv[i + 1]) {
      args.file = argv[++i]
    } else if (arg === '--dir' && argv[i + 1]) {
      args.dir = argv[++i]
    } else if (arg === '--chunk-size' && argv[i + 1]) {
      args.chunkSize = parseInt(argv[++i])
    } else if (arg === '--chunk-overlap' && argv[i + 1]) {
      args.chunkOverlap = parseInt(argv[++i])
    }
  }
  return args
}

function showHelp() {
  console.log(`
📚 文档入库工具 - RAG 数据预处理

用法:
  npx tsx scripts/ingest-docs.ts [选项]

选项:
  --collection <name>     指定知识库集合名 (必需)
  --file <path>          入库单个文件
  --dir <path>           入库整个目录 (递归)
  --chunk-size <num>     文档切块大小 (默认: 1000)
  --chunk-overlap <num>  切块重叠大小 (默认: 150)
  --list-collections     列出所有现有集合
  --help, -h             显示此帮助信息

示例:
  # 入库单个文件
  npx tsx scripts/ingest-docs.ts --collection api-docs --file ./README.md
  
  # 入库整个目录
  npx tsx scripts/ingest-docs.ts --collection user-guide --dir ./docs/
  
  # 自定义切块参数
  npx tsx scripts/ingest-docs.ts --collection large-docs --dir ./docs/ --chunk-size 1500 --chunk-overlap 200
  
  # 查看现有集合
  npx tsx scripts/ingest-docs.ts --list-collections

注意:
  - 入库需要在 Agent 执行前完成
  - 确保 Chroma 服务正在运行 (CHROMA_URL)
  - 支持格式: .md, .txt, .pdf, .docx
`)
}

async function listCollections() {
  console.log('📋 现有知识库集合:')
  try {
    const files = await listRawFiles()
    const collections = new Set(
      files.map(f => f.meta.relativePath.split('/')[0])
    )
    
    if (collections.size === 0) {
      console.log('  (暂无集合)')
    } else {
      collections.forEach(collection => {
        const fileCount = files.filter(f => 
          f.meta.relativePath.startsWith(collection + '/')
        ).length
        console.log(`  📁 ${collection} (${fileCount} 个文件)`)
      })
    }
  } catch (error) {
    console.error('❌ 列出集合失败:', (error as Error).message)
  }
}

async function ingestSingleFile(
  filePath: string, 
  collection: string, 
  options: { chunkSize?: number; chunkOverlap?: number }
) {
  const filename = path.basename(filePath)
  const buffer = await fs.readFile(filePath)
  
  console.log(`📄 入库文件: ${filename}`)
  console.log(`   大小: ${(buffer.length / 1024).toFixed(1)} KB`)
  console.log(`   集合: ${collection}`)
  
  const startTime = Date.now()
  const result = await ingestFile({
    collectionName: collection,
    filename,
    buffer,
    split: {
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap
    }
  })
  const duration = Date.now() - startTime
  
  console.log(`✅ 入库完成 (${duration}ms)`)
  console.log(`   切块数量: ${result.chunks}`)
  console.log(`   存储路径: ${result.file.relativePath}`)
}

async function ingestDirectory(
  dirPath: string, 
  collection: string, 
  options: { chunkSize?: number; chunkOverlap?: number }
) {
  const supportedExts = ['.md', '.txt', '.pdf', '.docx']
  
  async function scanDir(dir: string): Promise<string[]> {
    const files: string[] = []
    const entries = await fs.readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...await scanDir(fullPath))
      } else if (supportedExts.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath)
      }
    }
    return files
  }
  
  console.log(`📁 扫描目录: ${dirPath}`)
  const files = await scanDir(dirPath)
  
  if (files.length === 0) {
    console.log('⚠️  未找到支持的文档文件')
    return
  }
  
  console.log(`📊 找到 ${files.length} 个文档文件`)
  console.log(`🎯 目标集合: ${collection}\n`)
  
  let successCount = 0
  let totalChunks = 0
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    try {
      console.log(`[${i + 1}/${files.length}] ${path.relative(dirPath, file)}`)
      const result = await ingestSingleFile(file, collection, options)
      successCount++
      // totalChunks += result.chunks // 需要修改 ingestSingleFile 返回值
    } catch (error) {
      console.error(`❌ 入库失败: ${(error as Error).message}`)
    }
    console.log() // 空行分隔
  }
  
  console.log('📊 入库统计:')
  console.log(`   成功: ${successCount}/${files.length}`)
  console.log(`   失败: ${files.length - successCount}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  
  if (args.help) {
    showHelp()
    return
  }
  
  if (args.listCollections) {
    await listCollections()
    return
  }
  
  if (!args.collection) {
    console.error('❌ 错误: 必须指定 --collection 参数')
    console.log('使用 --help 查看帮助信息')
    process.exit(1)
  }
  
  if (!args.file && !args.dir) {
    console.error('❌ 错误: 必须指定 --file 或 --dir 参数')
    console.log('使用 --help 查看帮助信息')
    process.exit(1)
  }
  
  const options = {
    chunkSize: args.chunkSize,
    chunkOverlap: args.chunkOverlap
  }
  
  try {
    if (args.file) {
      await ingestSingleFile(args.file, args.collection, options)
    } else if (args.dir) {
      await ingestDirectory(args.dir, args.collection, options)
    }
  } catch (error) {
    logger.error('入库失败', { error: (error as Error).message })
    process.exit(1)
  }
}

main().catch(console.error)
