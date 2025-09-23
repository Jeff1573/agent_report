/**
 * 文档：结构化输出临时示例（仅开发阶段使用）
 * 说明：演示如何使用 makeStructuredChatModel 以 Zod Schema 获取强类型结果。
 * 约束：运行前请配置 OPENAI 相关环境变量；合并前将按流程删除此示例脚本。
 */
import { z } from 'zod'
import { makeStructuredChatModel } from '../llm/factory.js'

// 1) 定义输出结构（仅可 JSON 表达类型；可空字段请用 z.nullable）
const MetaSchema = z
  .object({
    title: z.string().describe('中文标题，简洁有力'),
    tags: z.array(z.string()).min(1).max(5).describe('相关短标签（1~5 个）')
  })
  .describe('文章元数据')

// 2) 定义“不同输出内容”的判别式联合（强烈推荐）
const Decision = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('answer'),
    answer: z.string().describe('最终给用户的自然语言回答'),
    sources: z.array(z.string()).optional()
  }),
  z.object({
    type: z.literal('clarify'),
    question: z.string().describe('需要向用户澄清的问题')
  }),
  z.object({
    type: z.literal('cannot_answer'),
    reason: z.string(),
    suggestions: z.array(z.string()).optional()
  })
])

type Decision = z.infer<typeof Decision>

async function main() {
  // 2) 获取绑定结构化输出的模型（默认 strict: true）
  const runnable = makeStructuredChatModel(Decision, {
    name: 'AgentDecision',
    method: 'json_mode',
    includeRaw: true,   
  })

  // 3) 正常以消息体调用；返回值已按 Zod 校验并具备类型
  const res = await runnable.invoke([
    { role: 'system', content: '你是资深内容编辑，仅输出 JSON 结构' },
    {
      role: 'user',
      content: '今天的日期是？'
    }
  ])

  // 4) 开发打印（生产中请按需处理）
  console.log('结构化结果:', res)


  // 非结构化
  const res2 = await runnable.invoke([
    { role: 'system', content: '你是资深内容编辑，仅输出 JSON 结构' },
    {
      role: 'user',
      content: '今天的日期是？'
    }
  ])  
  console.log('非结构化结果:', res2)
}

main().catch((err) => {
  console.error('示例运行失败:', err)
  process.exitCode = 1
})
