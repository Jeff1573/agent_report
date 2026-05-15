/**
 * Agent 聊天界面组件
 * 
 * 功能：
 * - 流式消息展示
 * - 工具调用过程可视化
 * - 会话历史管理
 */

import React, { useState, useRef, useEffect, useCallback, JSX } from 'react'
import { Input, Button, Card, Space, Typography, Tag, Spin, message as antMessage, Tooltip, Modal, Select, Switch, Form } from 'antd'
import { SendOutlined, StopOutlined, RobotOutlined, UserOutlined, ToolOutlined, PlusOutlined, DeleteOutlined, HistoryOutlined, SettingOutlined, DatabaseOutlined } from '@ant-design/icons'
import type { AgentStreamEvent, SessionData } from '../../../../shared/ipc'
import { MarkdownMessage } from './MarkdownMessage'
import { HistorySidebar } from './HistorySidebar'
import { ExecutionStepsPanel } from './ExecutionStepsPanel'
import '../../assets/chat-animations.css'
import { useNavigate } from 'react-router-dom'
import type { ModelConfig } from '../../../../shared/ipc'

const { TextArea } = Input
const { Text } = Typography

const STREAM_FLUSH_INTERVAL_MS = 33 // 将高频 token 合并到约 30FPS，降低长回答重渲染压力
const AUTO_SCROLL_THRESHOLD_PX = 96 // 距离底部小于该值时，认为用户仍在跟随最新回答
const CITATION_ONLY_MESSAGE_RE = /^\s*(?:#{1,6}\s*)?参考来源[:：]?\s*(?:\n|$)/

/**
 * 执行步骤类型
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

/**
 * 消息接口
 */
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: Array<{ 
    name: string
    args: unknown
    thinking?: string  // LLM 的思考过程（兼容旧版）
  }>
  executionSteps?: ExecutionStep[]  // 新版：完整的执行步骤
}

// 生成会话标题（从第一条用户消息截取）
function generateSessionTitle(messages: Message[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user')
  if (!firstUserMessage) return '新对话'
  
  const content = firstUserMessage.content.trim()
  if (content.length <= 30) return content
  return content.slice(0, 30) + '...'
}

/**
 * 合并助手完整消息。
 *
 * 后端补充 RAG 引用来源时也会发送 assistant-message，
 * 这类消息应追加到已流式输出的正文后面，避免覆盖正文。
 */
function mergeAssistantMessageContent(current: string, incoming: string): string {
  const incomingText = incoming.trim()
  if (!incomingText) return current

  if (current.trim() && CITATION_ONLY_MESSAGE_RE.test(incoming)) {
    return `${current.trimEnd()}\n\n${incomingText}`
  }

  return incoming
}

export const AgentChat: React.FC = () => {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentContent, setCurrentContent] = useState('')
  // 保留用于兼容旧版本消息格式
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [currentToolCalls, setCurrentToolCalls] = useState<Array<{ name: string; args: unknown; thinking?: string }>>([])
  const [currentStage, setCurrentStage] = useState<'decision' | 'execution' | 'answer' | undefined>(undefined)
  // 新增：当前执行步骤列表
  const [currentExecutionSteps, setCurrentExecutionSteps] = useState<ExecutionStep[]>([])
  const [sessionId, setSessionId] = useState(() => `session-${Date.now()}`)
  const [historyVisible, setHistoryVisible] = useState(false)
  const [modelList, setModelList] = useState<ModelConfig[]>([])
  const [activeModelId, setActiveModelId] = useState<string | undefined>(undefined)
  // 会话级 RAG 选择状态
  const [ragList, setRagList] = useState<Array<{ id: string; name: string; enabled: boolean }>>([])
  const [ragEnabled, setRagEnabled] = useState<boolean>(false)
  const [ragConfigId, setRagConfigId] = useState<string | undefined>(undefined)
  const [ragCollection, setRagCollection] = useState<string | undefined>(undefined)
  const [ragModalOpen, setRagModalOpen] = useState(false)
  const [ragForm] = Form.useForm<{ enabled: boolean; configId?: string; collection?: string }>()
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const streamingContentRef = useRef('')
  const streamFlushTimerRef = useRef<number | null>(null)
  const shouldStickToBottomRef = useRef(true)

  const isNearBottom = useCallback((): boolean => {
    const container = messagesContainerRef.current
    if (!container) return true

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceToBottom <= AUTO_SCROLL_THRESHOLD_PX
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto'): void => {
    const container = messagesContainerRef.current
    if (!container || !shouldStickToBottomRef.current) return

    window.requestAnimationFrame(() => {
      if (behavior === 'auto') {
        container.scrollTop = container.scrollHeight
        return
      }

      container.scrollTo({
        top: container.scrollHeight,
        behavior
      })
    })
  }, [])

  const handleMessagesScroll = useCallback((): void => {
    shouldStickToBottomRef.current = isNearBottom()
  }, [isNearBottom])

  const clearStreamFlushTimer = useCallback((): void => {
    if (streamFlushTimerRef.current === null) return

    window.clearTimeout(streamFlushTimerRef.current)
    streamFlushTimerRef.current = null
  }, [])

  const flushStreamingContent = useCallback((): void => {
    clearStreamFlushTimer()
    setCurrentContent(streamingContentRef.current)
  }, [clearStreamFlushTimer])

  const scheduleStreamingContentFlush = useCallback((): void => {
    if (streamFlushTimerRef.current !== null) return

    // 高频 token 先进入 ref 缓冲区，再按固定节奏同步到 React 状态。
    streamFlushTimerRef.current = window.setTimeout(() => {
      streamFlushTimerRef.current = null
      setCurrentContent(streamingContentRef.current)
    }, STREAM_FLUSH_INTERVAL_MS)
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    scrollToBottom('smooth')
  }, [messages, scrollToBottom])

  // 流式输出期间使用即时滚动，避免 smooth 动画被高频内容更新反复打断。
  useEffect(() => {
    scrollToBottom('auto')
  }, [currentContent, scrollToBottom])

  useEffect(() => {
    return () => {
      clearStreamFlushTimer()
    }
  }, [clearStreamFlushTimer])

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

  // 加载可用的 RAG 配置（仅启用项）
  useEffect(() => {
    (async () => {
      try {
        const list = await window.api.settings.ragList()
        const enabled = Array.isArray(list) ? list.filter((x: { enabled?: boolean }) => x?.enabled) : []
        setRagList(enabled.map((x: { id: string; name?: string }) => ({ id: String(x.id), name: String(x.name || x.id), enabled: true })))
        const def = await window.api.settings.ragGetDefault()
        if (def && def.enabled) {
          setRagEnabled(true)
          setRagConfigId(def.id)
          if (typeof def.defaultCollection === 'string' && def.defaultCollection.trim()) {
            setRagCollection(def.defaultCollection)
          }
        }
      } catch {
        // 忽略加载失败，不阻断聊天
      }
    })()
  }, [])

  // 消息变化时自动保存
  useEffect(() => {
    if (messages.length === 0) return undefined

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

  // 监听 MCP 配置重载事件
  useEffect(() => {
    const handleMcpReload = (_event: unknown, result: { success: boolean; error?: string }): void => {
      if (result.success) {
        antMessage.success('MCP 配置已更新，Agent 已重新加载', 3)
        console.log('[AgentChat] MCP 配置已重新加载')
      } else {
        antMessage.error(`MCP 配置重载失败: ${result.error || '未知错误'}`, 5)
        console.error('[AgentChat] MCP 配置重载失败:', result.error)
      }
    }

    // 使用 electron API 监听事件
    const cleanup = window.electron.ipcRenderer.on('mcp-config-reloaded', handleMcpReload)

    return () => {
      if (cleanup) cleanup()
    }
  }, [])

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
    shouldStickToBottomRef.current = true
    streamingContentRef.current = ''
    clearStreamFlushTimer()
    setCurrentContent('')
    setCurrentToolCalls([])
    setCurrentExecutionSteps([])  // 清空执行步骤
    setCurrentStage(undefined)

    try {
      await window.api.agent.chatStream(
        messageToSend,
        (event: AgentStreamEvent) => {
          handleStreamEvent(event)
        },
        { 
          summary: false,
          // Agent 线程必须跟随 UI 会话，避免清空/新建对话后复用旧的 LangGraph 状态。
          threadId: sessionId,
          modelConfigId: activeModelId,
          ragEnabled: ragEnabled,
          ragConfigId: ragEnabled ? ragConfigId : undefined,
          ragCollection: ragEnabled ? (ragCollection || undefined) : undefined
        }
      )
    } catch (error) {
      console.error('Chat error:', error)
      antMessage.error(`发送失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      // 🆕 流式结束后，保存最终的助手消息（包含所有执行步骤）
      flushStreamingContent()
      const finalContent = streamingContentRef.current

      setCurrentToolCalls(prevToolCalls => {
        setCurrentExecutionSteps(prevSteps => {
          if (finalContent || prevSteps.length > 0) {
            const finalSteps = finalContent ? [...prevSteps, {
              id: `step-${Date.now()}-answer`,
              type: 'answer' as const,
              stage: 'answer' as const,
              content: finalContent,
              timestamp: Date.now(),
              status: 'completed' as const
            }] : prevSteps

            setMessages(prevMsgs => [...prevMsgs, {
              id: Date.now().toString(),
              role: 'assistant',
              content: finalContent,
              timestamp: Date.now(),
              toolCalls: prevToolCalls.length > 0 ? [...prevToolCalls] : undefined,
              executionSteps: finalSteps.length > 0 ? finalSteps : undefined
            }])
          }

          return []
        })
        return []
      })

      streamingContentRef.current = ''
      setCurrentContent('')
      setCurrentStage(undefined)
      setIsLoading(false)
    }
  }

  const handleStreamEvent = (evt: AgentStreamEvent): void => {
    // 更新当前阶段
    if (evt.stage) {
      setCurrentStage(prev => prev === evt.stage ? prev : evt.stage)
    }

    switch (evt.type) {
      case 'model-token':
        if (evt.token) {
          streamingContentRef.current += evt.token
          scheduleStreamingContentFlush()
        }
        break

      case 'assistant-message':
        if (evt.content) {
          streamingContentRef.current = mergeAssistantMessageContent(streamingContentRef.current, evt.content)
          scheduleStreamingContentFlush()
        }
        break

      case 'tool-call':
        if (evt.name) {
          // 保存旧版格式（兼容）
          setCurrentToolCalls(prev => [...prev, { 
            name: evt.name!, 
            args: evt.args,
            thinking: evt.thinking
          }])
          
          // 🆕 构建执行步骤：思考阶段
          if (evt.thinking) {
            setCurrentExecutionSteps(prev => [...prev, {
              id: `step-${Date.now()}-thinking`,
              type: 'thinking',
              stage: evt.stage,
              content: evt.thinking,
              timestamp: evt.ts,
              status: 'completed'
            }])
          }
          
          // 🆕 构建执行步骤：工具调用
          setCurrentExecutionSteps(prev => [...prev, {
            id: `step-${Date.now()}-call-${evt.name}`,
            type: 'tool-call',
            stage: evt.stage,
            content: `调用工具: ${evt.name}`,
            toolName: evt.name,
            toolArgs: evt.args,
            timestamp: evt.ts,
            status: 'running'  // 初始状态为运行中
          }])
        }
        break

      case 'tool-result':
        // 🆕 构建执行步骤：工具结果
        if (evt.name) {
          // 更新对应工具调用的状态为完成
          setCurrentExecutionSteps(prev => {
            const updated = [...prev]
            const callStepIndex = updated.findIndex(
              s => s.type === 'tool-call' && s.toolName === evt.name && s.status === 'running'
            )
            if (callStepIndex !== -1) {
              updated[callStepIndex] = {
                ...updated[callStepIndex],
                status: 'completed'
              }
            }
            
            // 添加结果步骤
            updated.push({
              id: `step-${Date.now()}-result-${evt.name}`,
              type: 'tool-result',
              stage: evt.stage,
              content: `工具返回结果`,
              toolName: evt.name,
              toolResult: evt.output,
              timestamp: evt.ts,
              status: 'completed'
            })
            
            return updated
          })
        }
        break

      case 'round-end':
        // 🆕 每轮结束时，不再立即保存消息，只是标记阶段
        // 消息将在整个流式对话结束后统一保存（在 handleSend 的 finally 块中）
        console.log('[AgentChat] round-end 事件：当前步骤数', currentExecutionSteps.length)
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
        setCurrentExecutionSteps([])
        setCurrentStage(undefined)
        streamingContentRef.current = ''
        clearStreamFlushTimer()
        shouldStickToBottomRef.current = true
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
      onOk: async () => {
        const clearedAt = Date.now()
        const nextSessionId = `session-${clearedAt}`

        // 清空前端状态
        setMessages([])
        setInput('')
        setCurrentContent('')
        setCurrentToolCalls([])
        setCurrentExecutionSteps([])
        setCurrentStage(undefined)
        streamingContentRef.current = ''
        clearStreamFlushTimer()
        shouldStickToBottomRef.current = true
        
        // 立即保存空会话到文件，确保重启后仍然是空的
        try {
          const emptySession: SessionData = {
            id: sessionId,
            title: '新对话',
            messages: [],
            createdAt: clearedAt,
            updatedAt: clearedAt
          }
          await window.api.history.save(emptySession)
          console.log('[AgentChat] 空会话已保存')
        } catch (error) {
          console.error('[AgentChat] 保存空会话失败:', error)
        }

        // 清空后切换到全新的 Agent 线程，规避旧线程中未闭合 tool_calls 的残留状态。
        setSessionId(nextSessionId)
        
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
    setCurrentExecutionSteps([])
    setCurrentStage(undefined)
    streamingContentRef.current = ''
    clearStreamFlushTimer()
    shouldStickToBottomRef.current = true
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

          {/* 🆕 执行步骤面板（新版）- 放在消息内容上方 */}
          {msg.executionSteps && msg.executionSteps.length > 0 ? (
            <ExecutionStepsPanel steps={msg.executionSteps} defaultCollapsed={true} />
          ) : (
            /* 兼容旧版：工具调用标签 */
            msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="tool-calls-container">
                <Space wrap size={[4, 4]} direction="vertical">
                  {msg.toolCalls.map((call, idx) => (
                    <div key={idx}>
                      <Tooltip title={call.thinking || '工具调用'}>
                        <Tag
                          icon={<ToolOutlined />}
                          color="blue"
                          className="tool-tag"
                        >
                          {call.name}
                        </Tag>
                      </Tooltip>
                      {call.thinking && (
                        <Text type="secondary" style={{ fontSize: '12px', marginLeft: '8px' }}>
                          💭 {call.thinking}
                        </Text>
                      )}
                    </div>
                  ))}
                </Space>
              </div>
            )
          )}

          <div className={`message-content ${isUser ? 'user' : 'assistant'}`}>
            {isUser ? (
              <div>{msg.content}</div>
            ) : (
              <MarkdownMessage content={msg.content} />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* RAG 设置弹窗 */}
      <Modal
        title="RAG 设置"
        open={ragModalOpen}
        onCancel={() => setRagModalOpen(false)}
        onOk={() => {
          const v = ragForm.getFieldsValue()
          setRagEnabled(Boolean(v.enabled))
          setRagConfigId(v.configId)
          setRagCollection((v.collection || '').trim() || undefined)
          setRagModalOpen(false)
        }}
        okText="应用"
      >
        <Form form={ragForm} layout="vertical" initialValues={{ enabled: ragEnabled, configId: ragConfigId, collection: ragCollection }}>
          <Form.Item name="enabled" label="启用 RAG" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="configId" label="RAG 应用">
            <Select
              options={ragList.map(x => ({ label: x.name, value: x.id }))}
              placeholder="选择RAG应用"
              disabled={!ragForm.getFieldValue('enabled')}
            />
          </Form.Item>
          <Form.Item name="collection" label="collection（可选）">
            <Input placeholder="覆盖默认集合名（可选）" disabled={!ragForm.getFieldValue('enabled')} />
          </Form.Item>
        </Form>
      </Modal>
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
                  disabled={isLoading}
                />
                <Tooltip title={isLoading ? "正在接收响应，请稍候..." : "设置"}>
                  <Button
                    icon={<SettingOutlined />}
                    onClick={() => navigate('/settings')}
                    type="text"
                    size="small"
                    disabled={isLoading}
                  />
                </Tooltip>
              <Tooltip title={isLoading ? "正在接收响应，请稍候..." : (ragEnabled ? `RAG已启用${ragCollection ? ` · ${ragCollection}` : ''}` : 'RAG 设置')}>
                <Button
                  icon={<DatabaseOutlined />}
                  onClick={() => {
                    ragForm.setFieldsValue({
                      enabled: ragEnabled,
                      configId: ragConfigId,
                      collection: ragCollection
                    })
                    setRagModalOpen(true)
                  }}
                  type="text"
                  size="small"
                  disabled={isLoading}
                />
              </Tooltip>
                <Tooltip title={isLoading ? "正在接收响应，请稍候..." : "历史对话"}>
                  <Button
                    icon={<HistoryOutlined />}
                    onClick={() => setHistoryVisible(true)}
                    type="text"
                    size="small"
                    disabled={isLoading}
                  />
                </Tooltip>
                <Tooltip title={isLoading ? "正在接收响应，请稍候..." : "新建对话"}>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={handleNewChat}
                    type="text"
                    size="small"
                    disabled={isLoading}
                  />
                </Tooltip>
                <Tooltip title={isLoading ? "正在接收响应，请稍候..." : "清空对话"}>
                  <Button
                    icon={<DeleteOutlined />}
                    onClick={handleClearChat}
                    type="text"
                    danger
                    disabled={messages.length === 0 || isLoading}
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
        <div className="messages-container" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
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
                  {currentStage && (
                    <Tag color={
                      currentStage === 'decision' ? 'gold' :
                      currentStage === 'execution' ? 'processing' :
                      'success'
                    } style={{ marginLeft: '8px' }}>
                      {currentStage === 'decision' ? '🤔 决策中' :
                       currentStage === 'execution' ? '⚙️ 执行中' :
                       '💭 回答中'}
                    </Tag>
                  )}
                  <span className="streaming-indicator" />
                </div>

                {/* 🆕 实时执行步骤面板 - 放在消息内容上方 */}
                {currentExecutionSteps.length > 0 && (
                  <ExecutionStepsPanel steps={currentExecutionSteps} defaultCollapsed={false} />
                )}

                {/* 流式内容也使用 Markdown 渲染 */}
                <div className="message-content assistant">
                  <MarkdownMessage content={currentContent} enableHighlight={false} />
                </div>
              </div>
            </div>
          )}

          {/* 纯加载状态（还没有内容时） */}
          {isLoading && !currentContent && (
            <div className="loading-spinner">
              <Spin tip="思考中..." />
            </div>
          )}
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
