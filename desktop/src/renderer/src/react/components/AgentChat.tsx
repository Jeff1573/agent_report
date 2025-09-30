/**
 * Agent 聊天界面组件
 * 
 * 功能：
 * - 流式消息展示
 * - 工具调用过程可视化
 * - 会话历史管理
 */

import React, { useState, useRef, useEffect } from 'react'
import { Input, Button, Card, Space, Typography, Tag, Spin, message as antMessage } from 'antd'
import { SendOutlined, StopOutlined, RobotOutlined, UserOutlined, ToolOutlined } from '@ant-design/icons'
import type { AgentStreamEvent } from '../../../../shared/ipc'

const { TextArea } = Input
const { Text, Paragraph } = Typography

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: Array<{ name: string; args: unknown }>
}

export const AgentChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentContent, setCurrentContent] = useState('')
  const [currentToolCalls, setCurrentToolCalls] = useState<Array<{ name: string; args: unknown }>>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentContent])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    console.log('[AgentChat] 发送消息:', input)

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    }

    setMessages(prev => [...prev, userMessage])
    const messageToSend = input
    setInput('')
    setIsLoading(true)
    setCurrentContent('')
    setCurrentToolCalls([])

    try {
      console.log('[AgentChat] 调用 chatStream API...')
      await window.api.agent.chatStream(
        messageToSend,
        (event: AgentStreamEvent) => {
          console.log('[AgentChat] 收到事件:', event)
          handleStreamEvent(event)
        },
        { 
          summary: false,
          threadId: 'default-thread'
        }
      )
      console.log('[AgentChat] chatStream 完成，currentContent:', currentContent)
    } catch (error) {
      console.error('[AgentChat] 错误:', error)
      antMessage.error(`发送失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      console.log('[AgentChat] 清理状态')
      setIsLoading(false)
      // 注意：不在这里清空 currentContent，让它保持直到下次发送
      // setCurrentContent('')
      // setCurrentToolCalls([])
    }
  }

  const handleStreamEvent = (event: AgentStreamEvent) => {
    console.log('[AgentChat] 处理事件:', event.type, event)
    switch (event.type) {
      case 'model-token':
        if (event.token) {
          console.log('[AgentChat] token:', event.token)
          setCurrentContent(prev => prev + event.token)
        }
        break

      case 'assistant-message':
        if (event.content) {
          console.log('[AgentChat] assistant-message:', event.content)
          setCurrentContent(event.content)
        }
        break

      case 'tool-call':
        if (event.name) {
          console.log('[AgentChat] tool-call:', event.name)
          setCurrentToolCalls(prev => [...prev, { name: event.name!, args: event.args }])
        }
        break

      case 'tool-result':
        console.log('[AgentChat] tool-result:', event.name, event.output)
        break

      case 'round-end':
        console.log('[AgentChat] round-end，保存消息到历史')
        // 在 round-end 时保存助手消息到历史
        setCurrentContent(prevContent => {
          if (prevContent) {
            console.log('[AgentChat] 保存助手消息:', prevContent)
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: prevContent,
              timestamp: Date.now(),
              toolCalls: currentToolCalls.length > 0 ? [...currentToolCalls] : undefined
            }])
          }
          return '' // 清空当前内容
        })
        setCurrentToolCalls([]) // 清空工具调用
        break

      case 'error':
        console.error('[AgentChat] error:', event.error)
        antMessage.error(`错误: ${event.error}`)
        break
    }
  }

  const handleStop = async () => {
    try {
      await window.api.agent.stop()
      setIsLoading(false)
      antMessage.info('已停止对话')
    } catch (error) {
      console.error('Stop error:', error)
    }
  }

  const renderMessage = (msg: Message) => {
    const isUser = msg.role === 'user'
    
    return (
      <div
        key={msg.id}
        style={{
          display: 'flex',
          justifyContent: isUser ? 'flex-end' : 'flex-start',
          marginBottom: 16
        }}
      >
        <Card
          style={{
            maxWidth: '70%',
            backgroundColor: isUser ? '#e6f7ff' : '#f5f5f5',
            borderRadius: 8
          }}
          bodyStyle={{ padding: 12 }}
        >
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space>
              {isUser ? <UserOutlined /> : <RobotOutlined />}
              <Text strong>{isUser ? '你' : 'MindForge'}</Text>
            </Space>
            
            <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {msg.content}
            </Paragraph>

            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <Space wrap style={{ marginTop: 8 }}>
                {msg.toolCalls.map((call, idx) => (
                  <Tag key={idx} icon={<ToolOutlined />} color="blue">
                    {call.name}
                  </Tag>
                ))}
              </Space>
            )}
          </Space>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', padding: 24 }}>
      <Card
        title={
          <Space>
            <RobotOutlined />
            <span>MindForge Agent 聊天</span>
          </Space>
        }
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        {/* 消息列表 */}
        <div style={{ flex: 1, overflow: 'auto', marginBottom: 16 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: 48, color: '#999' }}>
              <RobotOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <p>开始与 MindForge Agent 对话</p>
              <p style={{ fontSize: 12 }}>
                Agent 具备知识库检索、网络搜索、MCP工具调用等能力
              </p>
            </div>
          )}

          {messages.map(renderMessage)}

          {/* 当前流式内容 */}
          {isLoading && currentContent && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
              <Card
                style={{
                  maxWidth: '70%',
                  backgroundColor: '#f5f5f5',
                  borderRadius: 8
                }}
                bodyStyle={{ padding: 12 }}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    <RobotOutlined />
                    <Text strong>MindForge</Text>
                    <Spin size="small" />
                  </Space>
                  
                  <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {currentContent}
                  </Paragraph>

                  {currentToolCalls.length > 0 && (
                    <Space wrap style={{ marginTop: 8 }}>
                      {currentToolCalls.map((call, idx) => (
                        <Tag key={idx} icon={<ToolOutlined />} color="processing">
                          {call.name}
                        </Tag>
                      ))}
                    </Space>
                  )}
                </Space>
              </Card>
            </div>
          )}

          {/* 纯加载状态（还没有内容时） */}
          {isLoading && !currentContent && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Spin tip="思考中..." />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <Space.Compact style={{ width: '100%' }}>
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="输入消息... (Shift+Enter 换行)"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={isLoading}
            style={{ flex: 1 }}
          />
          {isLoading ? (
            <Button
              type="primary"
              danger
              icon={<StopOutlined />}
              onClick={handleStop}
            >
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              disabled={!input.trim()}
            >
              发送
            </Button>
          )}
        </Space.Compact>
      </Card>
    </div>
  )
}
