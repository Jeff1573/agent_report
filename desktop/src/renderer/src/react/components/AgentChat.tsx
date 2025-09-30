/**
 * Agent 聊天界面组件
 * 
 * 功能：
 * - 流式消息展示
 * - 工具调用过程可视化
 * - 会话历史管理
 */

import React, { useState, useRef, useEffect } from 'react'
import { Input, Button, Card, Space, Typography, Tag, Spin, message as antMessage, Tooltip, Modal } from 'antd'
import { SendOutlined, StopOutlined, RobotOutlined, UserOutlined, ToolOutlined, PlusOutlined, DeleteOutlined, HistoryOutlined } from '@ant-design/icons'
import type { AgentStreamEvent, SessionData } from '../../../../shared/ipc'
import { MarkdownMessage } from './MarkdownMessage'
import { HistorySidebar } from './HistorySidebar'
import '../../assets/chat-animations.css'

const { TextArea } = Input
const { Text, Paragraph } = Typography

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: Array<{ name: string; args: unknown }>
}

// 生成会话标题（从第一条用户消息截取）
function generateSessionTitle(messages: Message[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user')
  if (!firstUserMessage) return '新对话'
  
  const content = firstUserMessage.content.trim()
  if (content.length <= 30) return content
  return content.slice(0, 30) + '...'
}

export const AgentChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentContent, setCurrentContent] = useState('')
  const [currentToolCalls, setCurrentToolCalls] = useState<Array<{ name: string; args: unknown }>>([])
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}`)
  const [historyVisible, setHistoryVisible] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentContent])

  // 应用启动时加载最近的会话
  useEffect(() => {
    const loadLastSession = async () => {
      try {
        const sessions = await window.api.history.list()
        if (sessions.length > 0) {
          const lastSession = sessions[0] // 最近的会话
          setMessages(lastSession.messages)
          console.log('[AgentChat] 已加载会话:', lastSession.title)
        }
      } catch (error) {
        console.error('[AgentChat] 加载会话失败:', error)
      }
    }
    loadLastSession()
  }, [])

  // 消息变化时自动保存
  useEffect(() => {
    if (messages.length === 0) return

    const saveSession = async () => {
      try {
        const session: SessionData = {
          id: sessionId,
          title: generateSessionTitle(messages),
          messages,
          createdAt: messages[0]?.timestamp || Date.now(),
          updatedAt: Date.now()
        }
        await window.api.history.save(session)
        console.log('[AgentChat] 会话已自动保存')
      } catch (error) {
        console.error('[AgentChat] 保存会话失败:', error)
      }
    }

    // 防抖：延迟 1 秒保存，避免频繁写入
    const timer = setTimeout(saveSession, 1000)
    return () => clearTimeout(timer)
  }, [messages, sessionId])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

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
      await window.api.agent.chatStream(
        messageToSend,
        (event: AgentStreamEvent) => {
          handleStreamEvent(event)
        },
        { 
          summary: false,
          threadId: 'default-thread'
        }
      )
    } catch (error) {
      console.error('Chat error:', error)
      antMessage.error(`发送失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleStreamEvent = (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'model-token':
        if (event.token) {
          setCurrentContent(prev => prev + event.token)
        }
        break

      case 'assistant-message':
        if (event.content) {
          setCurrentContent(event.content)
        }
        break

      case 'tool-call':
        if (event.name) {
          setCurrentToolCalls(prev => [...prev, { name: event.name!, args: event.args }])
        }
        break

      case 'tool-result':
        // 工具结果已收到，可以在这里添加额外处理
        break

      case 'round-end':
        // 在 round-end 时保存助手消息到历史
        setCurrentContent(prevContent => {
          if (prevContent) {
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
        console.error('Stream error:', event.error)
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

  const handleNewChat = () => {
    Modal.confirm({
      title: '开始新对话',
      content: '当前对话将被保存，是否开始新对话？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        // 清空当前状态
        setMessages([])
        setInput('')
        setCurrentContent('')
        setCurrentToolCalls([])
        // 生成新的 sessionId
        setSessionId(`session-${Date.now()}`)
        antMessage.success('已开始新对话')
      }
    })
  }

  const handleClearChat = () => {
    Modal.confirm({
      title: '清空对话',
      content: '确定要清空当前对话吗？此操作不可恢复。',
      okText: '确定',
      cancelText: '取消',
      okType: 'danger',
      onOk: () => {
        setMessages([])
        setInput('')
        setCurrentContent('')
        setCurrentToolCalls([])
        antMessage.success('对话已清空')
      }
    })
  }

  const handleLoadSession = (session: SessionData) => {
    setMessages(session.messages)
    setSessionId(session.id)
    setInput('')
    setCurrentContent('')
    setCurrentToolCalls([])
  }

  const renderMessage = (msg: Message) => {
    const isUser = msg.role === 'user'
    
    return (
      <div
        key={msg.id}
        style={{
          display: 'flex',
          justifyContent: isUser ? 'flex-end' : 'flex-start',
          marginBottom: 12,
          padding: '0 4px'
        }}
      >
        <div
          style={{
            maxWidth: '80%',
            minWidth: '100px',
            background: isUser 
              ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
              : '#ffffff',
            borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            padding: '10px 14px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            color: isUser ? '#ffffff' : '#000000',
            border: isUser ? 'none' : '1px solid #e8e8e8'
          }}
        >
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {/* 头部信息 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85, marginBottom: 4 }}>
              {isUser ? (
                <UserOutlined style={{ fontSize: 12, color: '#ffffff' }} />
              ) : (
                <RobotOutlined style={{ fontSize: 12, color: '#667eea' }} />
              )}
              <Text 
                strong 
                style={{ 
                  fontSize: 12,
                  color: isUser ? '#ffffff' : '#667eea'
                }}
              >
                {isUser ? '你' : 'MindForge'}
              </Text>
              <Text 
                style={{ 
                  fontSize: 10, 
                  opacity: 0.6,
                  color: isUser ? '#ffffff' : '#999999',
                  marginLeft: 'auto'
                }}
              >
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </Text>
            </div>
            
            {/* 消息内容 */}
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              {isUser ? (
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {msg.content}
                </div>
              ) : (
                <div style={{ color: '#000000' }}>
                  <MarkdownMessage content={msg.content} />
                </div>
              )}
            </div>

            {/* 工具调用标签 */}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <Space wrap size={[4, 4]}>
                  {msg.toolCalls.map((call, idx) => (
                    <Tag 
                      key={idx} 
                      icon={<ToolOutlined />} 
                      color="blue"
                      style={{ 
                        margin: 0,
                        fontSize: 10,
                        padding: '0 6px',
                        borderRadius: 8,
                        lineHeight: '18px'
                      }}
                    >
                      {call.name}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          </Space>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* 历史对话侧边栏 */}
      <HistorySidebar
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        currentSessionId={sessionId}
        onLoadSession={handleLoadSession}
      />

      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        flexDirection: 'column', 
        padding: '16px',
        background: '#f0f2f5'
      }}>
        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <RobotOutlined style={{ fontSize: 20, color: '#667eea' }} />
                <span style={{ fontSize: 16, fontWeight: 'bold' }}>MindForge Agent</span>
              </Space>
              <Space>
                <Tooltip title="历史对话">
                  <Button 
                    icon={<HistoryOutlined />} 
                    onClick={() => setHistoryVisible(true)}
                    type="text"
                    size="small"
                  />
                </Tooltip>
                <Tooltip title="新建对话">
                  <Button 
                    icon={<PlusOutlined />} 
                    onClick={handleNewChat}
                    type="text"
                    size="small"
                  />
                </Tooltip>
                <Tooltip title="清空对话">
                  <Button 
                    icon={<DeleteOutlined />} 
                    onClick={handleClearChat}
                    type="text"
                    danger
                    disabled={messages.length === 0}
                    size="small"
                  />
                </Tooltip>
              </Space>
            </div>
          }
        style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}
        bodyStyle={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          padding: '16px',
          overflow: 'hidden'
        }}
      >
        {/* 消息列表容器 - 关键：这里需要正确设置滚动 */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto',
          overflowX: 'hidden',
          marginBottom: 16,
          paddingRight: 4
        }}>
          {messages.length === 0 && !isLoading && (
            <div style={{ 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999',
              padding: '20px'
            }}>
              <RobotOutlined style={{ fontSize: 64, marginBottom: 24, color: '#667eea' }} />
              <h3 style={{ margin: '0 0 12px 0', color: '#333' }}>欢迎使用 MindForge Agent</h3>
              <p style={{ margin: '0 0 8px 0', fontSize: 14, textAlign: 'center' }}>
                智能助手，随时为您服务
              </p>
              <p style={{ margin: 0, fontSize: 12, color: '#999', textAlign: 'center' }}>
                💡 知识库检索 · 🌐 网络搜索 · 🔧 MCP 工具调用
              </p>
            </div>
          )}

          {messages.map(renderMessage)}

          {/* 当前流式内容 */}
          {isLoading && currentContent && (
            <div 
              style={{ 
                display: 'flex', 
                justifyContent: 'flex-start', 
                marginBottom: 12,
                padding: '0 4px'
              }}
            >
              <div
                style={{
                  maxWidth: '80%',
                  minWidth: '100px',
                  background: '#ffffff',
                  borderRadius: '16px 16px 16px 4px',
                  padding: '10px 14px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                  border: '1px solid #e8e8e8',
                  animation: 'fadeIn 0.3s ease-in'
                }}
              >
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {/* 头部信息 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85, marginBottom: 4 }}>
                    <RobotOutlined style={{ fontSize: 12, color: '#667eea' }} />
                    <Text strong style={{ fontSize: 12, color: '#667eea' }}>
                      MindForge
                    </Text>
                    <Spin size="small" style={{ marginLeft: 4 }} />
                    <span style={{ 
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      background: '#52c41a',
                      borderRadius: '50%',
                      marginLeft: 4,
                      animation: 'pulse 1.5s ease-in-out infinite'
                    }} />
                  </div>
                  
                  {/* 流式内容也使用 Markdown 渲染 */}
                  <div style={{ fontSize: 14, lineHeight: 1.5, color: '#000000' }}>
                    <MarkdownMessage content={currentContent} />
                  </div>

                  {/* 工具调用标签 */}
                  {currentToolCalls.length > 0 && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                      <Space wrap size={[4, 4]}>
                        {currentToolCalls.map((call, idx) => (
                          <Tag 
                            key={idx} 
                            icon={<ToolOutlined />} 
                            color="processing"
                            style={{ 
                              margin: 0,
                              fontSize: 10,
                              padding: '0 6px',
                              borderRadius: 8,
                              lineHeight: '18px'
                            }}
                          >
                            {call.name}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                  )}
                </Space>
              </div>
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

        {/* 输入区域 - 固定在底部，不参与滚动 */}
        <div style={{ 
          background: '#ffffff', 
          padding: '12px', 
          borderRadius: '8px',
          border: '1px solid #e8e8e8',
          flexShrink: 0
        }}>
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
              className="chat-input-focus"
              style={{ 
                flex: 1,
                borderRadius: '6px 0 0 6px',
                fontSize: 14,
                padding: '8px 12px',
                border: '1px solid #d9d9d9'
              }}
            />
            {isLoading ? (
              <Button
                type="primary"
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
                className="chat-button"
                style={{ 
                  borderRadius: '0 6px 6px 0',
                  height: 'auto',
                  minHeight: '36px',
                  padding: '0 16px'
                }}
              >
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!input.trim()}
                className="chat-button"
                style={{ 
                  borderRadius: '0 6px 6px 0',
                  height: 'auto',
                  minHeight: '36px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  border: 'none',
                  padding: '0 16px'
                }}
              >
                发送
              </Button>
            )}
          </Space.Compact>
        </div>
      </Card>
    </div>
    </>
  )
}
