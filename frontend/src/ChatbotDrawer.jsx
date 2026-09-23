import React, { useState, useEffect, useRef } from 'react';
import {
  Drawer,
  Button,
  Input,
  Space,
  Typography,
  Tag,
  Tooltip,
  Modal,
  Badge,
  Alert,
  Divider,
  Card
} from 'antd';
import {
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  DeleteOutlined,
  CloseOutlined,
  KeyOutlined,
  ThunderboltOutlined,
  BulbOutlined,
  AimOutlined,
  CheckCircleFilled,
  ExclamationCircleFilled,
  CompassOutlined,
  SafetyCertificateOutlined,
  FileSearchOutlined,
  MessageOutlined
} from '@ant-design/icons';
import { API_BASE_URL } from './config.js';

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

// Pre-defined quick prompt templates for Hardware Copilot
const QUICK_PROMPTS = [
  {
    icon: <AimOutlined />,
    label: 'Explain detected diffs',
    prompt: 'Explain all the detected changes on this PCB and summarize what got added, deleted, or shifted.'
  },
  {
    icon: <SafetyCertificateOutlined />,
    label: 'Check DRC & clearance risks',
    prompt: 'Are there any potential DRC, clearance, or solder bridge risks caused by the recent track and component shifts?'
  },
  {
    icon: <CompassOutlined />,
    label: 'How do diff modes work?',
    prompt: 'How do the 3 diff modes in Banana 2.0 (Side-by-Side, Overlay Slider, Color Delta Map) work and when should I use each?'
  },
  {
    icon: <BulbOutlined />,
    label: 'Trace width & current rules',
    prompt: 'What are the recommended KiCad trace widths and IPC-2152 current carrying limits for power vs signal lines?'
  },
  {
    icon: <FileSearchOutlined />,
    label: 'Copper weight & stackup',
    prompt: 'What are the rules of thumb for 1oz vs 2oz copper weights and controlled impedance routing in high-speed KiCad designs?'
  }
];

export default function ChatbotDrawer({
  open,
  onClose,
  boardContext = {},
  onSelectModification
}) {

  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('banana:chatHistory');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return [
      {
        role: 'model',
        content: `Hey! What are we checking or working on today?`,
        timestamp: Date.now()
      }
    ];
  });

  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('banana:geminiApiKey') || '');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [serverKeyAvailable, setServerKeyAvailable] = useState(false);
  const [activeModel, setActiveModel] = useState('gemini-3-flash-preview');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Check server-side API key configuration on mount
  useEffect(() => {
    checkAiStatus();
  }, []);

  // Save chat history to localStorage
  useEffect(() => {
    try {
      // Keep last 30 messages
      const trimmed = messages.slice(-30);
      localStorage.setItem('banana:chatHistory', JSON.stringify(trimmed));
    } catch (e) {
      // ignore quota errors
    }
  }, [messages]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  const checkAiStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/status`);
      if (res.ok) {
        const data = await res.json();
        setServerKeyAvailable(Boolean(data.serverKeyConfigured));
        if (data.model) setActiveModel(data.model);
      }
    } catch (err) {
      console.warn('[Banana Copilot] Could not check AI status:', err.message);
    }
  };

  const handleSaveApiKey = (key) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    localStorage.setItem('banana:geminiApiKey', trimmed);
    setIsSettingsOpen(false);
  };

  const handleClearHistory = () => {
    const welcomeMsg = [
      {
        role: 'model',
        content: 'Hey! What are we checking or working on today?',
        timestamp: Date.now()
      }
    ];
    setMessages(welcomeMsg);
    localStorage.removeItem('banana:chatHistory');
  };

  const handleSendMessage = async (customPrompt) => {
    const messageToSend = (customPrompt || inputMessage).trim();
    if (!messageToSend || isStreaming) return;

    // Check if key is available anywhere
    const hasKey = Boolean(apiKey || serverKeyAvailable);
    if (!hasKey) {
      setIsSettingsOpen(true);
      return;
    }

    const newMessages = [
      ...messages,
      { role: 'user', content: messageToSend, timestamp: Date.now() }
    ];

    setMessages(newMessages);
    setInputMessage('');
    setIsStreaming(true);

    // Placeholder message for streaming response
    const assistantIndex = newMessages.length;
    setMessages(prev => [
      ...prev,
      { role: 'model', content: '', timestamp: Date.now(), isStreaming: true }
    ]);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['x-gemini-api-key'] = apiKey;
      }

      const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          boardContext: {
            relativeFilePath: boardContext.relativeFilePath,
            baseCommit: boardContext.baseCommit,
            targetCommit: boardContext.targetCommit,
            selectedLayers: boardContext.selectedLayers || [],
            diffMode: boardContext.diffMode,
            modifications: boardContext.modifications || [],
            pcbMetadata: boardContext.pcbMetadata
          },
          model: activeModel
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedText = '';
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.error) {
              if (data.isKeyRequired) {
                accumulatedText += `\n\n⚠️ **API Key Required**: Please provide a Gemini API key in the Copilot Settings.`;
                setIsSettingsOpen(true);
              } else {
                accumulatedText += `\n\n❌ **Error**: ${data.error}`;
              }
              break;
            }

            if (data.text) {
              accumulatedText += data.text;
              setMessages(prev => {
                const copy = [...prev];
                if (copy[assistantIndex]) {
                  copy[assistantIndex] = {
                    ...copy[assistantIndex],
                    content: accumulatedText,
                    isStreaming: true
                  };
                }
                return copy;
              });
            }

            if (data.done) {
              setMessages(prev => {
                const copy = [...prev];
                if (copy[assistantIndex]) {
                  copy[assistantIndex] = {
                    ...copy[assistantIndex],
                    content: accumulatedText,
                    isStreaming: false
                  };
                }
                return copy;
              });
            }
          } catch (e) {
            // ignore malformed JSON chunk
          }
        }
      }

      // Finalize message stream
      setMessages(prev => {
        const copy = [...prev];
        if (copy[assistantIndex]) {
          copy[assistantIndex] = {
            ...copy[assistantIndex],
            content: accumulatedText || '*(Empty response received)*',
            isStreaming: false
          };
        }
        return copy;
      });

    } catch (err) {
      console.error('[Banana Copilot] Error in chat stream:', err);
      setMessages(prev => {
        const copy = [...prev];
        if (copy[assistantIndex]) {
          copy[assistantIndex] = {
            ...copy[assistantIndex],
            content: `❌ **Failed to connect to Banana Copilot**: ${err.message}\n\nPlease check your internet connection or verify your Gemini API key in Copilot Settings.`,
            isStreaming: false
          };
        }
        return copy;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  /**
   * Parses markdown text and converts [[audit:<id>|<name>]] into interactive clickable tags.
   */
  const renderMessageContent = (content) => {
    if (!content) return null;

    // Pattern: [[audit:mod-id|DisplayName]] or [audit:mod-id|DisplayName]
    const auditRegex = /\[\[audit:([^|\]]+)(?:\|([^\]]+))?\]\]|\[audit:([^|\]]+)(?:\|([^\]]+))?\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = auditRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          value: content.substring(lastIndex, match.index)
        });
      }

      const id = match[1] || match[3];
      const label = match[2] || match[4] || id;

      parts.push({
        type: 'audit-tag',
        id,
        label
      });

      lastIndex = auditRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push({
        type: 'text',
        value: content.substring(lastIndex)
      });
    }

    return (
      <div className="copilot-message-body" style={{ fontSize: '13px', lineHeight: '1.6', color: '#e1e7f0' }}>
        {parts.map((part, pIdx) => {
          if (part.type === 'audit-tag') {
            return (
              <Tag
                key={`audit-tag-${pIdx}`}
                color="gold"
                icon={<AimOutlined />}
                style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  margin: '0 3px',
                  boxShadow: '0 0 8px rgba(250, 219, 20, 0.25)',
                  transition: 'all 0.2s'
                }}
                onClick={() => {
                  if (onSelectModification) {
                    onSelectModification(part.id, part.label);
                  }
                }}
                title={`Click to zoom directly to ${part.label} on board`}
              >
                {part.label}
              </Tag>
            );
          }

          // Format simple markdown blocks (bold, lists, backtick code)
          return (
            <span key={`text-${pIdx}`} style={{ whiteSpace: 'pre-wrap' }}>
              {part.value}
            </span>
          );
        })}
      </div>
    );
  };

  const modsCount = (boardContext.modifications || []).length;
  const isGrounded = Boolean(boardContext.relativeFilePath);

  return (
    <>
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <Space align="center" size="small">
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#000',
                fontWeight: 'bold',
                fontSize: 14,
                boxShadow: '0 0 10px rgba(250, 219, 20, 0.4)'
              }}>
                🍌
              </div>
              <div>
                <Text strong style={{ color: '#fff', fontSize: '14px' }}>Banana Hardware Copilot</Text>
                <div>
                  <Tag color="cyan" style={{ fontSize: '10px', lineHeight: '16px', padding: '0 5px', margin: 0 }}>
                    💬 Hardware Copilot
                  </Tag>
                  <Tag color="gold" style={{ fontSize: '10px', lineHeight: '16px', padding: '0 5px', marginLeft: 4 }}>
                    {activeModel}
                  </Tag>
                  <Tag color="green" style={{ fontSize: '10px', lineHeight: '16px', padding: '0 5px', marginLeft: 4 }}>
                    Unlimited Free
                  </Tag>
                </div>
              </div>
            </Space>

            <Space size="small">
              <Tooltip title="Copilot Settings (API Key & Model)">
                <Button
                  type="text"
                  icon={<SettingOutlined />}
                  onClick={() => setIsSettingsOpen(true)}
                  style={{ color: apiKey || serverKeyAvailable ? '#52c41a' : '#faad14' }}
                />
              </Tooltip>
              <Tooltip title="Clear chat history">
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={handleClearHistory}
                  style={{ color: '#a6adbb' }}
                />
              </Tooltip>
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={onClose}
                style={{ color: '#a6adbb' }}
              />
            </Space>
          </div>
        }
        placement="right"
        width={460}
        onClose={onClose}
        open={open}
        closable={false}
        styles={{
          header: { background: '#161821', borderBottom: '1px solid #232738', padding: '12px 16px' },
          body: {
            background: '#0f1015',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }
        }}
      >
        {/* Hardware Copilot Info Banner */}
        <div style={{
          background: 'rgba(22, 119, 255, 0.08)',
          border: '1px solid rgba(22, 119, 255, 0.25)',
          borderRadius: '6px',
          padding: '6px 10px',
          marginBottom: '8px',
          fontSize: '11px',
          color: '#69b1ff',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <MessageOutlined style={{ fontSize: '13px', flexShrink: 0 }} />
          <span>
            <strong>AI Hardware Copilot</strong>: Grounded in your active PCB diff context. Ask about layout changes, clearance risks, DRC rules, and electronics design.
          </span>
        </div>

        {/* Context Bar */}
        <div style={{
          background: '#161821',
          border: '1px solid #232738',
          borderRadius: '6px',
          padding: '8px 12px',
          marginBottom: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#a6adbb'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <CompassOutlined style={{ color: '#fadb14' }} />
            {isGrounded ? (
              <span>
                <Text strong style={{ color: '#fadb14' }}>{boardContext.relativeFilePath?.split(/[/\\]/).pop()}</Text>
                <span style={{ color: '#6b6375', marginLeft: 4 }}>({modsCount} diffs on {boardContext.diffMode})</span>
              </span>
            ) : (
              <span>No board loaded • General Hardware Assistant</span>
            )}
          </div>
          <Badge
            status={isGrounded ? "success" : "default"}
            text={<span style={{ fontSize: '10px', color: '#6b6375' }}>{isGrounded ? 'Grounded' : 'Ready'}</span>}
          />
        </div>

        {/* API Key Missing Warning Banner */}
        {!apiKey && !serverKeyAvailable && (
          <Alert
            type="warning"
            showIcon
            message="Gemini API Key Needed"
            description={
              <div style={{ fontSize: '11px' }}>
                To start unlimited AI chat, click Settings to paste your Gemini API key (or set <code>GEMINI_API_KEY</code> in backend/.env).
                <div style={{ marginTop: '6px' }}>
                  <Button size="small" type="primary" onClick={() => setIsSettingsOpen(true)}>
                    Configure API Key
                  </Button>
                </div>
              </div>
            }
            style={{ marginBottom: '10px', background: '#1a1813', borderColor: '#d48806' }}
          />
        )}

        {/* Messages Scroll Area */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: '4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={`msg-${idx}`}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start'
                }}
              >
                <div style={{
                  background: isUser ? '#1f2430' : '#161821',
                  border: `1px solid ${isUser ? '#3b4252' : '#232738'}`,
                  borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  padding: '10px 14px',
                  boxShadow: isUser ? 'none' : '0 2px 8px rgba(0,0,0,0.2)'
                }}>
                  {renderMessageContent(msg.content)}
                  {msg.isStreaming && (
                    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="copilot-dot-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#fadb14' }}></span>
                      <Text type="secondary" style={{ fontSize: '11px', color: '#fadb14' }}>Thinking...</Text>
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '10px', color: '#6b6375', marginTop: '3px', padding: '0 4px' }}>
                  {isUser ? 'You' : 'Banana Copilot'}
                </span>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Prompts Carousel/Pills */}
        <div
          className="copilot-prompts-scroll"
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
          style={{
            padding: '8px 0',
            display: 'flex',
            gap: '6px',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            borderTop: '1px solid #1f2330',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}
        >
          {QUICK_PROMPTS.map((qp, qIdx) => (
            <Button
              key={`quick-prompt-${qIdx}`}
              size="small"
              type="dashed"
              icon={qp.icon}
              disabled={isStreaming}
              onClick={() => handleSendMessage(qp.prompt)}
              style={{
                fontSize: '11px',
                borderColor: '#232738',
                color: '#a6adbb',
                borderRadius: '12px',
                background: '#161821'
              }}
            >
              {qp.label}
            </Button>
          ))}
        </div>

        {/* Input Bar */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', paddingTop: '6px' }}>
          <TextArea
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Ask anything about Banana 2.0, PCB diffs, KiCad, or hardware engineering..."
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={isStreaming}
            style={{
              background: '#161821',
              borderColor: '#232738',
              color: '#fff',
              borderRadius: '8px',
              fontSize: '13px'
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={isStreaming}
            disabled={!inputMessage.trim()}
            onClick={() => handleSendMessage()}
            style={{
              height: '38px',
              width: '38px',
              borderRadius: '8px',
              background: '#fadb14',
              borderColor: '#fadb14',
              color: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          />
        </div>
      </Drawer>

      {/* Settings Modal (API Key, Model, Pricing Information) */}
      <Modal
        title={
          <Space>
            <KeyOutlined style={{ color: '#fadb14' }} />
            <span>Copilot AI Configuration</span>
          </Space>
        }
        open={isSettingsOpen}
        onCancel={() => setIsSettingsOpen(false)}
        footer={null}
        styles={{
          content: { background: '#161821', border: '1px solid #232738' },
          header: { background: '#161821', borderBottom: '1px solid #232738' }
        }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: '12px' }}>
          <div>
            <Text strong style={{ color: '#fff', fontSize: '13px' }}>Google Gemini API Key (Bring Your Own Key)</Text>
            <Paragraph style={{ color: '#6b6375', fontSize: '12px', margin: '4px 0 8px' }}>
              Your key is stored securely in your local browser and sent directly to your backend. You can get a free API key with 1,500 requests per day at no cost.
            </Paragraph>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
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
              onClick={() => handleSaveApiKey(apiKey)}
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
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Selected Model:</span>
                <Tag color="gold">{activeModel}</Tag>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Free Tier Allowance:</span>
                <span style={{ color: '#52c41a' }}>1,500 Requests / Day (100% Free)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Server Fallback Key:</span>
                <span>{serverKeyAvailable ? <Tag color="green">Configured in .env</Tag> : <Tag color="default">Not in .env</Tag>}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Interactive Zoom:</span>
                <span style={{ color: '#fadb14' }}>Enabled (Click any component badge)</span>
              </div>
            </Space>
          </Card>
        </Space>
      </Modal>
    </>
  );
}
