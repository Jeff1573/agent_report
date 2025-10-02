/**
 * 执行步骤面板组件
 * 
 * 功能：
 * - 以可折叠面板形式展示 Agent 的执行步骤
 * - 支持思考、工具调用、工具结果、最终回答等步骤类型
 * - 使用 Steps 组件显示步骤流程，每个步骤可单独折叠
 */

import React, { useState } from 'react'
import { Collapse, Tag, Space, Typography, Steps } from 'antd'
import { 
  ThunderboltOutlined,
  LoadingOutlined,
  DownOutlined,
  RightOutlined
} from '@ant-design/icons'
import type { CollapseProps } from 'antd'

const { Text, Paragraph } = Typography

/**
 * 执行步骤类型定义
 */
interface ExecutionStep {
  id: string
  type: 'thinking' | 'tool-call' | 'tool-result' | 'answer'
  stage?: 'decision' | 'execution' | 'answer'
  content: string
  timestamp: number
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
  status?: 'running' | 'completed' | 'error'
}

interface ExecutionStepsPanelProps {
  steps: ExecutionStep[]
  defaultCollapsed?: boolean
}

/**
 * 获取步骤标题（显示工具名或步骤类型）
 */
const getStepTitle = (step: ExecutionStep): string => {
  if (step.toolName) {
    return step.toolName
  }
  
  const titleMap = {
    thinking: '思考分析',
    'tool-call': '工具调用',
    'tool-result': '执行结果',
    answer: '生成回答'
  }
  
  return titleMap[step.type] || '执行步骤'
}

/**
 * 获取步骤状态
 */
const getStepStatus = (step: ExecutionStep): 'wait' | 'process' | 'finish' | 'error' => {
  if (step.status === 'running') return 'process'
  if (step.status === 'error') return 'error'
  return 'finish'
}

/**
 * 格式化 JSON 数据（带截断）
 */
const formatJson = (data: unknown, maxLength = 500): string => {
  try {
    const jsonStr = JSON.stringify(data, null, 2)
    if (jsonStr.length > maxLength) {
      return jsonStr.slice(0, maxLength) + '\n...(已截断)'
    }
    return jsonStr
  } catch {
    return String(data)
  }
}

/**
 * 单个步骤组件（可折叠）
 */
const StepItem: React.FC<{ step: ExecutionStep; index: number }> = ({ step }) => {
  const [expanded, setExpanded] = useState(false)
  
  const hasDetails = (step.type === 'tool-call' && step.toolArgs) || 
                     (step.type === 'tool-result' && step.toolResult) ||
                     (step.type === 'thinking' && step.content)

  return (
    <div style={{ marginBottom: '12px' }}>
      {/* 步骤标题 - 可点击展开 */}
      <div 
        onClick={() => hasDetails && setExpanded(!expanded)}
        style={{ 
          cursor: hasDetails ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 0'
        }}
      >
        {hasDetails && (
          expanded ? <DownOutlined style={{ fontSize: '12px', color: '#999' }} /> 
                   : <RightOutlined style={{ fontSize: '12px', color: '#999' }} />
        )}
        <Text strong style={{ fontSize: '14px' }}>
          {getStepTitle(step)}
        </Text>
        {step.status === 'running' && <LoadingOutlined style={{ color: '#1890ff' }} />}
      </div>

      {/* 步骤详细内容（折叠） */}
      {expanded && hasDetails && (
        <div style={{ 
          marginTop: '8px', 
          marginLeft: hasDetails ? '20px' : '0',
          paddingLeft: '12px',
          borderLeft: '2px solid #e8e8e8'
        }}>
          {/* 思考内容 */}
          {step.type === 'thinking' && step.content && (
            <Paragraph style={{ marginBottom: 8, fontSize: '13px' }}>
              <Text type="secondary">{step.content}</Text>
            </Paragraph>
          )}

          {/* 工具调用参数 */}
          {step.type === 'tool-call' && step.toolArgs && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: '12px' }}>调用参数：</Text>
              <pre style={{ 
                background: '#f5f5f5', 
                padding: '8px', 
                borderRadius: '4px',
                fontSize: '12px',
                maxHeight: '200px',
                overflow: 'auto',
                margin: '4px 0 0 0'
              }}>
                {formatJson(step.toolArgs)}
              </pre>
            </div>
          )}

          {/* 工具返回结果 */}
          {step.type === 'tool-result' && step.toolResult && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: '12px' }}>返回结果：</Text>
              <pre style={{ 
                background: '#f0f9ff', 
                padding: '8px', 
                borderRadius: '4px',
                fontSize: '12px',
                maxHeight: '300px',
                overflow: 'auto',
                margin: '4px 0 0 0',
                border: '1px solid #e6f4ff'
              }}>
                {formatJson(step.toolResult, 1000)}
              </pre>
            </div>
          )}

          {/* 时间戳 */}
          <Text type="secondary" style={{ fontSize: '11px', marginTop: '8px', display: 'block' }}>
            {new Date(step.timestamp).toLocaleTimeString('zh-CN')}
          </Text>
        </div>
      )}
    </div>
  )
}

/**
 * 执行步骤面板组件
 */
export const ExecutionStepsPanel: React.FC<ExecutionStepsPanelProps> = ({ 
  steps, 
  defaultCollapsed = true 
}) => {
  if (!steps || steps.length === 0) {
    return null
  }

  // 构建 Steps 配置
  const stepItems = steps.map((step, index) => ({
    title: getStepTitle(step),
    status: getStepStatus(step),
    description: (
      <StepItem step={step} index={index} />
    )
  }))

  // 构建折叠面板项
  const items: CollapseProps['items'] = [{
    key: 'steps',
    label: (
      <Space>
        <ThunderboltOutlined style={{ color: '#1890ff' }} />
        <Text strong>思考流程</Text>
        <Tag color="blue">{steps.length} 步</Tag>
      </Space>
    ),
    children: (
      <div style={{ paddingTop: '8px' }}>
        <Steps
          direction="vertical"
          size="small"
          items={stepItems}
        />
      </div>
    )
  }]

  return (
    <div style={{ marginTop: '12px' }}>
      <Collapse 
        items={items} 
        defaultActiveKey={defaultCollapsed ? [] : ['steps']}
        size="small"
        style={{ 
          background: '#fafafa',
          border: '1px solid #e8e8e8'
        }}
      />
    </div>
  )
}

