/**
 * Agent 聊天界面组件
 * 
 * 功能：
 * - 流式消息展示
 * - 工具调用过程可视化
 * - 会话历史管理
 */

import React, { useState, useRef, useEffect, JSX } from 'react'
import { Input, Button, Card, Space, Typography, Tag, Spin, message as antMessage, Tooltip, Modal, Select } from 'antd'
import { SendOutlined, StopOutlined, RobotOutlined, UserOutlined, ToolOutlined, PlusOutlined, DeleteOutlined, HistoryOutlined, SettingOutlined } from '@ant-design/icons'
import type { AgentStreamEvent, SessionData } from '../../../../shared/ipc'
import { MarkdownMessage } from './MarkdownMessage'
import { HistorySidebar } from './HistorySidebar'
import '../../assets/chat-animations.css'
import { useNavigate } from 'react-router-dom'
import type { ModelConfig } from '../../../../shared/ipc'

const { TextArea } = Input
const { Text } = Typography

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
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentContent, setCurrentContent] = useState('')
  const [currentToolCalls, setCurrentToolCalls] = useState<Array<{ name: string; args: unknown }>>([])
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}`)
  const [historyVisible, setHistoryVisible] = useState(false)
  const [modelList, setModelList] = useState<ModelConfig[]>([])
  const [activeModelId, setActiveModelId] = useState<string | undefined>(undefined)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentContent])

  // 应用启动时加载最近的会话
  useEffect(() => {
    const loadLastSession: () => Promise<void> = async () => {
      try {
        const sessions = await window.api.history.list()
        if (sessions.length > 0) {
          const lastSession = sessions[0] // 最近的会话
          setMessages(lastSession.messages)
          setSessionId(lastSession.id)
          console.log('[AgentChat] 已加载会话:', lastSession.title)
        }
      } catch (error) {
        console.error('[AgentChat] 加载会话失败:', error)
      }
    }
    const loadModels: () => Promise<void> = async () => {
      try {
        const list = await window.api.settings.modelList()
        const active = await window.api.settings.getActiveModel()
        setModelList(list)
        setActiveModelId(active?.id)
      } catch (err) {
        console.warn('加载模型配置失败', err)
      }
    }
    loadLastSession()
    loadModels()
  }, [])

  // 消息变化时自动保存
  useEffect(() => {
    if (messages.length === 0) return

    const saveSession: () => Promise<void> = async () => {
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

  const handleSend: () => Promise<void> = async () => {
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
          threadId: 'default-thread',
          modelConfigId: activeModelId
        }
      )
    } catch (error) {
      console.error('Chat error:', error)
      antMessage.error(`发送失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleStreamEvent = (evt: AgentStreamEvent): void => {
    switch (evt.type) {
      case 'model-token':
        if (evt.token) {
          setCurrentContent(prev => prev + evt.token)
        }
        break

      case 'assistant-message':
        if (evt.content) {
          setCurrentContent(evt.content)
        }
        break

      case 'tool-call':
        if (evt.name) {
          setCurrentToolCalls(prev => [...prev, { name: evt.name!, args: evt.args }])
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
        console.error('Stream error:', evt.error)
        antMessage.error(`错误: ${String(evt.error)}`)
        break
    }
  }

  const handleStop: () => Promise<void> = async () => {
    try {
      await window.api.agent.stop()
      setIsLoading(false)
      antMessage.info('已停止对话')
    } catch (error) {
      console.error('Stop error:', error)
    }
  }

  const handleNewChat: () => void = () => {
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

  const handleClearChat: () => void = () => {
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

  const handleLoadSession = (data: SessionData): void => {
    setMessages(data.messages)
    setSessionId(data.id)
    setInput('')
    setCurrentContent('')
    setCurrentToolCalls([])
  }

  const renderMessage = (msg: Message): JSX.Element => {
    const isUser = msg.role === 'user'

    return (
      <div key={msg.id} className={`message-wrapper ${isUser ? 'user' : 'assistant'}`}>
        <div
          className={`message-bubble ${isUser ? 'user' : 'assistant'}`}
        >
          <div className="message-header">
            <div className={`message-avatar ${isUser ? 'user' : 'assistant'}`}>
              {isUser ? <UserOutlined /> : <RobotOutlined />}
            </div>
            <Text className={`message-sender ${isUser ? 'user' : 'assistant'}`}>
              {isUser ? '你' : 'MindForge'}
            </Text>
            <Text className={`message-timestamp ${isUser ? 'user' : 'assistant'}`}>
              {new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </Text>
          </div>

          <div className={`message-content ${isUser ? 'user' : 'assistant'}`}>
            {isUser ? (
              <div>{msg.content}</div>
            ) : (
              <MarkdownMessage content={msg.content} />
            )}
          </div>

          {/* 工具调用标签 */}
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <div className="tool-calls-container">
              <Space wrap size={[4, 4]}>
                {msg.toolCalls.map((call, idx) => (
                  <Tag
                    key={idx}
                    icon={<ToolOutlined />}
                    color="blue"
                    className="tool-tag"
                  >
                    {call.name}
                  </Tag>
                ))}
              </Space>
            </div>
          )}
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

      <div className="chat-container">
        <Card
          title={
            <div className="card-title">
              <div className="card-title-left">
                <RobotOutlined className="card-title-icon" />
                <span className="card-title-text">MindForge Agent</span>
              </div>
              <div className="card-title-actions">
                <Select
                  size="small"
                  value={activeModelId}
                  placeholder="选择模型配置"
                  onChange={async (v) => {
                    try {
                      await window.api.settings.setActiveModel(v)
                      setActiveModelId(v)
                    } catch (e) {
                      antMessage.error('切换失败')
                    }
                  }}
                  style={{ width: 220, marginRight: 8 }}
                  options={modelList.map(m => ({ label: `${m.name} (${m.model})`, value: m.id }))}
                />
                <Tooltip title="设置">
                  <Button
                    icon={<SettingOutlined />}
                    onClick={() => navigate('/settings')}
                    type="text"
                    size="small"
                  />
                </Tooltip>
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
              </div>
            </div>
          }
          className="chat-card"
          bodyStyle={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '16px',
            overflow: 'hidden'
          }}
        >
        {/* 消息列表容器 - 关键：这里需要正确设置滚动 */}
        <div className="messages-container">
          {messages.length === 0 && !isLoading && (
            <div className="empty-state">
              <RobotOutlined className="empty-state-icon" />
              <h3 className="empty-state-title">欢迎使用 MindForge Agent</h3>
              <p className="empty-state-subtitle">
                智能助手，随时为您服务
              </p>
              <p className="empty-state-description">
                💡 知识库检索 · 🌐 网络搜索 · 🔧 MCP 工具调用
              </p>
            </div>
          )}

          {messages.map(renderMessage)}

          {/* 当前流式内容 */}
          {isLoading && currentContent && (
            <div className="message-wrapper assistant">
              <div className="message-bubble streaming">
                <div className="streaming-header">
                  <RobotOutlined className="message-avatar assistant" />
                  <Text className="message-sender assistant">MindForge</Text>
                  <Spin size="small" />
                  <span className="streaming-indicator" />
                </div>

                {/* 流式内容也使用 Markdown 渲染 */}
                <div className="message-content assistant">
                  <MarkdownMessage content={currentContent} />
                </div>

                {/* 工具调用标签 */}
                {currentToolCalls.length > 0 && (
                  <div className="tool-calls-container">
                    <Space wrap size={[4, 4]}>
                      {currentToolCalls.map((call, idx) => (
                        <Tag
                          key={idx}
                          icon={<ToolOutlined />}
                          color="processing"
                          className="tool-tag"
                        >
                          {call.name}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 纯加载状态（还没有内容时） */}
          {isLoading && !currentContent && (
            <div className="loading-spinner">
              <Spin tip="思考中..." />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 - 固定在底部，不参与滚动 */}
        <div className="input-area">
          <Space.Compact className="input-compact">
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
              className="chat-input-focus input-textarea"
            />
            {isLoading ? (
              <Button
                type="primary"
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
                className="chat-button input-button stop"
              >
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!input.trim()}
                className="chat-button input-button send"
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
