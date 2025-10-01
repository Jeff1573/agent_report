/**
 * 历史对话侧边栏组件
 * 
 * 功能：
 * - 显示所有历史对话会话
 * - 加载选中的会话
 * - 删除会话
 */

import React, { useState, useEffect } from 'react'
import { Drawer, List, Button, Space, Typography, Tag, Empty, Popconfirm, message } from 'antd'
import { HistoryOutlined, DeleteOutlined, MessageOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { SessionData } from '../../../../shared/ipc'

const { Text } = Typography

interface HistorySidebarProps {
  visible: boolean
  onClose: () => void
  currentSessionId: string
  onLoadSession: (_session: SessionData) => void
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  visible,
  onClose,
  currentSessionId,
  onLoadSession
}) => {
  const [sessions, setSessions] = useState<SessionData[]>([])
  const [loading, setLoading] = useState(false)

  // 加载会话列表
  const loadSessions: () => Promise<void> = async () => {
    setLoading(true)
    try {
      const list = await window.api.history.list()
      setSessions(list)
    } catch (error) {
      console.error('[HistorySidebar] 加载会话列表失败:', error)
      message.error('加载历史对话失败')
    } finally {
      setLoading(false)
    }
  }

  // 删除会话
  const handleDelete: (sessionId: string) => Promise<void> = async (sessionId: string) => {
    try {
      await window.api.history.delete(sessionId)
      message.success('会话已删除')
      loadSessions() // 重新加载列表
    } catch (error) {
      console.error('[HistorySidebar] 删除会话失败:', error)
      message.error('删除会话失败')
    }
  }

  // 清空会话（保留当前）
  const handleClearAllExceptCurrent: () => Promise<void> = async () => {
    try {
      const deleted = await window.api.history.clear(currentSessionId)
      message.success(`已清空历史，共删除 ${deleted} 个会话`)
      loadSessions()
    } catch (error) {
      console.error('[HistorySidebar] 清空历史失败:', error)
      message.error('清空历史失败')
    }
  }

  // 加载会话
  const handleLoadSession: (session: SessionData) => void = (session: SessionData) => {
    onLoadSession(session)
    onClose()
    message.success(`已加载会话: ${session.title}`)
  }

  // 当侧边栏打开时加载会话列表
  useEffect(() => {
    if (visible) {
      loadSessions()
    }
  }, [visible])

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <HistoryOutlined style={{ color: '#667eea' }} />
            <span>历史对话</span>
          </Space>
          <Popconfirm
            title="清空历史"
            description="将删除除当前会话外的所有历史记录，确认执行？"
            onConfirm={handleClearAllExceptCurrent}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger size="small">清空历史</Button>
          </Popconfirm>
        </div>
      }
      placement="left"
      open={visible}
      onClose={onClose}
      width={360}
      styles={{
        body: { padding: '16px 8px' }
      }}
    >
      {sessions.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无历史对话"
          className="history-empty"
        />
      ) : (
        <List
          loading={loading}
          dataSource={sessions}
          renderItem={(session) => {
            const isCurrent = session.id === currentSessionId
            return (
              <List.Item
                className={`history-session-item ${isCurrent ? 'current' : ''}`}
                onMouseEnter={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.classList.add('hover')
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.classList.remove('hover')
                  }
                }}
              >
                <div className="history-session-content">
                  <div
                    onClick={() => handleLoadSession(session)}
                    className="history-session-header"
                  >
                    <div className="history-session-title-row">
                      <Text className={`history-session-title ${isCurrent ? 'current' : ''}`}>
                        {session.title}
                      </Text>
                      {isCurrent && (
                        <Tag color="blue" className="history-session-current-tag">
                          当前
                        </Tag>
                      )}
                    </div>

                    <div className="history-session-meta">
                      <div className="history-session-info">
                        <span className="history-session-info-item">
                          <MessageOutlined className="history-session-info-icon" />
                          {session.messages.length} 条消息
                        </span>
                        <span className="history-session-info-item">
                          <ClockCircleOutlined className="history-session-info-icon" />
                          {new Date(session.updatedAt).toLocaleDateString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="history-session-actions">
                    <Popconfirm
                      title="删除会话"
                      description="确定要删除这个会话吗？"
                      onConfirm={() => handleDelete(session.id)}
                      okText="确定"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        className="history-session-delete-btn"
                        onClick={(e) => e.stopPropagation()}
                        disabled={isCurrent}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              </List.Item>
            )
          }}
        />
      )}
    </Drawer>
  )
}
