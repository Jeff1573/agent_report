/**
 * 会话历史服务
 * 
 * 功能：
 * - 保存/加载会话到本地文件
 * - 管理会话列表
 * - 会话搜索和删除
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { SessionData } from '../../shared/ipc'

// 历史记录存储目录
const HISTORY_DIR = path.join(app.getPath('userData'), 'chat-history')

// 确保目录存在
function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true })
    console.log('[HistoryService] 创建历史记录目录:', HISTORY_DIR)
  }
}

// 获取会话文件路径
function getSessionPath(sessionId: string): string {
  return path.join(HISTORY_DIR, `${sessionId}.json`)
}

/**
 * 保存会话到本地
 */
export async function saveSession(session: SessionData): Promise<void> {
  try {
    ensureHistoryDir()
    const filePath = getSessionPath(session.id)
    const data = JSON.stringify(session, null, 2)
    fs.writeFileSync(filePath, data, 'utf-8')
    console.log('[HistoryService] 会话已保存:', session.id, session.title)
  } catch (error) {
    console.error('[HistoryService] 保存会话失败:', error)
    throw new Error(`保存会话失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 加载会话
 */
export async function loadSession(sessionId: string): Promise<SessionData | null> {
  try {
    const filePath = getSessionPath(sessionId)
    if (!fs.existsSync(filePath)) {
      console.log('[HistoryService] 会话不存在:', sessionId)
      return null
    }
    
    const data = fs.readFileSync(filePath, 'utf-8')
    const session = JSON.parse(data) as SessionData
    console.log('[HistoryService] 会话已加载:', session.id, session.title)
    return session
  } catch (error) {
    console.error('[HistoryService] 加载会话失败:', error)
    return null
  }
}

/**
 * 获取所有会话列表
 */
export async function listSessions(): Promise<SessionData[]> {
  try {
    ensureHistoryDir()
    
    const files = fs.readdirSync(HISTORY_DIR)
    const sessions: SessionData[] = []
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(HISTORY_DIR, file)
          const data = fs.readFileSync(filePath, 'utf-8')
          const session = JSON.parse(data) as SessionData
          sessions.push(session)
        } catch (error) {
          console.error('[HistoryService] 读取会话文件失败:', file, error)
        }
      }
    }
    
    // 按更新时间倒序排序
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    
    console.log('[HistoryService] 加载会话列表:', sessions.length, '个')
    return sessions
  } catch (error) {
    console.error('[HistoryService] 获取会话列表失败:', error)
    return []
  }
}

/**
 * 删除会话
 */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const filePath = getSessionPath(sessionId)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log('[HistoryService] 会话已删除:', sessionId)
    }
  } catch (error) {
    console.error('[HistoryService] 删除会话失败:', error)
    throw new Error(`删除会话失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 清理旧会话（可选功能）
 * @param days 保留最近多少天的会话
 */
export async function cleanOldSessions(days: number = 30): Promise<number> {
  try {
    const sessions = await listSessions()
    const now = Date.now()
    const threshold = now - days * 24 * 60 * 60 * 1000
    
    let deleted = 0
    for (const session of sessions) {
      if (session.updatedAt < threshold) {
        await deleteSession(session.id)
        deleted++
      }
    }
    
    console.log('[HistoryService] 清理旧会话:', deleted, '个')
    return deleted
  } catch (error) {
    console.error('[HistoryService] 清理旧会话失败:', error)
    return 0
  }
}
