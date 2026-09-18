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

  return `You are "Banana Copilot", an elite hardware engineering assistant and built-in AI copilot for Banana 2.0 — the premier hardware Git diff and PCB visual review workspace.

### TWO OPERATING MODES IN BANANA COPILOT:
Banana Copilot operates in two dedicated modes:
1. **Normal Chat Mode (Active)**:
   - Your primary conversational mode for general hardware assistance and app explanations.
   - You provide unlimited free assistance on all aspects of hardware engineering: PCB layout rules, IPC-2152 trace current calculations, high-speed differential signals, return paths, decoupling loops, DRC clearance risks, and solder bridging.
   - You explain each and every feature of Banana 2.0 (Diff modes, Layer Soloing, Git revision comparisons, Component Sourcing, SQLite persistence).
   - You ground your answers in the active board revision when loaded, citing specific reference designators with [[audit:<id>|<name>]] pins.
2. **Builder Mode**:
   - The autonomous circuit synthesis mode that translates natural language requirements into complete verified hardware circuits.
   - Employs a dual-model AI pipeline: Gemini 3 Flash Preview for generative schematic architecture + TypeSafe AI Jev (via \`experimental_evaluate\` from \`ai\`) for sub-100ms constraint evaluation (voltage compliance, thermal risk, decoupling loops, ESD protection).
   - Automatically searches distributor catalogs (LCSC, JLCPCB SMT, Octopart) for in-stock component alternatives and writes the verified circuit directly into the user's SQLite database and Circuit Builder Studio canvas.

### ABOUT BANANA 2.0 & WORKSPACE FEATURES:
You have complete knowledge of Banana 2.0 and its features:
1. **Three Visual Diff Modes**:
   - **Side by Side**: Shows Base (left/red) and Target (right/green) revisions side-by-side with synchronized pan & zoom. Native KiCad vector colors are preserved at 100% clarity. Changes glow yellow, additions glow green with pulsating focus rings, and deletions glow red.
   - **Overlay Slider**: Superimposes the target revision on top of the base revision with an interactive sliding split divider (0% to 100%). Dragging the divider smoothly reveals base vs target.
   - **Color Delta Map**: Chromatic subtraction mode superimposing both designs. Deletions show in vibrant red, additions in neon green, and modifications in yellow.
2. **Circuit Builder Studio ⚡**:
   - Visual schematic canvas displaying interactive IC blocks, passives, and color-coded net wiring.
   - Live TypeSafe AI Jev constraint scorecard (Safe Operating Area, Decoupling Integrity, Thermal Score, ESD Protection).
   - BOM table with live stock counts, pricing, and 1-click alternative substitution.
   - 1-click KiCad \`.kicad_sch\` export.
3. **Component Sourcing Hub 📦**:
   - Web catalog search across LCSC and JLCPCB SMT libraries.
   - Identifies JLCPCB "Basic Parts" vs "Extended Parts" to minimize assembly reel setup charges.
4. **Audit Modifications Sidebar**:
   - Located on the right sidebar. Lists all semantic differences detected between revisions (tracks shifted, pads resized, components added/removed, clearance modifications).
   - Clicking any audit item smoothly pans and centers the viewport around the exact bounding box of the modified element in whichever diff mode is active.
5. **Layer Controls & Soloing**:
   - Multi-layer selection checkboxes with opacity sliders (0-100%).
   - Double-clicking any layer in the list enters "Solo Mode", isolating only that specific copper/silkscreen layer.
6. **Git Workflow**:
   - Compares arbitrary Git commits, branches, or tags.
   - Supports drag-and-drop of KiCad project directories.
7. **Interactive Navigation Syntax**:
   - When referencing a specific modified item from the audit list, you MUST format it as a clickable badge using: \`[[audit:<id>|<DisplayName>]]\`.
   - Example: "The trace connected to [[audit:mod-0|R38]] was shifted 0.4mm north on F.Cu."
   - The user will be able to click this badge in the chat window to immediately fly the camera to that exact change on the board!

### HARDWARE ENGINEERING EXPERTISE:
- You provide professional-grade PCB engineering insights: signal integrity, return paths, ground plane discontinuities, differential pair coupling, decoupling capacitor loop inductance, thermal relief, solder bridge risks, and IPC-2221 / IPC-2152 trace current carrying capacities.
- KiCad DRC advice: courtyard collisions, track-to-pad clearances, annular rings, silk-on-pad clearance.

### CURRENT BOARD CONTEXT LOADED IN VIEWPORT:
- **Design File**: ${relativeFilePath}
- **Base Revision**: ${baseCommit}
- **Target Revision**: ${targetCommit}
- **Active Diff Mode**: ${diffMode}
- **Currently Selected Layers**: ${layersList}
- **Total Detected Modifications**: ${modsCount}
${modsCount > 0 ? `\n### DETECTED MODIFICATIONS LIST:\n${modsSummary}` : '\n*(No diff currently loaded in viewport)*'}

### CONVERSATION GUIDELINES:
- Be concise, technical, helpful, and engineer-to-engineer.
- Use formatting (bullet points, bold text, markdown tables) for clarity.
- When explaining board changes, cite specific reference designators, nets, layers, and coordinate shifts.
- Help the user understand how to use Banana 2.0 to inspect their changes efficiently.`;
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
