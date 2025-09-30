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
  onLoadSession: (session: SessionData) => void
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
  const loadSessions = async () => {
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
  const handleDelete = async (sessionId: string) => {
    try {
      await window.api.history.delete(sessionId)
      message.success('会话已删除')
      loadSessions() // 重新加载列表
    } catch (error) {
      console.error('[HistorySidebar] 删除会话失败:', error)
      message.error('删除会话失败')
    }
  }

  // 加载会话
  const handleLoadSession = (session: SessionData) => {
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
        <Space>
          <HistoryOutlined style={{ color: '#667eea' }} />
          <span>历史对话</span>
        </Space>
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
          style={{ marginTop: 60 }}
        />
      ) : (
        <List
          loading={loading}
          dataSource={sessions}
          renderItem={(session) => {
            const isCurrent = session.id === currentSessionId
            return (
              <List.Item
                style={{
                  padding: '12px',
                  marginBottom: 8,
                  background: isCurrent ? '#f0f5ff' : '#ffffff',
                  borderRadius: '8px',
                  border: isCurrent ? '2px solid #667eea' : '1px solid #e8e8e8',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.style.background = '#fafafa'
                    e.currentTarget.style.borderColor = '#d9d9d9'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.style.background = '#ffffff'
                    e.currentTarget.style.borderColor = '#e8e8e8'
                  }
                }}
              >
                <div style={{ width: '100%' }}>
                  <div
                    onClick={() => handleLoadSession(session)}
                    style={{ marginBottom: 8 }}
                  >
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Text
                        strong
                        style={{
                          fontSize: 14,
                          color: isCurrent ? '#667eea' : '#000',
                          maxWidth: '220px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'inline-block'
                        }}
                      >
                        {session.title}
                      </Text>
                      {isCurrent && (
                        <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
                          当前
                        </Tag>
                      )}
                    </Space>

                    <div style={{ marginTop: 6 }}>
                      <Space size={12} style={{ fontSize: 11, color: '#999' }}>
                        <span>
                          <MessageOutlined style={{ marginRight: 4 }} />
                          {session.messages.length} 条消息
                        </span>
                        <span>
                          <ClockCircleOutlined style={{ marginRight: 4 }} />
                          {new Date(session.updatedAt).toLocaleDateString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </Space>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
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
                        onClick={(e) => e.stopPropagation()}
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
