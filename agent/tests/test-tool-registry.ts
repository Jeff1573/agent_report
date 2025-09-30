// agent/tests/test-tool-registry.ts
/**
 * 测试工具注册表（P1-8）
 * 
 * 测试目标：
 * - getDefaultTools() 统一错误处理策略
 * - 工具加载失败时记录警告但不抛出错误
 * - 区分核心工具和可选工具
 */
import '../config/env.js'
import { logger } from '../utils/logger.js'

console.log('=== 测试工具注册表 ===\n')

// 捕获日志输出
const logs: Array<{ level: string; message: string }> = []
const originalWarn = logger.warn
const originalInfo = logger.info
const originalError = logger.error

logger.warn = (...args: unknown[]) => {
  logs.push({ level: 'warn', message: String(args[0]) })
  originalWarn.apply(logger, args)
}
logger.info = (...args: unknown[]) => {
  logs.push({ level: 'info', message: String(args[0]) })
  originalInfo.apply(logger, args)
}
logger.error = (...args: unknown[]) => {
  logs.push({ level: 'error', message: String(args[0]) })
  originalError.apply(logger, args)
}

async function testToolRegistry() {
  console.log('1. 测试工具注册表加载:')
  try {
    const { getDefaultTools } = await import('../tools/registry.js')
    const tools = await getDefaultTools()
    
    console.log(`  ✅ 加载了 ${tools.length} 个工具`)
    
    // 检查日志
    const warnLogs = logs.filter(l => l.level === 'warn')
    const infoLogs = logs.filter(l => l.level === 'info')
    
    if (warnLogs.length > 0) {
      console.log(`  ⚠️  有 ${warnLogs.length} 个警告:`)
      warnLogs.forEach(log => {
        console.log(`    - ${log.message.split('\n')[0]}`)
      })
    }
    
    console.log(`  📊 信息日志: ${infoLogs.length} 条`)
    console.log()
  } catch (error) {
    console.log('  ❌ 加载失败:', (error as Error).message, '\n')
  }

  console.log('2. 测试工具列表内容:')
  try {
    // 重新导入模块（在 ES 模块中，无需清除缓存，直接导入即可）
    const { getDefaultTools } = await import(`../tools/registry.js?t=${Date.now()}`)
    const tools = await getDefaultTools()
    
    const toolNames = tools.map((t: any) => t.name || t.constructor?.name || 'unknown')
    console.log('  工具列表:')
    toolNames.forEach((name: string, i: number) => {
      console.log(`    ${i + 1}. ${name}`)
    })
    console.log()
  } catch (error) {
    console.log('  ❌ 获取工具列表失败:', (error as Error).message, '\n')
  }

  console.log('3. 测试错误处理策略:')
  try {
    // 检查是否有错误日志（工具加载失败不应该使用 error 级别）
    const errorLogs = logs.filter(l => l.level === 'error')
    
    if (errorLogs.length === 0) {
      console.log('  ✅ 没有 error 级别日志（使用了 warn）')
    } else {
      console.log('  ⚠️  发现 error 级别日志:')
      errorLogs.forEach(log => {
        console.log(`    - ${log.message.split('\n')[0]}`)
      })
    }
    console.log()
  } catch (error) {
    console.log('  ❌ 检查失败:', (error as Error).message, '\n')
  }

  console.log('4. 测试工具类型标识:')
  try {
    const warnLogs = logs.filter(l => l.level === 'warn')
    const hasCoreToolLabel = warnLogs.some(l => l.message.includes('[Core Tool]'))
    const hasOptionalToolLabel = warnLogs.some(l => l.message.includes('[Optional Tool]'))
    
    if (hasCoreToolLabel || hasOptionalToolLabel) {
      console.log('  ✅ 工具类型标识正确:')
      if (hasCoreToolLabel) console.log('    - 发现 [Core Tool] 标识')
      if (hasOptionalToolLabel) console.log('    - 发现 [Optional Tool] 标识')
    } else if (warnLogs.length === 0) {
      console.log('  ℹ️  所有工具加载成功（无警告日志）')
    } else {
      console.log('  ⚠️  警告日志缺少工具类型标识')
    }
    console.log()
  } catch (error) {
    console.log('  ❌ 检查失败:', (error as Error).message, '\n')
  }
}

// 运行测试
testToolRegistry()
  .then(() => {
    // 恢复日志函数
    logger.warn = originalWarn
    logger.info = originalInfo
    logger.error = originalError
    
    console.log('✅ 工具注册表测试完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 测试失败:', error)
    
    // 恢复日志函数
    logger.warn = originalWarn
    logger.info = originalInfo
    logger.error = originalError
    
    process.exit(1)
  })
