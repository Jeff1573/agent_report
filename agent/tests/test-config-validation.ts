// agent/tests/test-config-validation.ts
/**
 * 测试配置验证功能（P1-7）
 * 
 * 测试目标：
 * - validateConfig() 函数正确检测缺失的环境变量
 * - 配置摘要功能正常工作
 */

console.log('=== 测试配置验证功能 ===\n')

// 保存原始环境变量
const originalEnv = { ...process.env }

async function testConfigValidation() {
  // 动态导入以便在每次测试前重新加载
  const { validateConfig, getConfigSummary } = await import('../config/env.js')

  console.log('1. 测试完整配置（应该通过）:')
  try {
    validateConfig()
    console.log('  ✅ 配置验证通过\n')
  } catch (error) {
    console.log('  ❌ 配置验证失败:', (error as Error).message, '\n')
  }

  console.log('2. 测试配置摘要:')
  const summary = getConfigSummary()
  console.log(summary)
  console.log()

  console.log('3. 测试缺失 OPENAI_API_KEY:')
  const saved = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    // 重新导入模块以应用新的环境变量（使用查询参数绕过缓存）
    const { validateConfig: validateConfig2 } = await import(`../config/env.js?t=${Date.now()}`)
    validateConfig2()
    console.log('  ❌ 应该抛出错误但没有\n')
  } catch (error) {
    const errorMsg = (error as Error).message
    if (errorMsg.includes('OPENAI_API_KEY')) {
      console.log('  ✅ 正确检测到缺失 OPENAI_API_KEY\n')
    } else {
      console.log('  ⚠️ 错误消息不正确:', errorMsg, '\n')
    }
  } finally {
    // 恢复环境变量
    if (saved) process.env.OPENAI_API_KEY = saved
  }

  console.log('4. 测试缺失 CHROMA_URL:')
  const savedChroma = process.env.CHROMA_URL
  delete process.env.CHROMA_URL
  try {
    const { validateConfig: validateConfig3 } = await import(`../config/env.js?t=${Date.now()}`)
    validateConfig3()
    console.log('  ❌ 应该抛出错误但没有\n')
  } catch (error) {
    const errorMsg = (error as Error).message
    if (errorMsg.includes('CHROMA_URL')) {
      console.log('  ✅ 正确检测到缺失 CHROMA_URL\n')
    } else {
      console.log('  ⚠️ 错误消息不正确:', errorMsg, '\n')
    }
  } finally {
    // 恢复环境变量
    if (savedChroma) process.env.CHROMA_URL = savedChroma
  }
}

// 运行测试
testConfigValidation()
  .then(() => {
    // 恢复所有环境变量
    process.env = { ...originalEnv }
    console.log('✅ 配置验证测试完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 测试失败:', error)
    process.env = { ...originalEnv }
    process.exit(1)
  })
