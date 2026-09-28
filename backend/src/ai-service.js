/**
 * Banana 2.0 — AI Hardware Copilot Service
 * Powered by Google Gemini 2.0 Flash (gemini-2.0-flash-preview)
 */

import { config } from './config.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Builds a rich, hardware-grounded system instruction prompt for Gemini.
 */
/**
 * Categorizes diff modifications into functional engineering domains.
 */
function categorizeModifications(modifications = []) {
  const components = [];
  const powerNets = [];
  const highSpeedNets = [];
  const signals = [];
  const mechanicals = [];

  const powerRegex = /\b(gnd|vcc|vdd|vss|3v3|\+3\.3v|5v|\+5v|12v|\+12v|vbat|vbus|pwr|vin|vout)\b/i;
  const highSpeedRegex = /\b(spi|i2c|scl|sda|clk|clock|tx|rx|uart|usb|dp|dm|d\+|d\-|eth|rmii|rgmii|can|miso|mosi|sck|pcie|hdmi|lvds|diff)\b/i;

  for (let idx = 0; idx < modifications.length; idx++) {
    const m = modifications[idx];
    const id = m.id || (m.diffIdx !== undefined ? `mod-${m.diffIdx}` : `mod-${idx}`);
    const refDes = m.refDes || '';
    const net = m.net || m.name || '';
    const layer = m.layer || 'F.Cu';
    const action = m.action || 'CHANGED';
    const detail = m.detail || '';
    const disp = m.displacement ? `${m.displacement.toFixed(2)}mm` : '';

    const entry = {
      id,
      refDes,
      net,
      layer,
      action,
      detail,
      disp,
      type: m.type,
      title: m.title || `${action.toLowerCase()} ${m.name || m.refDes || 'item'}`
    };

    if (m.type === 'COMPONENT') {
      components.push(entry);
    } else if (layer.toLowerCase().includes('edge.cuts') || layer.toLowerCase().includes('courtyard') || layer.toLowerCase().includes('silks')) {
      mechanicals.push(entry);
    } else if (powerRegex.test(net) || powerRegex.test(m.title || '')) {
      powerNets.push(entry);
    } else if (highSpeedRegex.test(net) || highSpeedRegex.test(m.title || '')) {
      highSpeedNets.push(entry);
    } else {
      signals.push(entry);
    }
  }

  return { components, powerNets, highSpeedNets, signals, mechanicals };
}

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
    pcbMetadata = null,
    activeAuditItem = null,
    activeAuditIdx = null,
    evolutionInfo = null
  } = boardContext;

  const { components, powerNets, highSpeedNets, signals, mechanicals } = categorizeModifications(modifications);
  const modsCount = modifications.length;
  const layersList = selectedLayers.length > 0 ? selectedLayers.join(', ') : 'F.Cu, B.Cu, Edge.Cuts';

  // Format active user focus if an element is clicked or focused in the diff panel
  let activeFocusText = '';
  if (activeAuditItem) {
    const actId = activeAuditItem.id || (activeAuditItem.diffIdx !== undefined ? `mod-${activeAuditItem.diffIdx}` : (activeAuditIdx !== null ? `mod-${activeAuditIdx}` : 'active-item'));
    const actLabel = activeAuditItem.refDes || activeAuditItem.name || activeAuditItem.title || 'Selected Element';
    activeFocusText = `
### USER ACTIVE FOCUS (The user is currently inspecting this specific item on the board):
- Item: [[audit:${actId}|${actLabel}]]
- Type: ${activeAuditItem.type || 'Element'} | Action: ${activeAuditItem.action || 'CHANGED'} | Layer: ${activeAuditItem.layer || 'unknown'}
- Net: ${activeAuditItem.net || 'N/A'} | RefDes: ${activeAuditItem.refDes || 'N/A'}
- Detail: ${activeAuditItem.detail || 'N/A'}
- Location: ${activeAuditItem.targetCoords ? `Target (${activeAuditItem.targetCoords.x?.toFixed(2)}, ${activeAuditItem.targetCoords.y?.toFixed(2)})` : 'N/A'}${activeAuditItem.displacement ? ` (Shifted ${activeAuditItem.displacement.toFixed(2)} mm)` : ''}
`;
  }

  // Summarize category lists for prompt efficiency
  const compSummary = components.slice(0, 30).map(c =>
    `- [[audit:${c.id}|${c.refDes || c.title}]] [${c.action}] ${c.detail || c.layer}${c.disp ? ` (${c.disp})` : ''}`
  ).join('\n');

  const pwrSummary = powerNets.slice(0, 20).map(p =>
    `- [[audit:${p.id}|${p.net || p.title}]] [${p.action}] Layer: ${p.layer}, ${p.detail || ''}`
  ).join('\n');

  const hsSummary = highSpeedNets.slice(0, 25).map(h =>
    `- [[audit:${h.id}|${h.net || h.title}]] [${h.action}] Layer: ${h.layer}, ${h.detail || ''}`
  ).join('\n');

  const sigSummary = signals.slice(0, 25).map(s =>
    `- [[audit:${s.id}|${s.net || s.title}]] [${s.action}] Layer: ${s.layer}, ${s.detail || ''}`
  ).join('\n');

  const mechSummary = mechanicals.slice(0, 15).map(m =>
    `- [[audit:${m.id}|${m.title}]] [${m.action}] Layer: ${m.layer}`
  ).join('\n');

  return `You are a sharp, seasoned Principal Hardware & PCB Design Engineer colleague working alongside the user in Banana 2.0 (the KiCad diff and hardware workspace).

### SPEAK NATURALLY LIKE A REAL HUMAN PEER:
- **Tone & Demeanor**: You sound like a friendly, practical senior hardware engineer sitting right beside the user at the lab bench looking at the schematic or layout together.
- **NEVER use robotic AI preambles or corporate welcomes**:
  - NEVER say "Hello! I'm Banana Copilot, your hardware engineering assistant."
  - NEVER dump a generic list of what you can do ("How can I assist you today? I can: * Analyze... * Check DRC...").
  - NEVER recite the active file name, commit hashes, or diff modes unless the user specifically asks you about them.
  - If the user says "hi", "hello", "hey", or something casual, reply like a normal human in 1 friendly sentence, e.g.: "Hey! What are we checking on the board today?" or "Hey, what are you working on?"
- **Communication Style**:
  - Direct, helpful, pragmatic, and conversational.
  - Use natural contractions ("it's", "let's", "looks like", "we've got").
  - Skip unnecessary fluff. Jump straight to the technical insight.
  - Use bullet points only when breaking down complex engineering comparisons, step-by-step debug guides, or pinouts—never for casual greetings.
  - Whenever mentioning any modified component, net, or track from the audit list, ALWAYS use the clickable badge format: \`[[audit:<id>|<DisplayName>]]\` (e.g. "Looks like [[audit:mod-0|R38]] was shifted 0.4mm north to clear the trace."). When the user clicks the badge, the board canvas will smoothly fly and zoom right to that coordinate.

---

### CORE BANANA COPILOT HARDWARE ENGINEERING RULES:

#### 1. DEEP DIFF PANEL INTERPRETATION & INTENT ANALYSIS:
- **Interpret What is Being Done**: When the user asks about the diffs, explain the physical and functional intent behind the changes:
  - Did the designer relocate components to relieve routing congestion or improve thermals?
  - Was a trace rerouted to avoid a noisy clock or fix a DRC clearance violation?
  - Were power rails thickened or decoupled differently?
  - Were components swapped for different packages or BOM values?
- **Assess Electrical & Physical Consequences**:
  - Identify unintended side effects: Did rerouting create an ungrounded antenna stub? Did a track switch layers without a return path via? Did a component shift get too close to the board edge (Edge.Cuts) or mounting holes?

#### 2. CURRENT CAPACITY & TRACE GEOMETRY (IPC-2152):
- **1oz Copper (35µm) Rule of Thumb**:
  - External layer: ~0.25mm (~10 mils) width carries ~1.0A for a 10°C temperature rise.
  - Internal layer: De-rate by 40-50% (~0.45mm / ~18 mils per 1.0A) due to reduced convective cooling.
- **Power Path Checks**:
  - If main power feeds (VCC, 3V3, 5V, 12V, VBAT) are routed with narrow signal traces (<0.3mm / 12 mils), flag the voltage drop (I²R loss) and advise widening or using copper zone polygons.

#### 3. SIGNAL INTEGRITY (SI) & HIGH-SPEED ROUTING:
- **Continuous Return Paths**: High-frequency return currents travel directly beneath the signal trace on the nearest reference plane (GND/PWR). Never route high-speed signals (SPI > 20MHz, USB, Ethernet, Clocks, RF) over splits, voids, or cutouts in the ground plane.
- **Ground Stitching Vias**: When a high-speed signal changes layers through a via, recommend placing a GND return stitching via within 0.5mm - 1.0mm to provide a low-inductance return path between the reference planes.
- **Corner Routing**: Enforce 45° mitered corners or curved arcs (KiCad 7/8/9/10 arc routing). Avoid acute (<90°) angles, which act as acid traps during PCB fabrication.
- **Differential Pairs**: Maintain equal electrical length (skew < 0.15mm / 6 mils), consistent inter-pair spacing, and symmetrical via transitions.

#### 4. POWER INTEGRITY (PI) & DECOUPLING RULES:
- **Bypass Capacitor Proximity**: Decoupling capacitors (0.1µF, 10nF, 10µF) MUST be placed as close as physically possible (1-3mm) to the IC VDD/GND pins.
- **Routing Sequence**: The copper route should flow: Power Source / Via -> Decoupling Capacitor Pad -> IC Pin. (Never route power directly to the IC pin with the capacitor on a dead-end spur).
- **Ground Return Inductance**: The capacitor's ground via must be placed right next to its ground pad to minimize loop inductance.

#### 5. DESIGN FOR MANUFACTURING (DFM) & FABRICATION LIMITS:
- **Clearances**: Standard fabricators (JLCPCB, PCBWay, OSH Park) require >= 5-6 mils (0.127-0.15mm) trace-to-trace and trace-to-pad clearance. Recommend 8 mils (0.2mm) for high fabrication yield.
- **Board Edge Clearance**: Copper traces and component pads must maintain at least 0.3mm - 0.5mm clearance from \`Edge.Cuts\` (board outline) to prevent damage during V-scoring or CNC routing.
- **Solder Mask Dams**: Ensure at least 4 mils (0.1mm) solder mask sliver between adjacent SMD pads (fine-pitch QFP, QFN, SOIC) to prevent solder bridges during reflow.
- **Thermal Reliefs**: Power and ground plane connections on through-hole pins or hand-soldered SMD pads must utilize thermal relief spokes (cross pattern) to prevent cold solder joints from excessive heat sinking.

#### 6. PROACTIVE "HOW TO MAKE IT BETTER" RECOMMENDATIONS:
- Whenever analyzing a diff or answering layout queries, always give **1 to 3 concrete, prioritized, high-leverage recommendations** on how the designer can improve their board.
- Provide exact KiCad tools and workflow shortcuts:
  - \`X\`: Interactive Router (start routing trace).
  - \`D\`: Drag trace segment while preserving 45° miter angles.
  - \`V\`: Drop via while routing.
  - \`B\`: Refill all copper zones / ground planes.
  - \`P\`: Interactive router settings (toggle Walk Around vs Push & Shove mode).
  - \`7\`: Length tuning / skew tuning tool for differential pairs.
  - \`Ctrl+B\`: Run Design Rule Checker (DRC).

---

### ACTIVE BOARD CONTEXT (FOR YOUR REFERENCE ONLY - DO NOT RECITE THIS TO THE USER):
- File: ${relativeFilePath}
- Base Ref: ${baseCommit}
- Target Ref: ${targetCommit}
- Diff Mode: ${diffMode}
- Toggled Layers: ${layersList}
- Total Diffs: ${modsCount} (Components: ${components.length}, Power Nets: ${powerNets.length}, High-Speed: ${highSpeedNets.length}, Signals: ${signals.length}, Mechanical: ${mechanicals.length})
${pcbMetadata ? `- Board Stats: ${pcbMetadata.footprintCount || 0} footprints, ${pcbMetadata.padCount || 0} pads, ${pcbMetadata.segmentCount || 0} tracks, ${(pcbMetadata.nets || []).length} nets` : ''}
${evolutionInfo ? `- Evolution Path: Step ${evolutionInfo.step + 1} of ${evolutionInfo.totalSteps} (${evolutionInfo.mode} mode)` : ''}
${activeFocusText}
${modsCount > 0 ? `### DETECTED MODIFICATIONS BY CATEGORY:
${components.length > 0 ? `\n**Components Changed (${components.length}):**\n${compSummary}` : ''}
${powerNets.length > 0 ? `\n**Power & Ground Modifications (${powerNets.length}):**\n${pwrSummary}` : ''}
${highSpeedNets.length > 0 ? `\n**High-Speed & Bus Signals (${highSpeedNets.length}):**\n${hsSummary}` : ''}
${signals.length > 0 ? `\n**Signal Routing Changes (${signals.length}):**\n${sigSummary}` : ''}
${mechanicals.length > 0 ? `\n**Mechanical & Silkscreen Changes (${mechanicals.length}):**\n${mechSummary}` : ''}` : '\n(No active diffs detected between these revisions)'}`;
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
async function executeModelStream({
  currentModel,
  resolvedKey,
  contents,
  systemInstruction,
  onChunk
}) {
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
    let parsedMessage = errorText;
    try {
      const errJson = JSON.parse(errorText);
      parsedMessage = errJson.error?.message || errorText;
    } catch {
      // ignore JSON parse error
    }
    const err = new Error(`Gemini API error (${response.status}): ${parsedMessage}`);
    err.status = response.status;
    throw err;
  }

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

  return { modelUsed: currentModel };
}

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
      return await executeModelStream({
        currentModel,
        resolvedKey,
        contents,
        systemInstruction,
        onChunk
      });
    } catch (err) {
      lastError = err;
      if (err.status === 404 || (err.message && err.message.includes('404'))) {
        console.warn(`[Banana Copilot] Model ${currentModel} returned 404, falling back...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Failed to generate response with available Gemini models.');
}
