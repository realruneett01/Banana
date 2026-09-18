/**
 * Banana 2.0 — AI Hardware Copilot Service
 * Powered by Google Gemini 2.0 Flash (gemini-2.0-flash-preview)
 */

import { config } from './config.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Builds a rich, hardware-grounded system instruction prompt for Gemini.
 */
export function buildSystemPrompt(boardContext = {}) {
  const {
    relativeFilePath = 'No board loaded',
    baseCommit = 'N/A',
    targetCommit = 'N/A',
    selectedLayers = [],
    diffMode = 'Overlay Slider',
    modifications = [],
    pcbMetadata = null
  } = boardContext;

  // Summarize modifications for prompt efficiency (cap at top 80 to prevent excessive tokens)
  const modsCount = modifications.length;
  const modsSummary = modifications.slice(0, 80).map((m, idx) => {
    const id = m.id || `mod-${idx}`;
    const tag = m.tag || 'item';
    const layer = m.layer || 'unknown';
    const label = m.label || m.text || '';
    const net = m.net || m.netName || '';
    const type = m.type || 'modified';
    return `- [${id}] Type: ${type}, Layer: ${layer}, Label: "${label}"${net ? `, Net: "${net}"` : ''}`;
  }).join('\n');

  const layersList = selectedLayers.length > 0 ? selectedLayers.join(', ') : 'F.Cu, Edge.Cuts';

  return `You are a sharp, experienced hardware engineer colleague working alongside the user in Banana 2.0 (the KiCad diff and hardware workspace).

### SPEAK NATURALLY LIKE A REAL HUMAN PEER:
- **Talk normally like a person, not a corporate robot**: You sound like a friendly, smart senior hardware engineer sitting right beside the user at the lab bench looking at the schematic or layout together.
- **NEVER use robotic AI preambles or introductions**:
  - NEVER say "Hello! I'm Banana Copilot, your hardware engineering assistant."
  - NEVER dump a bulleted list of what you can do ("How can I assist you today? I can: * Analyze... * Explain... * Hardware...").
  - NEVER recite the active file name, commit hashes, or diff modes unless the user specifically asks you about them. The user already knows what they loaded.
  - If the user says "hi", "hello", "hey", or something casual, reply like a normal person in 1 friendly sentence, e.g.: "Hey! What are we checking on the board today?" or "Hey, what are you working on?"
- **Tone & Style**:
  - Direct, helpful, pragmatic, and conversational.
  - Use natural contractions ("it's", "let's", "looks like", "we've got").
  - Skip unnecessary fluff. Jump straight to the point.
  - Only use bullet points when explaining complex technical comparisons, step-by-step debug guides, or pinouts—never for greetings or casual conversation.
  - When mentioning a modified component or track from the audit list, use the clickable badge format: \`[[audit:<id>|<DisplayName>]]\` (e.g. "Looks like [[audit:mod-0|R38]] was shifted 0.4mm north to clear the trace.").

### WORKSPACE KNOWLEDGE & MODES:
1. **Normal Chat Mode**:
   - Conversational hardware Q&A, explaining detected diffs, checking DRC risks, IPC-2152 trace current calculations, differential pairs, high-speed return paths, and KiCad features (Side-by-Side, Overlay Slider, Color Delta Map, Layer Soloing).
2. **Builder Mode**:
   - Autonomous circuit synthesizer using Gemini 3 Flash + TypeSafe AI Jev evaluate. When the user asks to design or build a circuit, you can suggest switching to Builder mode or help them specify it.

### ACTIVE BOARD CONTEXT (FOR YOUR REFERENCE ONLY - DO NOT RECITE THIS TO THE USER):
- Active Design: ${relativeFilePath}
- Base Commit: ${baseCommit}
- Target Commit: ${targetCommit}
- Active Diff Mode: ${diffMode}
- Selected Layers: ${layersList}
- Total Detected Diffs: ${modsCount}
${modsCount > 0 ? `\nDetected Modifications:\n${modsSummary}` : '\n(No active diffs loaded)'}`;
}

/**
 * Streams chat responses from Google Gemini 2.0 Flash.
 *
 * @param {Object} options
 * @param {Array} options.messages Array of { role: 'user' | 'model', content: string }
 * @param {Object} options.boardContext Current PCB diff state
 * @param {string} [options.apiKey] Gemini API key (defaults to env)
 * @param {string} [options.model] Gemini model name (defaults to gemini-2.0-flash-preview)
 * @param {Function} options.onChunk Callback invoked with text delta
 */
export async function streamGeminiChat({
  messages = [],
  boardContext = {},
  apiKey = null,
  model = null,
  onChunk
}) {
  const resolvedKey = apiKey || config.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!resolvedKey || resolvedKey.trim() === '') {
    throw new Error(
      'GEMINI_API_KEY_REQUIRED: No Gemini API key provided. Please enter your Gemini API key in the Copilot Settings or add GEMINI_API_KEY to backend/.env.'
    );
  }

  let targetModel = (model || config.geminiModel || 'gemini-3-flash-preview').trim();
  // Handle typo normalization (e.g. preievew -> preview)
  if (targetModel.includes('preievew')) {
    targetModel = targetModel.replace('preievew', 'preview');
  }

  // Strictly use gemini-3-flash-preview first
  const modelsToTry = [targetModel];
  if (targetModel === 'gemini-3-flash-preview') {
    modelsToTry.push('gemini-3-flash', 'gemini-2.0-flash-preview', 'gemini-2.0-flash');
  } else {
    modelsToTry.push('gemini-3-flash-preview', 'gemini-2.0-flash-preview');
  }

  const systemInstruction = buildSystemPrompt(boardContext);

  // Convert incoming messages to Gemini contents format
  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.content || msg.text || '' }]
  }));

  let lastError = null;

  for (const currentModel of modelsToTry) {
    try {
      const url = `${GEMINI_API_BASE}/models/${currentModel}:streamGenerateContent?key=${encodeURIComponent(resolvedKey)}&alt=sse`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
            topP: 0.95
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        // If 404 model not found, try next fallback model
        if (response.status === 404 && modelsToTry.indexOf(currentModel) < modelsToTry.length - 1) {
          console.warn(`[Banana Copilot] Model ${currentModel} returned 404, falling back...`);
          continue;
        }
        let parsedMessage = errorText;
        try {
          const errJson = JSON.parse(errorText);
          parsedMessage = errJson.error?.message || errorText;
        } catch {
          // ignore JSON parse error
        }
        throw new Error(`Gemini API error (${response.status}): ${parsedMessage}`);
      }

      // Stream SSE data
      const reader = response.body.getReader();
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
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textChunk && onChunk) {
              onChunk(textChunk);
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }

      // Successful completion
      return { modelUsed: currentModel };
    } catch (err) {
      lastError = err;
      if (err.message && err.message.includes('404')) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Failed to generate response with available Gemini models.');
}
