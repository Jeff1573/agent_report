/**
 * Markdown 消息渲染组件
 * 
 * 功能：
 * - 支持 GitHub 风格 Markdown
 * - 代码语法高亮
 * - 表格、任务列表等扩展语法
 */

import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import 'highlight.js/styles/github-dark.css' // 代码高亮主题

interface MarkdownMessageProps {
  content: string
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight, rehypeRaw]}
      components={{
        // 自定义渲染组件
        code: ({ node, inline, className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || '')
          return !inline ? (
            <pre style={{ 
              background: '#1e1e1e', 
              padding: '12px 16px', 
              borderRadius: '6px',
              overflow: 'auto',
              margin: '8px 0',
              border: '1px solid #333'
            }}>
              <code 
                className={className} 
                style={{
                  color: '#d4d4d4',
                  fontSize: '13px',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  lineHeight: 1.6
                }}
                {...props}
              >
                {children}
              </code>
            </pre>
          ) : (
            <code 
              style={{ 
                background: '#f3f4f6', 
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '85%',
                color: '#e01e5a',
                fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                border: '1px solid #e5e7eb'
              }} 
              {...props}
            >
              {children}
            </code>
          )
        },
        // 链接在新标签页打开
        a: ({ node, children, href, ...props }) => (
          <a 
            href={href} 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ 
              color: '#1890ff', 
              textDecoration: 'none',
              borderBottom: '1px solid transparent',
              transition: 'border-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderBottomColor = '#1890ff'}
            onMouseLeave={(e) => e.currentTarget.style.borderBottomColor = 'transparent'}
            {...props}
          >
            {children}
          </a>
        ),
        // 表格样式
        table: ({ node, children, ...props }) => (
          <div style={{ overflowX: 'auto', margin: '8px 0' }}>
            <table 
              style={{ 
                borderCollapse: 'collapse',
                width: '100%',
                border: '1px solid #e5e7eb',
                fontSize: '14px'
              }}
              {...props}
            >
              {children}
            </table>
          </div>
        ),
        th: ({ node, children, ...props }) => (
          <th 
            style={{ 
              border: '1px solid #e5e7eb',
              padding: '8px 12px',
              background: '#f9fafb',
              textAlign: 'left',
              fontWeight: 600
            }}
            {...props}
          >
            {children}
          </th>
        ),
        td: ({ node, children, ...props }) => (
          <td 
            style={{ 
              border: '1px solid #e5e7eb',
              padding: '8px 12px'
            }}
            {...props}
          >
            {children}
          </td>
        ),
        // 引用块样式
        blockquote: ({ node, children, ...props }) => (
          <blockquote 
            style={{ 
              borderLeft: '4px solid #d1d5db',
              paddingLeft: '1em',
              margin: '8px 0',
              color: '#6b7280',
              fontStyle: 'italic'
            }}
            {...props}
          >
            {children}
          </blockquote>
        ),
        // 列表样式
        ul: ({ node, children, ...props }) => (
          <ul style={{ paddingLeft: '1.5em', margin: '8px 0' }} {...props}>
            {children}
          </ul>
        ),
        ol: ({ node, children, ...props }) => (
          <ol style={{ paddingLeft: '1.5em', margin: '8px 0' }} {...props}>
            {children}
          </ol>
        ),
        // 段落样式
        p: ({ node, children, ...props }) => (
          <p style={{ margin: '8px 0', lineHeight: 1.6 }} {...props}>
            {children}
          </p>
        ),
        // 标题样式
        h1: ({ node, children, ...props }) => (
          <h1 style={{ fontSize: '1.8em', fontWeight: 600, margin: '16px 0 8px 0', borderBottom: '2px solid #e5e7eb', paddingBottom: '8px' }} {...props}>
            {children}
          </h1>
        ),
        h2: ({ node, children, ...props }) => (
          <h2 style={{ fontSize: '1.5em', fontWeight: 600, margin: '14px 0 8px 0' }} {...props}>
            {children}
          </h2>
        ),
        h3: ({ node, children, ...props }) => (
          <h3 style={{ fontSize: '1.2em', fontWeight: 600, margin: '12px 0 6px 0' }} {...props}>
            {children}
          </h3>
        )
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
