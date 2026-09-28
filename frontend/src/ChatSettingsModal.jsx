import React, { useEffect, useState } from 'react';
import { Modal, Space, Typography, Input, Button, Divider, Card, Tag } from 'antd';
import { KeyOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

const MODAL_STYLES = {
  content: { background: '#161821', border: '1px solid #232738' },
  header: { background: '#161821', borderBottom: '1px solid #232738' }
};

export default function ChatSettingsModal({ open, onClose, apiKey, activeModel, serverKeyAvailable, onSaveKey }) {
  const [draftKey, setDraftKey] = useState(apiKey);

  useEffect(() => {
    setDraftKey(apiKey);
  }, [apiKey, open]);

  const settingsRows = [
    { label: 'Selected Model:', value: <Tag color="gold">{activeModel}</Tag> },
    { label: 'Free Tier Allowance:', value: <span style={{ color: '#52c41a' }}>1,500 Requests / Day (100% Free)</span> },
    { label: 'Server Fallback Key:', value: serverKeyAvailable ? <Tag color="green">Configured in .env</Tag> : <Tag color="default">Not in .env</Tag> },
    { label: 'Interactive Zoom:', value: <span style={{ color: '#fadb14' }}>Enabled (Click any component badge)</span> }
  ];

  return (
    <Modal
      title={
        <Space>
          <KeyOutlined style={{ color: '#fadb14' }} />
          <span>Copilot AI Configuration</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      styles={MODAL_STYLES}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: '12px' }}>
        <div>
          <Text strong style={{ color: '#fff', fontSize: '13px' }}>Google Gemini API Key (Bring Your Own Key)</Text>
          <Paragraph style={{ color: '#6b6375', fontSize: '12px', margin: '4px 0 8px' }}>
            Your key is stored securely in your local browser and sent directly to your backend. You can get a free API key with 1,500 requests per day at no cost.
          </Paragraph>
          <Input.Password
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="AIzaSy..."
            style={{ background: '#0f1015', borderColor: '#232738', color: '#fff' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#faad14', fontSize: '12px', textDecoration: 'underline' }}
          >
            Get a Free Gemini API Key from Google AI Studio ↗
          </a>
          <Button
            type="primary"
            onClick={() => onSaveKey(draftKey)}
            style={{ background: '#fadb14', borderColor: '#fadb14', color: '#000' }}
          >
            Save Key
          </Button>
        </div>

        <Divider style={{ borderColor: '#232738', margin: '12px 0' }} />

        <Card
          size="small"
          style={{ background: '#0f1015', borderColor: '#232738' }}
          title={<Text strong style={{ color: '#fadb14', fontSize: '12px' }}>Active Model & Free Chat Economics</Text>}
        >
          <Space direction="vertical" size="small" style={{ width: '100%', fontSize: '11px', color: '#a6adbb' }}>
            {settingsRows.map((row) => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{row.label}</span>
                {row.value}
              </div>
            ))}
          </Space>
        </Card>
      </Space>
    </Modal>
  );
}
