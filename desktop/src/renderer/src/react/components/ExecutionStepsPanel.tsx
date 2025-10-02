/**
 * 执行步骤面板组件
 * 
 * 功能：
 * - 以可折叠面板形式展示 Agent 的执行步骤
 * - 支持思考、工具调用、工具结果、最终回答等步骤类型
 * - 提供清晰的视觉层次和交互体验
 */

import React from 'react'
import { Collapse, Tag, Space, Typography } from 'antd'
import { 
  ThunderboltOutlined, 
  ToolOutlined, 
  CheckCircleOutlined, 
  MessageOutlined,
  BulbOutlined,
  LoadingOutlined
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
 * 获取步骤图标
 */
const getStepIcon = (step: ExecutionStep): React.ReactNode => {
  if (step.status === 'running') {
    return <LoadingOutlined style={{ color: '#1890ff' }} />
  }

  switch (step.type) {
    case 'thinking':
      return <BulbOutlined style={{ color: '#faad14' }} />
    case 'tool-call':
      return <ToolOutlined style={{ color: '#1890ff' }} />
    case 'tool-result':
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />
    case 'answer':
      return <MessageOutlined style={{ color: '#722ed1' }} />
    default:
      return <ThunderboltOutlined />
  }
}

/**
 * 获取步骤类型标签
 */
const getStepTypeTag = (step: ExecutionStep): React.ReactNode => {
  const typeMap = {
    thinking: { text: '思考', color: 'gold' },
    'tool-call': { text: '工具调用', color: 'blue' },
    'tool-result': { text: '工具结果', color: 'green' },
    answer: { text: '生成回答', color: 'purple' }
  }

  const config = typeMap[step.type]
  return <Tag color={config.color}>{config.text}</Tag>
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
 * 渲染步骤内容
 */
const renderStepContent = (step: ExecutionStep): React.ReactNode => {
  return (
    <div style={{ padding: '8px 0' }}>
      {/* 基础内容 */}
      <Paragraph style={{ marginBottom: 8 }}>
        <Text>{step.content}</Text>
      </Paragraph>

      {/* 工具调用参数 */}
      {step.type === 'tool-call' && step.toolArgs && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: '12px' }}>参数：</Text>
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
      <div style={{ paddingLeft: '8px' }}>
        {steps.map((step, index) => (
          <div 
            key={step.id} 
            style={{ 
              marginBottom: index < steps.length - 1 ? '16px' : '0',
              paddingBottom: index < steps.length - 1 ? '16px' : '0',
              borderBottom: index < steps.length - 1 ? '1px dashed #e8e8e8' : 'none'
            }}
          >
            {/* 步骤头部 */}
            <Space style={{ marginBottom: '8px' }}>
              <Tag color="default" style={{ fontSize: '11px' }}>步骤 {index + 1}</Tag>
              {getStepIcon(step)}
              {getStepTypeTag(step)}
              {step.toolName && (
                <Tag color="cyan" style={{ fontSize: '11px' }}>{step.toolName}</Tag>
              )}
            </Space>

            {/* 步骤内容 */}
            {renderStepContent(step)}
          </div>
        ))}
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

