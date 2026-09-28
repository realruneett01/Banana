import express from 'express';
import { config } from '../config.js';
import { streamGeminiChat } from '../ai-service.js';

const router = express.Router();

router.get('/status', (req, res) => {
  const serverKeyConfigured = Boolean(config.geminiApiKey || process.env.GEMINI_API_KEY);
  res.json({
    status: 'ok',
    serverKeyConfigured,
    model: config.geminiModel || 'gemini-3-flash-preview',
    kicadVersion: config.kicadVersion || 'unknown',
    kicadCliPath: config.kicadCliPath
  });
});

router.post('/chat', async (req, res) => {
  const { messages, boardContext, model } = req.body;
  const clientApiKey = req.headers['x-gemini-api-key'];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const result = await streamGeminiChat({
      messages: messages || [],
      boardContext: boardContext || {},
      apiKey: clientApiKey,
      model,
      onChunk: (chunk) => {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
    });

    res.write(`data: ${JSON.stringify({ done: true, modelUsed: result.modelUsed })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Banana Copilot] Chat error:', err.message);
    res.write(`data: ${JSON.stringify({
      error: err.message,
      isKeyRequired: err.message.includes('GEMINI_API_KEY_REQUIRED')
    })}\n\n`);
    res.end();
  }
});

export default router;
