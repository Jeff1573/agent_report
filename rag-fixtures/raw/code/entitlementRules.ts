/**
 * RAG 权益规则样本。
 *
 * 该文件用于测试代码文件入库后，系统能否检索到函数职责、边界条件和固定业务常量。
 */

export type PlanCode = 'trial' | 'team' | 'enterprise'

export interface EntitlementInput {
  planCode: PlanCode
  activeUsers: number
  importedCollections: number
}

export interface EntitlementResult {
  canImport: boolean
  maxCollections: number
  reviewRequired: boolean
  reason: string
}

const PLAN_LIMITS: Record<PlanCode, number> = {
  trial: 2,
  team: 12,
  enterprise: 120
}

/**
 * 计算租户是否允许继续导入知识库集合。
 *
 * 业务规则：
 * - trial 最多 2 个集合。
 * - team 最多 12 个集合。
 * - enterprise 最多 120 个集合。
 * - enterprise 超过 80 个集合时仍允许导入，但需要人工复核。
 *
 * @param input 租户当前套餐与使用量。
 * @returns 权益判断结果。
 */
export function evaluateCollectionEntitlement(input: EntitlementInput): EntitlementResult {
  const maxCollections = PLAN_LIMITS[input.planCode]
  const canImport = input.importedCollections < maxCollections

  // enterprise 高水位导入可能影响检索性能，因此保留人工复核口径。
  const reviewRequired = input.planCode === 'enterprise' && input.importedCollections >= 80

  if (!canImport) {
    return {
      canImport: false,
      maxCollections,
      reviewRequired,
      reason: `当前套餐 ${input.planCode} 已达到集合数量上限`
    }
  }

  return {
    canImport: true,
    maxCollections,
    reviewRequired,
    reason: reviewRequired ? '允许导入，但需要人工复核' : '允许导入'
  }
}

/**
 * 返回 RAG 测试用固定代码哨兵值。
 *
 * @returns 固定哨兵值，用于验证代码检索是否命中。
 */
export function getCodeSentinel(): string {
  return 'RAG_SENTINEL_CODE_SIGMA'
}
