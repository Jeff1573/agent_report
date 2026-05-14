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
  /** 流式阶段关闭代码高亮，避免长回答每次刷新都重新跑语法分析 */
  enableHighlight?: boolean
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, enableHighlight = true }) => {
  const rehypePlugins = React.useMemo(
    () => enableHighlight ? [rehypeHighlight, rehypeRaw] : [rehypeRaw],
    [enableHighlight]
  )

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          // 自定义渲染组件
          code: ({ inline, className, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode }) => {
            //  const match = /language-(\w+)/.exec(className || '')
            return !inline ? (
              <pre className="markdown-code-block">
                <code
                  className={`markdown-code-text ${className || ''}`}
                  {...props}
                >
                  {children}
                </code>
              </pre>
            ) : (
              <code
                className="markdown-code-inline"
                {...props}
              >
                {children}
              </code>
            )
          },
          // 链接在新标签页打开
          a: ({ children, href, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="markdown-link"
              {...props}
            >
              {children}
            </a>
          ),
          // 表格样式
          table: ({ children, ...props }) => (
            <div className="markdown-table-container">
              <table
                className="markdown-table"
                {...props}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className="markdown-th"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td
              className="markdown-td"
              {...props}
            >
              {children}
            </td>
          ),
          // 引用块样式
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="markdown-blockquote"
              {...props}
            >
              {children}
            </blockquote>
          ),
          // 列表样式
          ul: ({ children, ...props }) => (
            <ul className="markdown-ul" {...props}>
              {children}
            </ul>
          ),
              ol: ({ children, ...props }) => (
            <ol className="markdown-ol" {...props}>
              {children}
            </ol>
          ),
          // 段落样式
          p: ({ children, ...props }) => (
            <p className="markdown-p" {...props}>
              {children}
            </p>
          ),
          // 标题样式
          h1: ({ children, ...props }) => (
            <h1 className="markdown-h1" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="markdown-h2" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="markdown-h3" {...props}>
              {children}
            </h3>
          )
      }}
    >
        {content}
      </ReactMarkdown>
    </div>
  )
}
