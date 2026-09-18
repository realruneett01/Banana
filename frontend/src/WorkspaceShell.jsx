import React from 'react';
import {
  Space,
  Button,
  Select,
  Tag,
  Typography,
  Badge,
  Tooltip
} from 'antd';
import {
  FileSearchOutlined,
  BuildOutlined,
  ShopOutlined,
  DatabaseOutlined,
  RobotOutlined,
  PlusOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';

const { Text, Title } = Typography;

export default function WorkspaceShell({
  activeStudio,
  onSelectStudio,
  circuits = [],
  activeCircuitId,
  onSelectCircuit,
  onNewCircuit,
  onOpenCopilot,
  kicadVersion,
  backendStatus
}) {
  return (
    <div style={{
      background: '#161821',
      borderBottom: '1px solid #232738',
      padding: '0 20px',
      height: '56px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }}>
      {/* Left: Branding + Studio Switcher */}
      <Space size="large" align="center">
        <Space size="small" align="center">
          <div style={{
            width: 30,
            height: 30,
            background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            color: '#000',
            fontSize: 15,
            boxShadow: '0 0 10px rgba(250, 219, 20, 0.4)'
          }}>
            🍌
          </div>
          <div>
            <Title level={5} style={{ margin: 0, color: '#fff', lineHeight: 1.2 }}>Banana 2.0</Title>
            <div style={{ fontSize: '10px', color: '#6b6375', lineHeight: 1 }}>Hardware Workspace</div>
          </div>
        </Space>

        {/* Studio Switcher Buttons */}
        <div style={{
          background: '#0e1017',
          padding: '3px',
          borderRadius: '8px',
          border: '1px solid #232738',
          display: 'flex',
          gap: '4px'
        }}>
          <Button
            size="small"
            type={activeStudio === 'diff' ? 'primary' : 'text'}
            icon={<FileSearchOutlined />}
            onClick={() => onSelectStudio('diff')}
            style={{
              background: activeStudio === 'diff' ? '#fadb14' : 'transparent',
              color: activeStudio === 'diff' ? '#000' : '#a6adbb',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              fontSize: '12px'
            }}
          >
            Visual Diff Studio
          </Button>

          <Button
            size="small"
            type={activeStudio === 'builder' ? 'primary' : 'text'}
            icon={<BuildOutlined />}
            onClick={() => onSelectStudio('builder')}
            style={{
              background: activeStudio === 'builder' ? '#fadb14' : 'transparent',
              color: activeStudio === 'builder' ? '#000' : '#a6adbb',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              fontSize: '12px'
            }}
          >
            Circuit Builder Studio ⚡
          </Button>

          <Button
            size="small"
            type={activeStudio === 'sourcing' ? 'primary' : 'text'}
            icon={<ShopOutlined />}
            onClick={() => onSelectStudio('sourcing')}
            style={{
              background: activeStudio === 'sourcing' ? '#fadb14' : 'transparent',
              color: activeStudio === 'sourcing' ? '#000' : '#a6adbb',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              fontSize: '12px'
            }}
          >
            Sourcing Hub
          </Button>
        </div>
      </Space>

      {/* Center: Active Circuit / Project Selector (when in builder or sourcing mode) */}
      {(activeStudio === 'builder' || activeStudio === 'sourcing') && (
        <Space size="small" align="center">
          <Text type="secondary" style={{ fontSize: '12px' }}>Active Circuit:</Text>
          <Select
            value={activeCircuitId}
            onChange={onSelectCircuit}
            placeholder="Select a saved circuit..."
            style={{ width: 280 }}
            size="small"
          >
            {circuits.map((c) => (
              <Select.Option key={c.id} value={c.id}>
                {c.title} ({c.components?.length || 0} parts)
              </Select.Option>
            ))}
          </Select>
          <Tooltip title="Synthesize new circuit with Autonomous Builder Copilot">
            <Button
              size="small"
              type="primary"
              icon={<BuildOutlined />}
              onClick={onNewCircuit}
              style={{ background: '#fadb14', borderColor: '#fadb14', color: '#000', fontWeight: 600 }}
            >
              Build Circuit ⚡
            </Button>
          </Tooltip>
        </Space>
      )}

      {/* Right: Database Sync Indicator + Copilot Button + Status */}
      <Space size="middle" align="center">
        <Tooltip title="Persistent SQLite database active (auto-saves all circuits and BOMs)">
          <Tag color="green" icon={<DatabaseOutlined />} style={{ margin: 0, fontSize: '11px', padding: '2px 8px' }}>
            SQLite Synced
          </Tag>
        </Tooltip>

        {backendStatus === 'healthy' && (
          <Badge count={`KiCad ${kicadVersion || '10.0'}`} style={{ backgroundColor: '#237804', fontSize: '10px' }} />
        )}

        <Tooltip title="Open Copilot (Normal Chat & Builder Modes)">
          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={() => onOpenCopilot && onOpenCopilot(activeStudio === 'builder' ? 'builder' : 'chat')}
            style={{
              background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
              color: '#000',
              fontWeight: 600,
              border: 'none',
              boxShadow: '0 0 12px rgba(250, 219, 20, 0.35)'
            }}
          >
            Copilot ✨
          </Button>
        </Tooltip>
      </Space>
    </div>
  );
}
