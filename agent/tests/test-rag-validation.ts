// agent/tests/test-rag-validation.ts
/**
 * 测试 RAG 配置校验中的集合存在性判断。
 *
 * 测试目标：
 * - v2 使用默认 tenant/database 路径时，能够识别已存在集合
 * - 只有在成功拿到集合列表后，才把集合标记为不存在
 * - 集合列表不可用时，保持“无法确认”而不是误报“不存在”
 * - v2 失败时，仍可回退到 v1 兼容旧服务
 */
import { validateRagConfig, type VectorDbConfigLite } from '../services/rag.js'

type MockResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

type MockHandler = (url: string) => MockResponse

const originalFetch = globalThis.fetch

const baseConfig: VectorDbConfigLite = {
  provider: 'chroma',
  connection: { url: 'http://localhost:8000' },
  storage: {
    rootDir: '/tmp/rag-root',
    rawDir: '/tmp/rag-root/raw'
  },
  defaultCollection: 'mindforge_kb'
}

/**
 * 构造最小 fetch 响应，避免测试依赖真实 Chroma 服务。
 *
 * @param status - HTTP 状态码
 * @param body - JSON 响应体
 * @returns 可供 validateRagConfig 使用的响应对象
 */
function createResponse(status: number, body: unknown): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

/**
 * 在单个用例期间替换全局 fetch，确保每个场景彼此隔离。
 *
 * @param handler - 根据请求 URL 返回指定响应的处理器
 * @param run - 当前测试场景
 */
async function withMockedFetch(handler: MockHandler, run: () => Promise<void>): Promise<void> {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    return handler(url) as Response
  }) as typeof fetch

  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

/**
 * 断言布尔条件，失败时直接中止脚本，便于在命令行中定位回归。
 *
 * @param condition - 期望结果
 * @param message - 失败时输出的信息
 */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function testV2CollectionExists(): Promise<void> {
  console.log('1. 测试 v2 正确接口识别已存在集合:')
  const requestedUrls: string[] = []

  await withMockedFetch(
    (url) => {
      requestedUrls.push(url)
      if (url.endsWith('/api/v2/heartbeat')) return createResponse(200, { ok: true })
      if (
        url.endsWith(
          '/api/v2/tenants/default_tenant/databases/default_database/collections'
        )
      ) {
        return createResponse(200, [{ name: 'mindforge_kb' }])
      }
      return createResponse(404, {})
    },
    async () => {
      const result = await validateRagConfig(baseConfig)
      assert(result.ok, 'v2 已存在集合场景应通过基础校验')
      assert(
        result.info?.defaultCollectionExists === true,
        'v2 已存在集合场景应返回 true'
      )
      assert(
        requestedUrls.some((url) =>
          url.endsWith('/api/v2/tenants/default_tenant/databases/default_database/collections')
        ),
        '应请求 Chroma v2 的默认 tenant/database 集合接口'
      )
      console.log('  ✅ 识别成功\n')
    }
  )
}

async function testConfirmedMissingCollection(): Promise<void> {
  console.log('2. 测试成功获取列表但目标集合不存在:')

  await withMockedFetch(
    (url) => {
      if (url.endsWith('/api/v2/heartbeat')) return createResponse(200, { ok: true })
      if (
        url.endsWith(
          '/api/v2/tenants/default_tenant/databases/default_database/collections'
        )
      ) {
        return createResponse(200, [{ name: 'other_kb' }])
      }
      return createResponse(404, {})
    },
    async () => {
      const result = await validateRagConfig(baseConfig)
      assert(
        result.info?.defaultCollectionExists === false,
        '确认缺失集合时应返回 false'
      )
      assert(
        result.warnings?.includes('默认集合不存在：mindforge_kb') === true,
        '确认缺失集合时应给出明确警告'
      )
      console.log('  ✅ 缺失判断正确\n')
    }
  )
}

async function testUnknownCollectionState(): Promise<void> {
  console.log('3. 测试集合列表不可用时保持未知状态:')

  await withMockedFetch(
    (url) => {
      if (url.endsWith('/api/v2/heartbeat')) return createResponse(200, { ok: true })
      return createResponse(503, {})
    },
    async () => {
      const result = await validateRagConfig(baseConfig)
      assert(
        result.info?.defaultCollectionExists === undefined,
        '集合列表不可用时应保持 undefined'
      )
      assert(
        result.warnings?.some((warning) => warning.includes('无法获取集合列表')) === true,
        '集合列表不可用时应提示无法确认'
      )
      console.log('  ✅ 未知状态处理正确\n')
    }
  )
}

async function testFallbackToV1(): Promise<void> {
  console.log('4. 测试 v2 失败后回退 v1:')
  const requestedUrls: string[] = []

  await withMockedFetch(
    (url) => {
      requestedUrls.push(url)
      if (url.endsWith('/api/v2/heartbeat')) return createResponse(503, {})
      if (url.endsWith('/api/v1/heartbeat')) return createResponse(200, { ok: true })
      if (
        url.endsWith(
          '/api/v2/tenants/default_tenant/databases/default_database/collections'
        )
      ) {
        return createResponse(404, {})
      }
      if (url.endsWith('/api/v1/collections')) {
        return createResponse(200, [{ name: 'mindforge_kb' }])
      }
      return createResponse(404, {})
    },
    async () => {
      const result = await validateRagConfig(baseConfig)
      assert(result.info?.defaultCollectionExists === true, 'v1 回退后应识别集合存在')
      assert(
        requestedUrls.some((url) => url.endsWith('/api/v1/collections')),
        'v2 集合接口失败后应继续请求 v1 集合接口'
      )
      console.log('  ✅ v1 回退正常\n')
    }
  )
}

async function main(): Promise<void> {
  console.log('=== 测试 RAG 集合校验 ===\n')
  try {
    await testV2CollectionExists()
    await testConfirmedMissingCollection()
    await testUnknownCollectionState()
    await testFallbackToV1()
    console.log('✅ RAG 集合校验测试完成')
  } finally {
    globalThis.fetch = originalFetch
  }
}

main().catch((error) => {
  console.error('❌ 测试失败:', (error as Error).message)
  process.exit(1)
})
