import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Descriptions, Divider, Form, Input, InputNumber, List, Modal, Space, Typography, message, Upload, Tag, Tooltip, Switch, Tabs, Select } from 'antd'
import { LeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined, UploadOutlined, DownloadOutlined, SettingOutlined, CheckCircleOutlined, CloseCircleOutlined, FolderOpenOutlined, FileAddOutlined } from '@ant-design/icons'
import type { ModelConfig, StreamingValidationResult, VectorDbConfig, RagValidationResult, ModelConnectionValidationResult } from '../../../../shared/ipc'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

const formatApiKeySource = (source: ModelConnectionValidationResult['apiKeySource']): string => {
  if (source === 'ui') return '当前表单'
  if (source === 'env') return '环境变量'
  return '未配置'
}

/**
 * 生成单次导入任务使用的唯一 ID。
 *
 * 说明：渲染进程只需要在当前会话内唯一，时间戳 + 随机串已足够满足需求。
 *
 * @returns 导入任务 ID
 */
const createImportTaskId = (): string => {
  return `rag-import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate()
  const [models, setModels] = useState<ModelConfig[]>([])
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ModelConfig | null>(null)
  const [validating, setValidating] = useState(false)
  const [connectionValidating, setConnectionValidating] = useState(false)
  const [connectionResult, setConnectionResult] = useState<ModelConnectionValidationResult | null>(null)
  const [pendingStreamingValidation, setPendingStreamingValidation] = useState<StreamingValidationResult | undefined>(undefined)
  const [form] = Form.useForm<ModelConfig>()

  // RAG 配置状态
  const [ragList, setRagList] = useState<VectorDbConfig[]>([])
  const [ragLoading, setRagLoading] = useState(false)
  const [ragModalOpen, setRagModalOpen] = useState(false)
  const [ragEditing, setRagEditing] = useState<VectorDbConfig | null>(null)
  const [ragForm] = Form.useForm<VectorDbConfig>()
  const [ragValidating, setRagValidating] = useState(false)
  // 导入弹窗状态
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importMode, setImportMode] = useState<'file' | 'dir'>('file')
  const [importTarget, setImportTarget] = useState<VectorDbConfig | null>(null)
  const [importPath, setImportPath] = useState<string>('')
  const [importForm] = Form.useForm<{ collection: string; chunkSize?: number; chunkOverlap?: number; parseMethod?: 'auto' | 'ast' | 'text' }>()
  const [importLoading, setImportLoading] = useState(false)
  const importTaskIdRef = useRef<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.settings.modelList()
      const active = await window.api.settings.getActiveModel()
      setModels(list)
      setActiveId(active?.id)
    } catch (e) {
      message.error('加载设置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  /**
   * 加载 RAG 应用配置列表。
   */
  const loadRag = async (): Promise<void> => {
    setRagLoading(true)
    try {
      const list = await window.api.settings.ragList()
      setRagList(list)
    } catch (e) {
      message.error('加载 RAG 配置失败')
    } finally {
      setRagLoading(false)
    }
  }
  useEffect(() => { loadRag() }, [])

  const onAdd = (): void => {
    setEditing(null)
    setConnectionResult(null)
    setPendingStreamingValidation(undefined)
    setConnectionValidating(false)
    form.resetFields()
    setModalOpen(true)
  }

  const onEdit = (cfg: ModelConfig): void => {
    setEditing(cfg)
    setConnectionResult(null)
    setPendingStreamingValidation(cfg.streamingValidation)
    setConnectionValidating(false)
    form.setFieldsValue(cfg)
    setModalOpen(true)
  }

  const onDelete = async (id: string): Promise<void> => {
    Modal.confirm({
      title: '删除配置',
      content: '确定删除该模型配置？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.api.settings.deleteModel(id)
          message.success('已删除')
          load()
        } catch (e) {
          message.error('删除失败')
        }
      }
    })
  }

  const onSetActive = async (id: string): Promise<void> => {
    try {
      await window.api.settings.setActiveModel(id)
      setActiveId(id)
      message.success('已设为默认')
    } catch (e) {
      message.error('设置失败')
    }
  }

  const buildModelPayload = (
    values: ModelConfig,
    options: { streaming?: boolean } = {}
  ): ModelConfig => ({
    id: editing?.id || '',
    name: (values.name || '').trim(),
    model: (values.model || '').trim(),
    baseURL: (values.baseURL || '').trim() || undefined,
    apiKey: (values.apiKey || '').trim() || undefined,
    temperature: typeof values.temperature === 'number' ? values.temperature : 0,
    timeout: typeof values.timeout === 'number' ? values.timeout : 60000,
    maxRetries: typeof values.maxRetries === 'number' ? values.maxRetries : 2,
    streaming: typeof options.streaming === 'boolean' ? options.streaming : Boolean(values.streaming),
    streamingValidation: pendingStreamingValidation,
    updatedAt: Date.now()
  })

  const onSubmit = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const payload = buildModelPayload(values)
      await window.api.settings.upsertModel(payload)
      setModalOpen(false)
      setConnectionResult(null)
      setPendingStreamingValidation(undefined)
      message.success(editing ? '已更新' : '已新增')
      load()
    } catch (e) {
      // 表单校验失败或请求失败
    }
  }

  const onExport = async (): Promise<void> => {
    try {
      const json = await window.api.settings.exportSettings()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'settings.json'
      a.click()
      URL.revokeObjectURL(url)
      message.success('已导出')
    } catch (e) {
      message.error('导出失败')
    }
  }

  const beforeUpload = async (file: File): Promise<boolean> => {
    try {
      const text = await file.text()
      await window.api.settings.importSettings(text)
      message.success('已导入')
      load()
    } catch (e) {
      message.error('导入失败')
    }
    return false
  }

  const onOpenAppDataFile = async (filename: string, displayName: string): Promise<void> => {
    try {
      await window.api.settings.openAppDataFile(filename)
      message.success(`已在默认编辑器中打开 ${displayName}`)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : '打开失败'
      message.error(errorMsg)
    }
  }

  const onStreamingSwitchChange = async (checked: boolean): Promise<void> => {
    if (!checked) {
      // 关闭流式不需要验证
      return
    }

    // 开启流式时，先验证配置是否有效
    try {
      const values = await form.validateFields()
      
      // 检查必填字段
      if (!values.model || !values.name) {
        message.warning('请先填写模型名和配置名称')
        form.setFieldValue('streaming', false)
        return
      }

      setValidating(true)
      message.loading({ content: '正在验证流式支持...', key: 'validating', duration: 0 })

      // 构建临时配置进行验证
      const tempConfig = buildModelPayload(values, { streaming: true })

      // 只验证当前表单配置，不提前写入 settings.json。
      const result = await window.api.settings.validateStreamingConfig(tempConfig)
      setPendingStreamingValidation(result)
      
      message.destroy('validating')

      if (result.supported) {
        const latency = result.firstTokenLatency || result.duration
        if (latency < 2000) {
          message.success(`✅ 验证成功：支持流式输出（响应快：${latency}ms）`, 5)
        } else if (latency < 8000) {
          message.warning(`⚠️ 支持流式但响应较慢（${latency}ms）`, 5)
        } else {
          message.warning(`⚠️ 支持流式但响应很慢（${latency}ms），建议关闭以获得更好体验`, 6)
          // 建议用户关闭
          Modal.confirm({
            title: '流式响应较慢',
            content: `检测到首个 token 延迟为 ${latency}ms，建议关闭流式输出以避免用户等待焦虑。是否保持开启？`,
            okText: '保持开启',
            cancelText: '关闭流式',
            onCancel: () => {
              form.setFieldValue('streaming', false)
            }
          })
        }
      } else {
        message.error(`❌ 验证失败：不支持流式输出 - ${result.error || '未知原因'}`, 6)
        // 自动关闭开关
        form.setFieldValue('streaming', false)
      }

    } catch (e) {
      message.destroy('validating')
      const errorMsg = e instanceof Error ? e.message : '验证失败'
      message.error(errorMsg)
      form.setFieldValue('streaming', false)
      setPendingStreamingValidation(undefined)
    } finally {
      setValidating(false)
    }
  }

  const onValidateConnection = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const payload = buildModelPayload(values)
      setConnectionResult(null)
      setConnectionValidating(true)
      const result = await window.api.settings.validateModelConnection(payload)
      setConnectionResult(result)
      if (result.ok) {
        message.success(result.message)
      } else {
        message.error(result.message)
      }
    } catch (e) {
      if (e instanceof Error) message.error(e.message)
    } finally {
      setConnectionValidating(false)
    }
  }

  // ---------------- RAG：事件处理 ----------------
  const onRagAdd = (): void => {
    setRagEditing(null)
    ragForm.resetFields()
    ragForm.setFieldsValue({
      provider: 'chroma',
      enabled: true,
      connection: { url: 'http://localhost:8000' },
      embeddings: { provider: 'openai', model: 'text-embedding-3-small' },
      retriever: { k: 4, searchType: 'similarity', mmrLambda: 0.5, fetchK: 32 }
    })
    setRagModalOpen(true)
  }

  const onRagEdit = (cfg: VectorDbConfig): void => {
    setRagEditing(cfg)
    ragForm.setFieldsValue(cfg)
    setRagModalOpen(true)
  }

  const onRagDelete = async (id: string): Promise<void> => {
    Modal.confirm({
      title: '删除 RAG 应用',
      content: '确定删除该 RAG 应用配置？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.api.settings.ragDelete(id)
          message.success('已删除')
          loadRag()
        } catch (e) {
          message.error('删除失败')
        }
      }
    })
  }

  const onRagSetDefault = async (id: string): Promise<void> => {
    try {
      await window.api.settings.ragSetDefault(id)
      message.success('已设为默认')
      loadRag()
    } catch (e) {
      message.error('设置失败')
    }
  }

  const onRagToggleEnabled = async (id: string, enabled: boolean): Promise<void> => {
    try {
      await window.api.settings.ragToggleEnabled(id, enabled)
      message.success(enabled ? '已启用' : '已禁用')
      loadRag()
    } catch (e) {
      message.error('操作失败')
    }
  }

  const onRagValidate = async (cfg: VectorDbConfig): Promise<void> => {
    try {
      setRagValidating(true)
      const res: RagValidationResult = await window.api.settings.ragValidate(cfg)
      if (res.ok) {
        if (res.info?.defaultCollectionExists === false) {
          message.warning('连通成功，但默认集合不存在')
        } else {
          message.success('连接正常')
        }
      } else {
        message.error(res.errors?.[0] || '校验失败')
      }
    } catch (e) {
      message.error('校验异常')
    } finally {
      setRagValidating(false)
    }
  }

  const onRagSubmit = async (): Promise<void> => {
    try {
      const values = await ragForm.validateFields()
      const payload: VectorDbConfig = {
        id: ragEditing?.id || '',
        name: (values.name || '').trim(),
        provider: 'chroma',
        enabled: Boolean(values.enabled ?? true),
        isDefault: Boolean(values.isDefault),
        connection: { url: (values.connection?.url || '').trim() },
        storage: {
          rootDir: (values.storage?.rootDir || '').trim(),
          rawDir: (values.storage?.rawDir || '').trim()
        },
        defaultCollection: (values.defaultCollection || '').trim() || undefined,
        embeddings: values.embeddings
          ? {
              provider: values.embeddings.provider,
              model: (values.embeddings.model || '').trim() || undefined,
              apiKey: (values.embeddings.apiKey || '').trim() || undefined
            }
          : { provider: 'openai', model: 'text-embedding-3-small' },
        retriever: {
          k: typeof values.retriever?.k === 'number' ? values.retriever.k : 4,
          searchType: values.retriever?.searchType === 'mmr' ? 'mmr' : 'similarity',
          mmrLambda: typeof values.retriever?.mmrLambda === 'number' ? values.retriever.mmrLambda : 0.5,
          fetchK: typeof values.retriever?.fetchK === 'number' ? values.retriever.fetchK : 32
        },
        updatedAt: Date.now()
      }
      await window.api.settings.ragUpsert(payload)
      setRagModalOpen(false)
      message.success(ragEditing ? '已更新' : '已新增')
      loadRag()
    } catch (e) {
      // 表单校验失败或请求失败
    }
  }

  // ---------------- RAG：导入文件/目录 ----------------
  const onRagImportFile = async (cfg: VectorDbConfig): Promise<void> => {
    try {
      const picked = await window.api.util.pickFile({
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Documents', extensions: ['md', 'txt', 'pdf', 'docx'] },
          { name: 'Code Files', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'sol'] }
        ]
      })
      if (!picked) return
      setImportMode('file')
      setImportTarget(cfg)
      setImportPath(picked)
      importForm.setFieldsValue({
        collection: cfg.defaultCollection || '',
        chunkSize: 1000,
        chunkOverlap: 150,
        parseMethod: 'auto'
      })
      setImportModalOpen(true)
    } catch (e) {
      message.error('选择文件失败')
    }
  }

  const onRagImportDir = async (cfg: VectorDbConfig): Promise<void> => {
    try {
      const picked = await window.api.util.pickDirectory()
      if (!picked) return
      setImportMode('dir')
      setImportTarget(cfg)
      setImportPath(picked)
      importForm.setFieldsValue({
        collection: cfg.defaultCollection || '',
        chunkSize: 1000,
        chunkOverlap: 150,
        parseMethod: 'auto'
      })
      setImportModalOpen(true)
    } catch (e) {
      message.error('选择目录失败')
    }
  }

  const handleImportOk = async (): Promise<void> => {
    try {
      setImportLoading(true)
      const values = await importForm.validateFields()
      const cfg = importTarget
      if (!cfg) return
      
      const splitOptions = {
        chunkSize: values.chunkSize,
        chunkOverlap: values.chunkOverlap
      }
      
      const parseOptions = {
        forceMethod: values.parseMethod || 'auto' as 'auto' | 'ast' | 'text'
      }
      const taskId = createImportTaskId()
      importTaskIdRef.current = taskId
      
      if (importMode === 'file') {
        const result = await window.api.settings.ragImportFile(
          cfg.id, 
          importPath, 
          values.collection.trim(), 
          splitOptions,
          parseOptions,
          taskId
        )
        
        Modal.success({
          title: '✅ 文件导入成功',
          content: (
            <div>
              <p>解析方式：{result.method}</p>
              <p>切块数量：{result.chunks}</p>
            </div>
          )
        })
      } else {
        const result = await window.api.settings.ragImportDir(
          cfg.id, 
          importPath, 
          values.collection.trim(), 
          splitOptions,
          parseOptions,
          taskId
        )
        
        Modal.success({
          title: '✅ 目录导入成功',
          content: (
            <div>
              <p>总文件数：{result.total}</p>
              <p>成功处理：{result.processed}</p>
              <p>代码文件：{result.codeFiles}</p>
              <p>文档文件：{result.docFiles}</p>
            </div>
          )
        })
      }
      
      setImportModalOpen(false)
    } catch (e) {
      // 表单校验或调用失败
      if (e instanceof Error && e.message.includes('导入已取消')) {
        message.info('导入已取消')
        setImportModalOpen(false)
      } else if (e instanceof Error) {
        message.error(e.message)
      }
    } finally {
      importTaskIdRef.current = null
      setImportLoading(false)
    }
  }

  /**
   * 关闭导入弹窗。
   *
   * 关键点：导入进行中时，Cancel 不能只关闭 UI，必须向主进程发送真正的取消信号。
   */
  const handleImportCancel = async (): Promise<void> => {
    if (!importLoading) {
      setImportModalOpen(false)
      return
    }

    const taskId = importTaskIdRef.current
    if (!taskId) {
      message.warning('导入任务尚未初始化，请稍后重试')
      return
    }

    try {
      const canceled = await window.api.settings.ragCancelImport(taskId)
      if (canceled) {
        message.info('正在取消导入...')
      } else {
        message.warning('导入任务已结束')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取消导入失败')
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Button type="link" icon={<LeftOutlined />} onClick={() => navigate('/')}>返回</Button>
      <Card title={<span>设置</span>}>
        <Tabs
          items={[
            {
              key: 'models',
              label: '模型配置',
              children: (
                <>
                  <Space direction="vertical" style={{ width: '100%', marginBottom: 24 }}>
                    <Text type="secondary">点击下方按钮在系统默认编辑器中打开配置文件。</Text>
                    <Space>
                      <Button icon={<SettingOutlined />} onClick={() => onOpenAppDataFile('settings.json', '设置文件')}>打开设置文件</Button>
                      <Button icon={<SettingOutlined />} onClick={() => onOpenAppDataFile('mcp.json', 'MCP 配置文件')}>打开 MCP 配置文件</Button>
                    </Space>
                  </Space>
                  <Space style={{ marginBottom: 12 }}>
                    <Upload beforeUpload={beforeUpload} showUploadList={false}>
                      <Button icon={<UploadOutlined />}>导入</Button>
                    </Upload>
                    <Button icon={<DownloadOutlined />} onClick={onExport}>导出</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>新增模型</Button>
                  </Space>
                  <List
                    loading={loading}
                    dataSource={models}
                    renderItem={(item) => {
                      const active = item.id === activeId
                      return (
                        <List.Item
                          actions={[
                            <Button key="active" type={active ? 'primary' : 'default'} icon={<CheckOutlined />} onClick={() => onSetActive(item.id)} disabled={active}>默认</Button>,
                            <Button key="edit" icon={<EditOutlined />} onClick={() => onEdit(item)} />,
                            <Button key="del" icon={<DeleteOutlined />} danger onClick={() => onDelete(item.id)} />
                          ]}
                        >
                          <List.Item.Meta
                            title={<Space>
                              <Text strong>{item.name}</Text>
                              {active && <Text type="success">(当前使用)</Text>}
                              {item.streamingValidation && (
                                <Tooltip title={
                                  item.streamingValidation.supported 
                                    ? `支持流式 - 首个 token 延迟: ${item.streamingValidation.firstTokenLatency || item.streamingValidation.duration}ms`
                                    : `不支持流式 - ${item.streamingValidation.error}`
                                }>
                                  {item.streamingValidation.supported ? (
                                    <Tag icon={<CheckCircleOutlined />} color="success">已验证</Tag>
                                  ) : (
                                    <Tag icon={<CloseCircleOutlined />} color="default">不支持</Tag>
                                  )}
                                </Tooltip>
                              )}
                            </Space>}
                            description={
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <Descriptions size="small" column={3}>
                                  <Descriptions.Item label="模型">{item.model}</Descriptions.Item>
                                  <Descriptions.Item label="Base URL">{item.baseURL || '默认'}</Descriptions.Item>
                                  <Descriptions.Item label="流式输出">
                                    <Tag color={item.streaming ? 'green' : 'default'}>
                                      {item.streaming ? '已开启' : '已关闭'}
                                    </Tag>
                                  </Descriptions.Item>
                                  <Descriptions.Item label="超时(ms)">{item.timeout ?? 60000}</Descriptions.Item>
                                  <Descriptions.Item label="重试">{item.maxRetries ?? 2}</Descriptions.Item>
                                  <Descriptions.Item label="温度">{item.temperature ?? 0}</Descriptions.Item>
                                </Descriptions>
                              </Space>
                            }
                          />
                        </List.Item>
                      )
                    }}
                  />
                </>
              )
            },
            {
              key: 'rag',
              label: 'RAG 数据库',
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={onRagAdd}>新增 RAG 应用</Button>
                  </Space>
                  <List
                    loading={ragLoading}
                    dataSource={ragList}
                    renderItem={(item) => {
                      const isDefault = Boolean(item.isDefault)
                      return (
                        <List.Item
                          actions={[
                            <Switch
                              key="enabled"
                              checked={item.enabled}
                              checkedChildren="启用"
                              unCheckedChildren="禁用"
                              onChange={(checked) => onRagToggleEnabled(item.id, checked)}
                            />,
                            <Button key="default" type={isDefault ? 'primary' : 'default'} icon={<CheckOutlined />} onClick={() => onRagSetDefault(item.id)} disabled={isDefault || !item.enabled}>默认</Button>,
                            <Button key="validate" loading={ragValidating} onClick={() => onRagValidate(item)}>测试连接</Button>,
                            <Button key="edit" icon={<EditOutlined />} onClick={() => onRagEdit(item)} />,
                            <Button key="del" icon={<DeleteOutlined />} danger onClick={() => onRagDelete(item.id)} />
                          ]}
                        >
                          <List.Item.Meta
                            title={<Space>
                              <Text strong>{item.name}</Text>
                              {isDefault && <Tag color="blue">默认</Tag>}
                              <Tag>{item.provider}</Tag>
                              <Tag color={item.enabled ? 'green' : 'default'}>{item.enabled ? '启用' : '禁用'}</Tag>
                            </Space>}
                            description={
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <Descriptions size="small" column={3}>
                                  <Descriptions.Item label="URL">{item.connection?.url}</Descriptions.Item>
                                  <Descriptions.Item label="默认集合">{item.defaultCollection || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="嵌入">{item.embeddings?.provider || 'openai'}{item.embeddings?.model ? ` · ${item.embeddings.model}` : ''}</Descriptions.Item>
                                  <Descriptions.Item label="检索参数">k={item.retriever?.k ?? 4} · {item.retriever?.searchType || 'similarity'} · λ={item.retriever?.mmrLambda ?? 0.5} · fetchK={item.retriever?.fetchK ?? 32}</Descriptions.Item>
                                </Descriptions>
                                <Space>
                                  <Button icon={<FileAddOutlined />} onClick={() => onRagImportFile(item)}>导入文件</Button>
                                  <Button icon={<FolderOpenOutlined />} onClick={() => onRagImportDir(item)}>导入目录</Button>
                                </Space>
                              </Space>
                            }
                          />
                        </List.Item>
                      )
                    }}
                  />
                </>
              )
            }
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑模型配置' : '新增模型配置'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          setConnectionResult(null)
          setPendingStreamingValidation(undefined)
        }}
        onOk={onSubmit}
        okText={editing ? '保存' : '创建'}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ temperature: 0, timeout: 60000, maxRetries: 2, streaming: false }}
          onValuesChange={(changedValues) => {
            setConnectionResult(null)
            if (!Object.prototype.hasOwnProperty.call(changedValues, 'streaming')) {
              setPendingStreamingValidation(undefined)
            }
          }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：默认OpenAI 或 公司网关" />
          </Form.Item>
          <Form.Item name="model" label="模型名" rules={[{ required: true, message: '请输入模型名' }]}>
            <Input placeholder="如：gpt-4o-mini / qwen2.5:7b / deepseek-chat" />
          </Form.Item>
          <Form.Item name="baseURL" label="Base URL（可选）" tooltip="留空走官方默认">
            <Input placeholder="https://api.openai.com/v1 或 你的 /v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key（Bearer）" tooltip="不保存可留空，每次调用走环境变量">
            <Input.Password placeholder="优先使用此 Key，留空走 .env" autoComplete="off" />
          </Form.Item>
          <Form.Item>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                icon={<CheckCircleOutlined />}
                loading={connectionValidating}
                onClick={onValidateConnection}
              >
                验证连接
              </Button>
              {connectionResult && (
                <Alert
                  showIcon
                  type={connectionResult.ok ? 'success' : 'error'}
                  message={connectionResult.ok ? '连接成功' : '连接失败'}
                  description={
                    <Space direction="vertical" size={0}>
                      <Text>{connectionResult.message}</Text>
                      <Text type="secondary">Base URL：{connectionResult.baseURL}</Text>
                      <Text type="secondary">
                        HTTP：{connectionResult.httpStatus ?? '-'} · 耗时：{connectionResult.duration}ms · Key 来源：{formatApiKeySource(connectionResult.apiKeySource)}
                      </Text>
                      {connectionResult.error && (
                        <Text type="secondary">详情：{connectionResult.error}</Text>
                      )}
                    </Space>
                  }
                />
              )}
            </Space>
          </Form.Item>
          <Form.Item name="temperature" label="温度">
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="timeout" label="超时（毫秒）">
            <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxRetries" label="最大重试次数">
            <InputNumber min={0} max={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item 
            name="streaming" 
            label="流式输出" 
            valuePropName="checked"
            tooltip="开启时会自动验证是否支持流式输出"
          >
            <Switch 
              checkedChildren="开启" 
              unCheckedChildren="关闭"
              onChange={onStreamingSwitchChange}
              disabled={validating}
              loading={validating}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入弹窗 */}
      <Modal
        title={`导入${importMode === 'file' ? '文件' : '目录'}`}
        open={importModalOpen}
        onCancel={handleImportCancel}
        onOk={handleImportOk}
        okText="开始导入"
        cancelText={importLoading ? '取消导入' : '取消'}
        confirmLoading={importLoading}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="目标路径">{importPath || '-'}</Descriptions.Item>
            <Descriptions.Item label="RAG 应用">{importTarget?.name || '-'}</Descriptions.Item>
          </Descriptions>
          <Form form={importForm} layout="vertical">
            <Form.Item name="collection" label="集合名称" rules={[{ required: true, message: '请输入集合名称' }]}>
              <Input placeholder="如：mindforge_kb（建议与入库一致）" />
            </Form.Item>
            
            <Divider orientation="left">解析选项</Divider>
            
            <Form.Item 
              name="parseMethod" 
              label="解析方式" 
              initialValue="auto"
              tooltip="自动模式：代码文件使用AST解析（符号级切块），文档文件使用文本切块"
            >
              <Select
                options={[
                  { 
                    label: '🤖 智能识别（推荐）', 
                    value: 'auto',
                  },
                  { 
                    label: '🔧 AST 解析（仅代码）', 
                    value: 'ast',
                  },
                  { 
                    label: '📝 文本切块（通用）', 
                    value: 'text',
                  }
                ]}
                placeholder="选择解析方式"
              />
            </Form.Item>
            
            <Form.Item 
              noStyle 
              shouldUpdate={(prevValues, currentValues) => 
                prevValues.parseMethod !== currentValues.parseMethod
              }
            >
              {({ getFieldValue }) => {
                const method = getFieldValue('parseMethod') || 'auto'
                const showChunkSettings = method === 'text' || method === 'auto'
                
                return showChunkSettings ? (
                  <>
                    <Form.Item name="chunkSize" label="切块大小" initialValue={1000} tooltip="仅对文本切块生效">
                      <InputNumber min={200} max={4000} step={100} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="chunkOverlap" label="切块重叠" initialValue={150} tooltip="仅对文本切块生效">
                      <InputNumber min={0} max={1000} step={50} style={{ width: '100%' }} />
                    </Form.Item>
                  </>
                ) : (
                  <div style={{ padding: '8px 0', color: '#666', fontSize: '12px' }}>
                    💡 AST 模式将自动按代码符号（函数、类等）切块，无需设置切块参数
                  </div>
                )
              }}
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title={ragEditing ? '编辑 RAG 应用' : '新增 RAG 应用'}
        open={ragModalOpen}
        onCancel={() => setRagModalOpen(false)}
        onOk={onRagSubmit}
        okText={ragEditing ? '保存' : '创建'}
      >
        <Form form={ragForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：产品文档库 / 代码库" />
          </Form.Item>
          <Form.Item name="provider" label="Provider">
            <Input disabled value="chroma" />
          </Form.Item>
          <Form.Item name={["connection", "url"]} label="Chroma URL" rules={[{ required: true, message: '请输入 URL' }]}>
            <Input placeholder="http://localhost:8000" />
          </Form.Item>
          <Form.Item name={["storage", "rootDir"]} label="知识库根目录" rules={[{ required: true, message: '请输入目录路径' }]}>
            <Input placeholder="如：E:\\kb_root" />
          </Form.Item>
          <Form.Item name={["storage", "rawDir"]} label="原始文件目录" rules={[{ required: true, message: '请输入目录路径' }]}>
            <Input placeholder="如：E:\\kb_root\\raw" />
          </Form.Item>
          <Form.Item name="defaultCollection" label="默认集合（可选）">
            <Input placeholder="如：mindforge_kb" />
          </Form.Item>

          <Divider orientation="left">Embeddings</Divider>
          <Form.Item name={["embeddings", "provider"]} label="提供商" initialValue="openai" tooltip="向量嵌入模型的提供商">
            <Select
              options={[
                { label: 'OpenAI', value: 'openai' },
                { label: 'Google Gemini', value: 'gemini' }
              ]}
              placeholder="选择提供商"
            />
          </Form.Item>
          <Form.Item 
            noStyle 
            shouldUpdate={(prevValues, currentValues) => 
              prevValues.embeddings?.provider !== currentValues.embeddings?.provider
            }
          >
            {({ getFieldValue }) => {
              const provider = getFieldValue(['embeddings', 'provider']) || 'openai'
              const placeholder = provider === 'openai' 
                ? 'text-embedding-3-small / text-embedding-3-large' 
                : 'text-embedding-004 / embedding-001'
              return (
                <Form.Item name={["embeddings", "model"]} label="模型名" tooltip={provider === 'openai' ? '推荐使用 text-embedding-3-small' : '推荐使用 text-embedding-004'}>
                  <Input placeholder={placeholder} />
                </Form.Item>
              )
            }}
          </Form.Item>
          <Form.Item name={["embeddings", "apiKey"]} label="API Key（可选）">
            <Input.Password placeholder="留空走环境变量或界面模型配置" autoComplete="off" />
          </Form.Item>

          <Divider orientation="left">检索参数</Divider>
          <Form.Item 
            name={["retriever", "k"]} 
            label="k（Top K）" 
            initialValue={4}
            tooltip="返回最相关的Top K个文档块，推荐3-10，默认4"
          >
            <InputNumber min={1} max={50} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item 
            name={["retriever", "searchType"]} 
            label="搜索类型" 
            initialValue="similarity"
            tooltip="similarity适合精准查询，mmr提供多样性避免重复"
          >
            <Select
              options={[
                { label: 'Similarity（相似度）', value: 'similarity' },
                { label: 'MMR（最大边际相关性）', value: 'mmr' }
              ]}
              placeholder="选择搜索类型"
            />
          </Form.Item>
          <Form.Item 
            noStyle 
            shouldUpdate={(prevValues, currentValues) => 
              prevValues.retriever?.searchType !== currentValues.retriever?.searchType
            }
          >
            {({ getFieldValue }) => {
              const searchType = getFieldValue(['retriever', 'searchType']) || 'similarity'
              const isMmr = searchType === 'mmr'
              return (
                <>
                  <Form.Item 
                    name={["retriever", "mmrLambda"]} 
                    label="MMR λ（Lambda）" 
                    initialValue={0.5}
                    tooltip={isMmr ? "平衡相关性和多样性：0=完全多样性，1=完全相关性，推荐0.5-0.7" : "仅在MMR模式下生效"}
                  >
                    <InputNumber 
                      min={0} 
                      max={1} 
                      step={0.1} 
                      style={{ width: '100%' }} 
                      disabled={!isMmr}
                    />
                  </Form.Item>
                  <Form.Item 
                    name={["retriever", "fetchK"]} 
                    label="fetchK" 
                    initialValue={32}
                    tooltip={isMmr ? "MMR候选池大小，推荐k的5-8倍" : "仅在MMR模式下生效"}
                  >
                    <InputNumber 
                      min={1} 
                      max={500} 
                      style={{ width: '100%' }} 
                      disabled={!isMmr}
                    />
                  </Form.Item>
                </>
              )
            }}
          </Form.Item>

          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          <Form.Item name="isDefault" label="设为默认" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
