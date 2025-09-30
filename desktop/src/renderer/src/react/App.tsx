/**
 * 文件说明：渲染进程 React 根组件
 * 集成 MindForge Agent 聊天界面
 */
import React from 'react'
import { ConfigProvider, App as AntApp } from 'antd'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AgentChat } from './components/AgentChat'
import { SettingsPage } from './components/SettingsPage'

export const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
        },
      }}
    >
      <AntApp>
        <HashRouter>
          <Routes>
            <Route path="/" element={<AgentChat />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  )
}
