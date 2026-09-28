import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from './config.js';

const INITIAL_MESSAGE = {
  role: 'model',
  content: 'Hey! What are we checking or working on today?',
  timestamp: Date.now()
};

function loadStoredMessages() {
  const saved = localStorage.getItem('banana:chatHistory');
  if (!saved) return [INITIAL_MESSAGE];
  try {
    return JSON.parse(saved);
  } catch (err) {
    console.debug('[Banana Copilot] Could not restore chat history:', err);
    return [INITIAL_MESSAGE];
  }
}

function buildChatPayload(messages, boardContext, activeModel) {
  return {
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    boardContext: {
      relativeFilePath: boardContext.relativeFilePath,
      baseCommit: boardContext.baseCommit,
      targetCommit: boardContext.targetCommit,
      selectedLayers: boardContext.selectedLayers || [],
      diffMode: boardContext.diffMode,
      modifications: boardContext.modifications || [],
      pcbMetadata: boardContext.pcbMetadata,
      activeAuditIdx: boardContext.activeAuditIdx,
      activeAuditItem: boardContext.activeAuditItem,
      evolutionInfo: boardContext.evolutionInfo,
      telemetry: boardContext.telemetry
    },
    model: activeModel
  };
}

function handleSseChunk(data, callbacks) {
  if (data.error) {
    if (data.isKeyRequired) {
      callbacks.onKeyRequired();
    } else {
      callbacks.onError(data.error);
    }
    return false;
  }
  if (data.text) callbacks.onText(data.text);
  if (data.done) callbacks.onDone();
  return true;
}

async function processSseData(jsonStr, callbacks) {
  try {
    return handleSseChunk(JSON.parse(jsonStr), callbacks);
  } catch (err) {
    console.debug('[Banana Copilot] Malformed SSE chunk ignored:', err);
    return true;
  }
}

async function consumeSseStream(reader, callbacks) {
  const decoder = new TextDecoder('utf-8');
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
      const keepGoing = await processSseData(jsonStr, callbacks);
      if (!keepGoing) return;
    }
  }
}

async function executeAiChatRequest({ apiKey, payload, updateMsg, onKeyRequired }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-gemini-api-key'] = apiKey;

  const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

  const textChunks = [];
  await consumeSseStream(response.body.getReader(), {
    onText: (chunk) => {
      textChunks.push(chunk);
      updateMsg(textChunks.join(''), true);
    },
    onDone: () => updateMsg(textChunks.join(''), false),
    onError: (errMsg) => {
      textChunks.push(`\n\n❌ **Error**: ${errMsg}`);
      updateMsg(textChunks.join(''), false);
    },
    onKeyRequired: () => {
      textChunks.push('\n\n⚠️ **API Key Required**: Please provide a Gemini API key in the Copilot Settings.');
      updateMsg(textChunks.join(''), false);
      onKeyRequired();
    }
  });

  const finalText = textChunks.join('');
  updateMsg(finalText || '*(Empty response received)*', false);
}

async function fetchAiStatus(setServerKeyAvailable, setActiveModel) {
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
}

async function sendAiChatStream({
  messageToSend, apiKey, boardContext, activeModel,
  messages, setMessages, setInputMessage, setIsStreaming, setIsSettingsOpen
}) {
  const newMessages = [...messages, { role: 'user', content: messageToSend, timestamp: Date.now() }];
  setMessages(newMessages);
  setInputMessage('');
  setIsStreaming(true);

  const assistantIndex = newMessages.length;
  setMessages(prev => [...prev, { role: 'model', content: '', timestamp: Date.now(), isStreaming: true }]);

  const updateAssistantMsg = (content, streaming) => {
    setMessages(prev => {
      const copy = [...prev];
      if (copy[assistantIndex]) {
        copy[assistantIndex] = { ...copy[assistantIndex], content, isStreaming: streaming };
      }
      return copy;
    });
  };

  try {
    const payload = buildChatPayload(newMessages, boardContext, activeModel);
    await executeAiChatRequest({
      apiKey,
      payload,
      updateMsg: updateAssistantMsg,
      onKeyRequired: () => setIsSettingsOpen(true)
    });
  } catch (err) {
    console.error('[Banana Copilot] Error in chat stream:', err);
    updateAssistantMsg(`❌ **Failed to connect to Banana Copilot**: ${err.message}\n\nPlease check your internet connection or verify your Gemini API key in Copilot Settings.`, false);
  } finally {
    setIsStreaming(false);
  }
}

export function useChatbotAi(boardContext) {
  const [messages, setMessages] = useState(loadStoredMessages);
  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('banana:geminiApiKey') || '');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [serverKeyAvailable, setServerKeyAvailable] = useState(false);
  const [activeModel, setActiveModel] = useState('gemini-3-flash-preview');

  useEffect(() => {
    fetchAiStatus(setServerKeyAvailable, setActiveModel);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('banana:chatHistory', JSON.stringify(messages.slice(-30)));
    } catch (err) {
      console.debug('[Banana Copilot] Failed to save chat history:', err);
    }
  }, [messages]);

  const handleSaveApiKey = useCallback((key) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    localStorage.setItem('banana:geminiApiKey', trimmed);
    setIsSettingsOpen(false);
  }, []);

  const handleClearHistory = useCallback(() => {
    setMessages([INITIAL_MESSAGE]);
    localStorage.removeItem('banana:chatHistory');
  }, []);

  const handleSendMessage = useCallback(async (customPrompt) => {
    const messageToSend = (customPrompt || inputMessage).trim();
    if (!messageToSend || isStreaming) return;

    if (!apiKey && !serverKeyAvailable) {
      setIsSettingsOpen(true);
      return;
    }

    await sendAiChatStream({
      messageToSend, apiKey, boardContext, activeModel,
      messages, setMessages, setInputMessage, setIsStreaming, setIsSettingsOpen
    });
  }, [inputMessage, isStreaming, apiKey, serverKeyAvailable, messages, boardContext, activeModel]);

  return {
    messages, inputMessage, setInputMessage, isStreaming,
    apiKey, setApiKey, isSettingsOpen, setIsSettingsOpen,
    serverKeyAvailable, activeModel, handleSaveApiKey,
    handleClearHistory, handleSendMessage
  };
}
