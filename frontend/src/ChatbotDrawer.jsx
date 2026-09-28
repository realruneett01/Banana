import React, { useEffect, useRef } from 'react';
import {
  Drawer,
  Button,
  Input,
  Space,
  Typography,
  Tag,
  Tooltip,
  Badge,
  Alert
} from 'antd';
import {
  SendOutlined,
  SettingOutlined,
  DeleteOutlined,
  CloseOutlined,
  BulbOutlined,
  AimOutlined,
  CompassOutlined,
  SafetyCertificateOutlined,
  FileSearchOutlined,
  MessageOutlined
} from '@ant-design/icons';
import { useChatbotAi } from './useChatbotAi.js';
import ChatSettingsModal from './ChatSettingsModal.jsx';

const { Text } = Typography;
const { TextArea } = Input;

const QUICK_PROMPTS = [
  {
    icon: <AimOutlined />,
    label: 'Explain detected diffs',
    prompt: 'Analyze all detected changes on this PCB: explain what was done, what the electrical and physical changes are, and how I can make the layout better.'
  },
  {
    icon: <SafetyCertificateOutlined />,
    label: 'Check DRC & clearance risks',
    prompt: 'Are there any potential DRC, clearance, or solder bridge risks caused by the recent track and component shifts, and how should I fix them?'
  },
  {
    icon: <BulbOutlined />,
    label: 'Optimize layout & routing',
    prompt: 'Review the current routing and component changes. What are the top 3 concrete improvements I can make to reduce noise, improve return paths, and optimize thermals?'
  },
  {
    icon: <FileSearchOutlined />,
    label: 'Trace width & current rules',
    prompt: 'What are the recommended KiCad trace widths and IPC-2152 current carrying limits for power vs signal lines?'
  },
  {
    icon: <CompassOutlined />,
    label: 'Differential pairs & SI',
    prompt: 'What are the best practices for differential pair length matching, via stitching, and continuous ground return paths in KiCad?'
  }
];

const USER_MSG_THEME = {
  align: 'flex-end',
  bg: '#1f2430',
  border: '#3b4252',
  radius: '12px 12px 2px 12px',
  shadow: 'none',
  author: 'You'
};

const BOT_MSG_THEME = {
  align: 'flex-start',
  bg: '#161821',
  border: '#232738',
  radius: '12px 12px 12px 2px',
  shadow: '0 2px 8px rgba(0,0,0,0.2)',
  author: 'Banana Copilot'
};

const DRAWER_STYLES = {
  header: { background: '#161821', borderBottom: '1px solid #232738', padding: '12px 16px' },
  body: { background: '#0f1015', padding: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
};

function parseAuditMessageContent(content) {
  if (!content) return [];
  const auditRegex = /\[\[audit:([^|\]]+)(?:\|([^\]]+))?\]\]|\[audit:([^|\]]+)(?:\|([^\]]+))?\]/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = auditRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.substring(lastIndex, match.index) });
    }
    const id = match[1] || match[3];
    const label = match[2] || match[4] || id;
    parts.push({ type: 'audit-tag', id, label });
    lastIndex = auditRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.substring(lastIndex) });
  }
  return parts;
}

function MessageBody({ content, onSelectModification }) {
  if (!content) return null;
  const parts = parseAuditMessageContent(content);

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
              onClick={() => onSelectModification?.(part.id, part.label)}
              title={`Click to zoom directly to ${part.label} on board`}
            >
              {part.label}
            </Tag>
          );
        }
        return <span key={`text-${pIdx}`} style={{ whiteSpace: 'pre-wrap' }}>{part.value}</span>;
      })}
    </div>
  );
}

function ChatMessageItem({ msg, onSelectModification }) {
  const theme = msg.role === 'user' ? USER_MSG_THEME : BOT_MSG_THEME;
  return (
    <div style={{ alignSelf: theme.align, maxWidth: '92%', display: 'flex', flexDirection: 'column', alignItems: theme.align }}>
      <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: theme.radius, padding: '10px 14px', boxShadow: theme.shadow }}>
        <MessageBody content={msg.content} onSelectModification={onSelectModification} />
        {msg.isStreaming && (
          <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="copilot-dot-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#fadb14' }} />
            <Text type="secondary" style={{ fontSize: '11px', color: '#fadb14' }}>Thinking...</Text>
          </div>
        )}
      </div>
      <span style={{ fontSize: '10px', color: '#6b6375', marginTop: '3px', padding: '0 4px' }}>
        {theme.author}
      </span>
    </div>
  );
}

function ChatDrawerHeader({ activeModel, apiKey, serverKeyAvailable, onOpenSettings, onClearHistory, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <Space align="center" size="small">
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'linear-gradient(135deg, #fadb14 0%, #faad14 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#000', fontWeight: 'bold', fontSize: 14,
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
            onClick={onOpenSettings}
            style={{ color: apiKey || serverKeyAvailable ? '#52c41a' : '#faad14' }}
          />
        </Tooltip>
        <Tooltip title="Clear chat history">
          <Button
            type="text"
            icon={<DeleteOutlined />}
            onClick={onClearHistory}
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
  );
}

function ChatContextBar({ isGrounded, fileName, modsCount, diffMode }) {
  return (
    <div style={{
      background: '#161821', border: '1px solid #232738', borderRadius: '6px',
      padding: '8px 12px', marginBottom: '10px', display: 'flex',
      alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#a6adbb'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <CompassOutlined style={{ color: '#fadb14' }} />
        {isGrounded ? (
          <span>
            <Text strong style={{ color: '#fadb14' }}>{fileName}</Text>
            <span style={{ color: '#6b6375', marginLeft: 4 }}>({modsCount} diffs on {diffMode})</span>
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
  );
}

function HardwareCopilotBanner() {
  return (
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
  );
}

function MissingApiKeyAlert({ onConfigure }) {
  return (
    <Alert
      type="warning"
      showIcon
      message="Gemini API Key Needed"
      description={
        <div style={{ fontSize: '11px' }}>
          To start unlimited AI chat, click Settings to paste your Gemini API key (or set <code>GEMINI_API_KEY</code> in backend/.env).
          <div style={{ marginTop: '6px' }}>
            <Button size="small" type="primary" onClick={onConfigure}>
              Configure API Key
            </Button>
          </div>
        </div>
      }
      style={{ marginBottom: '10px', background: '#1a1813', borderColor: '#d48806' }}
    />
  );
}

function ChatMessagesList({ messages, onSelectModification, messagesEndRef }) {
  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      paddingRight: '4px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>
      {messages.map((msg, idx) => (
        <ChatMessageItem
          key={`msg-${idx}`}
          msg={msg}
          onSelectModification={onSelectModification}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

function QuickPromptsScroll({ isStreaming, onSelectPrompt }) {
  return (
    <div
      className="copilot-prompts-scroll"
      onWheel={(e) => {
        if (e.deltaY !== 0) {
          e.currentTarget.scrollLeft += e.deltaY;
        }
      }}
      style={{
        padding: '8px 0', display: 'flex', gap: '6px',
        overflowX: 'auto', whiteSpace: 'nowrap', borderTop: '1px solid #1f2330',
        scrollbarWidth: 'none', msOverflowStyle: 'none'
      }}
    >
      {QUICK_PROMPTS.map((qp, qIdx) => (
        <Button
          key={`quick-prompt-${qIdx}`}
          size="small"
          type="dashed"
          icon={qp.icon}
          disabled={isStreaming}
          onClick={() => onSelectPrompt(qp.prompt)}
          style={{
            fontSize: '11px', borderColor: '#232738', color: '#a6adbb',
            borderRadius: '12px', background: '#161821'
          }}
        >
          {qp.label}
        </Button>
      ))}
    </div>
  );
}

function ChatInputBar({ inputRef, inputMessage, onChange, onSend, isStreaming }) {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', paddingTop: '6px' }}>
      <TextArea
        ref={inputRef}
        value={inputMessage}
        onChange={(e) => onChange(e.target.value)}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask anything about Banana 2.0, PCB diffs, KiCad, or hardware engineering..."
        autoSize={{ minRows: 1, maxRows: 4 }}
        disabled={isStreaming}
        style={{
          background: '#161821', borderColor: '#232738', color: '#fff',
          borderRadius: '8px', fontSize: '13px'
        }}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        loading={isStreaming}
        disabled={!inputMessage.trim()}
        onClick={() => onSend()}
        style={{
          height: '38px', width: '38px', borderRadius: '8px',
          background: '#fadb14', borderColor: '#fadb14', color: '#000',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
      />
    </div>
  );
}

function ChatDrawerBody(props) {
  const {
    isGrounded, fileName, modsCount, diffMode, needsKey,
    onConfigureKey, messages, onSelectModification, messagesEndRef,
    isStreaming, onSelectPrompt, inputRef, inputMessage, setInputMessage, onSendMessage
  } = props;

  return (
    <>
      <HardwareCopilotBanner />
      <ChatContextBar isGrounded={isGrounded} fileName={fileName} modsCount={modsCount} diffMode={diffMode} />
      {needsKey && <MissingApiKeyAlert onConfigure={onConfigureKey} />}
      <ChatMessagesList messages={messages} onSelectModification={onSelectModification} messagesEndRef={messagesEndRef} />
      <QuickPromptsScroll isStreaming={isStreaming} onSelectPrompt={onSelectPrompt} />
      <ChatInputBar inputRef={inputRef} inputMessage={inputMessage} onChange={setInputMessage} onSend={onSendMessage} isStreaming={isStreaming} />
    </>
  );
}

export default function ChatbotDrawer({
  open,
  onClose,
  boardContext = {},
  onSelectModification
}) {
  const {
    messages, inputMessage, setInputMessage, isStreaming,
    apiKey, isSettingsOpen, setIsSettingsOpen, serverKeyAvailable,
    activeModel, handleSaveApiKey, handleClearHistory, handleSendMessage
  } = useChatbotAi(boardContext);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  const modsCount = (boardContext.modifications || []).length;
  const isGrounded = Boolean(boardContext.relativeFilePath);
  const fileName = boardContext.relativeFilePath?.split(/[/\\]/).pop();
  const needsKey = !apiKey && !serverKeyAvailable;

  return (
    <>
      <Drawer
        title={
          <ChatDrawerHeader
            activeModel={activeModel}
            apiKey={apiKey}
            serverKeyAvailable={serverKeyAvailable}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onClearHistory={handleClearHistory}
            onClose={onClose}
          />
        }
        placement="right"
        width={460}
        onClose={onClose}
        open={open}
        closable={false}
        styles={DRAWER_STYLES}
      >
        <ChatDrawerBody
          isGrounded={isGrounded}
          fileName={fileName}
          modsCount={modsCount}
          diffMode={boardContext.diffMode}
          needsKey={needsKey}
          onConfigureKey={() => setIsSettingsOpen(true)}
          messages={messages}
          onSelectModification={onSelectModification}
          messagesEndRef={messagesEndRef}
          isStreaming={isStreaming}
          onSelectPrompt={handleSendMessage}
          inputRef={inputRef}
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          onSendMessage={handleSendMessage}
        />
      </Drawer>

      <ChatSettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKey={apiKey}
        activeModel={activeModel}
        serverKeyAvailable={serverKeyAvailable}
        onSaveKey={handleSaveApiKey}
      />
    </>
  );
}
