#!/usr/bin/env node
/**
 * 开发前环境检查脚本
 * 
 * 检查项：
 * 1. Agent workspace 是否存在
 * 2. .env 配置是否完整
 * 3. ChromaDB 连接测试
 * 4. 依赖包是否安装
 */

const fs = require('fs')
const path = require('path')
const http = require('http')

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
}

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`)
}

function checkFileExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    log(`✓ ${description}`, 'green')
    return true
  } else {
    log(`✗ ${description}`, 'red')
    return false
  }
}

function findEnvFile() {
  const possiblePaths = [
    path.resolve(__dirname, '../../.env'),           // 项目根目录（推荐）
    path.resolve(__dirname, '../../agent/.env'),     // agent 目录
  ]
  
  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      return envPath
    }
  }
  
  return null
}

function checkEnvVar(varName, description) {
  // 查找 .env 文件
  const envPath = findEnvFile()
  
  if (!envPath) {
    log(`✗ .env 文件不存在（检查了根目录和 agent/ 目录）`, 'red')
    return false
  }

  const envContent = fs.readFileSync(envPath, 'utf-8')
  const hasVar = envContent.split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed.startsWith(varName) && trimmed.includes('=') && !trimmed.startsWith('#')
  })

  if (hasVar) {
    log(`✓ ${description}`, 'green')
    return true
  } else {
    log(`✗ ${description}`, 'yellow')
    return false
  }
}

function checkChromaDB(url) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname
    const port = parsedUrl.port || 8000
    // 规范化 base 路径，确保不会出现重复斜杠，且始终以单个 / 开头
    const base = (parsedUrl.pathname || '')
      .replace(/\/+$/,'')   // 去除结尾斜杠
      .replace(/^\/+/, '')  // 去除开头多余斜杠
    // Chroma OSS REST 心跳路径为 v1 版本
    const urlPath = `/${base ? base + '/' : ''}api/v2/heartbeat`

    const options = { hostname, port, path: urlPath, method: 'GET', timeout: 3000 }
    const req = http.request(options, (res) => {
      const tested = `${parsedUrl.protocol}//${parsedUrl.host}${urlPath}`
      if (res.statusCode === 200) {
        log(`✓ ChromaDB 连接成功 (${tested})`, 'green')
        resolve(true)
      } else {
        log(`✗ ChromaDB 返回状态码 ${res.statusCode} (${tested})`, 'yellow')
        resolve(false)
      }
    })
    req.on('error', () => {
      const tested = `${parsedUrl.protocol}//${parsedUrl.host}${urlPath}`
      log(`✗ ChromaDB 无法连接 (${tested})`, 'yellow')
      log(`  提示: 请启动 ChromaDB 服务或检查 CHROMA_URL`, 'blue')
      resolve(false)
    })
    req.on('timeout', () => {
      req.destroy()
      const tested = `${parsedUrl.protocol}//${parsedUrl.host}${urlPath}`
      log(`✗ ChromaDB 连接超时 (${tested})`, 'yellow')
      resolve(false)
    })
    req.end()
  })
}

async function main() {
  log('\n========================================', 'blue')
  log('  MindForge Electron 开发环境检查', 'blue')
  log('========================================\n', 'blue')

  let allPassed = true

  // 1. 检查项目结构
  log('1. 检查项目结构...', 'blue')
  allPassed &= checkFileExists(
    path.resolve(__dirname, '../../agent/runtime/index.ts'),
    'Agent Runtime 文件存在'
  )
  allPassed &= checkFileExists(
    path.resolve(__dirname, '../../agent/package.json'),
    'Agent package.json 存在'
  )

  // 2. 检查 .env 配置
  log('\n2. 检查环境配置...', 'blue')
  const envPath = findEnvFile()
  if (envPath) {
    log(`  找到配置文件: ${path.relative(path.resolve(__dirname, '../..'), envPath)}`, 'blue')
    allPassed &= checkEnvVar('OPENAI_API_KEY', 'OPENAI_API_KEY 已配置')
    allPassed &= checkEnvVar('OPENAI_MODEL', 'OPENAI_MODEL 已配置')
    // RAG 配置改为可选：仅提示，不影响总体通过
    const chromaOk = checkEnvVar('CHROMA_URL', 'CHROMA_URL 已配置 (RAG 可选)')
    const collOk = checkEnvVar('KB_COLLECTION', 'KB_COLLECTION 已配置 (RAG 可选)')
    checkEnvVar('KB_EMBED_MODEL', 'KB_EMBED_MODEL 已配置 (RAG 可选, openai 模式)')
    checkEnvVar('TAVILY_API_KEY', 'TAVILY_API_KEY 已配置 (可选)')
    if (!(chromaOk && collOk)) {
      log('  说明: 未配置向量库，将禁用内部检索（kb_search）功能', 'yellow')
    }
  } else {
    log('✗ 未找到 .env 文件（已检查根目录和 agent/ 目录）', 'red')
    log('  建议: 在项目根目录创建 .env 文件', 'yellow')
    allPassed = false
  }

  // 3. 检查 ChromaDB 连接
  log('\n3. 检查 ChromaDB 服务...', 'blue')
  const envPathForChroma = findEnvFile()
  if (envPathForChroma) {
    const envContent = fs.readFileSync(envPathForChroma, 'utf-8')
    const chromaUrlLine = envContent.split('\n').find(line => 
      line.trim().startsWith('CHROMA_URL=') && !line.trim().startsWith('#')
    )
    
    if (chromaUrlLine) {
      const chromaUrl = chromaUrlLine.split('=')[1].trim()
      await checkChromaDB(chromaUrl)
    } else {
      log('✗ CHROMA_URL 未在 .env 中配置', 'yellow')
    }
  }

  // 4. 检查依赖
  log('\n4. 检查依赖安装...', 'blue')
  allPassed &= checkFileExists(
    path.resolve(__dirname, '../../node_modules'),
    '根目录 node_modules 存在'
  )
  allPassed &= checkFileExists(
    path.resolve(__dirname, '../node_modules'),
    'desktop node_modules 存在'
  )
  allPassed &= checkFileExists(
    path.resolve(__dirname, '../../agent/node_modules'),
    'agent node_modules 存在'
  )

  // 总结
  log('\n========================================', 'blue')
  if (allPassed) {
    log('✓ 所有必需项检查通过！', 'green')
    log('\n可以运行: npm run dev', 'blue')
  } else {
    log('⚠ 部分检查未通过', 'yellow')
    log('\n建议操作:', 'blue')
    log('1. 确保项目根目录有 .env 文件并配置必需项', 'reset')
    log('2. 运行 npm install 安装依赖', 'reset')
    log('3. 启动 ChromaDB: docker run -p 8000:8000 chromadb/chroma', 'reset')
    log('4. 或查看文档: docs/ELECTRON_INTEGRATION.md', 'reset')
  }
  log('========================================\n', 'blue')

  process.exit(allPassed ? 0 : 1)
}

main().catch(console.error)
