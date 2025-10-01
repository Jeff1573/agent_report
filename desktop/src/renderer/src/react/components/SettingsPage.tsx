import React, { useEffect, useState } from 'react'
import { Button, Card, Descriptions, Divider, Form, Input, InputNumber, List, Modal, Space, Typography, message, Upload, Tag, Tooltip, Switch } from 'antd'
import { LeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined, UploadOutlined, DownloadOutlined, SettingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import type { ModelConfig } from '../../../../shared/ipc'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate()
  const [models, setModels] = useState<ModelConfig[]>([])
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ModelConfig | null>(null)
  const [validating, setValidating] = useState(false)
  const [form] = Form.useForm<ModelConfig>()

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

  const onAdd = (): void => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const onEdit = (cfg: ModelConfig): void => {
    setEditing(cfg)
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

  const onSubmit = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      // 规范：空 baseURL 不写，走默认；Bearer 仅支持 apiKey
      const payload: ModelConfig = {
        id: editing?.id || '',
        name: values.name.trim(),
        model: values.model.trim(),
        baseURL: (values.baseURL || '').trim() || undefined,
        apiKey: (values.apiKey || '').trim() || undefined,
        temperature: typeof values.temperature === 'number' ? values.temperature : 0,
        timeout: typeof values.timeout === 'number' ? values.timeout : 60000,
        maxRetries: typeof values.maxRetries === 'number' ? values.maxRetries : 2,
        streaming: Boolean(values.streaming),
        updatedAt: Date.now()
      }
      await window.api.settings.upsertModel(payload)
      setModalOpen(false)
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
      const tempConfig: ModelConfig = {
        id: editing?.id || '',
        name: values.name.trim(),
        model: values.model.trim(),
        baseURL: (values.baseURL || '').trim() || undefined,
        apiKey: (values.apiKey || '').trim() || undefined,
        temperature: typeof values.temperature === 'number' ? values.temperature : 0,
        timeout: typeof values.timeout === 'number' ? values.timeout : 60000,
        maxRetries: typeof values.maxRetries === 'number' ? values.maxRetries : 2,
        streaming: true,
        updatedAt: Date.now()
      }

      // 临时保存配置以便验证
      await window.api.settings.upsertModel(tempConfig)
      const modelId = editing?.id || tempConfig.id

      // 执行验证
      const result = await window.api.settings.validateStreaming(modelId)
      
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

      // 重新加载以更新验证结果
      await load()
    } catch (e) {
      message.destroy('validating')
      const errorMsg = e instanceof Error ? e.message : '验证失败'
      message.error(errorMsg)
      form.setFieldValue('streaming', false)
    } finally {
      setValidating(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Button type="link" icon={<LeftOutlined />} onClick={() => navigate('/')}>返回</Button>
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>设置</span>
            <Space>
              <Upload beforeUpload={beforeUpload} showUploadList={false}>
                <Button icon={<UploadOutlined />}>导入</Button>
              </Upload>
              <Button icon={<DownloadOutlined />} onClick={onExport}>导出</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>新增模型</Button>
            </Space>
          </div>
        }
      >
        <Divider orientation="left">配置文件</Divider>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 24 }}>
          <Text type="secondary">
            点击下方按钮在系统默认编辑器中打开配置文件。
          </Text>
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => onOpenAppDataFile('settings.json', '设置文件')}>
              打开设置文件
            </Button>
            <Button icon={<SettingOutlined />} onClick={() => onOpenAppDataFile('mcp.json', 'MCP 配置文件')}>
              打开 MCP 配置文件
            </Button>
          </Space>
        </Space>

        <Divider orientation="left">模型配置</Divider>
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
      </Card>

      <Modal
        title={editing ? '编辑模型配置' : '新增模型配置'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onSubmit}
        okText={editing ? '保存' : '创建'}
      >
        <Form form={form} layout="vertical" initialValues={{ temperature: 0, timeout: 60000, maxRetries: 2, streaming: false }}>
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
    </div>
  )
}



