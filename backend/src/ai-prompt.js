/**
 * Banana 2.0 — AI System Prompt Builder & Context Categorizer
 */

export const HARDWARE_ENGINEER_GUIDELINES = `You are a sharp, seasoned Principal Hardware & PCB Design Engineer colleague working alongside the user in Banana 2.0 (the KiCad diff and hardware workspace).

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
`;

export const CATEGORY = Object.freeze({
  COMPONENTS: 'components',
  MECHANICALS: 'mechanicals',
  POWER_NETS: 'powerNets',
  HIGH_SPEED_NETS: 'highSpeedNets',
  SIGNALS: 'signals'
});

export function formatAuditBadge(id, label) {
  return `[[audit:${id}|${label}]]`;
}

export function resolveAuditId(item, idx) {
  if (item.id) return item.id;
  if (item.diffIdx !== undefined) return `mod-${item.diffIdx}`;
  if (idx !== null && idx !== undefined) return `mod-${idx}`;
  return 'active-item';
}

function getCategoryForLayerOrNet(layer, net, title, regexes) {
  const l = (layer ?? '').toLowerCase();
  if (l.includes('edge.cuts') || l.includes('courtyard') || l.includes('silks')) {
    return CATEGORY.MECHANICALS;
  }
  const text = `${net} ${title}`;
  if (regexes.power.test(text)) return CATEGORY.POWER_NETS;
  if (regexes.highSpeed.test(text)) return CATEGORY.HIGH_SPEED_NETS;
  return CATEGORY.SIGNALS;
}

export function determineCategory(m, netContext) {
  if (m.type === 'COMPONENT') return CATEGORY.COMPONENTS;
  return getCategoryForLayerOrNet(m.layer, m.net, m.title ?? '', netContext);
}

function extractModificationFields(m, idx) {
  const label = m.name ?? m.refDes ?? 'item';
  const action = m.action ?? 'CHANGED';
  const disp = m.displacement ? `${m.displacement.toFixed(2)}mm` : '';
  const title = m.title ?? `${action.toLowerCase()} ${label}`;

  return {
    id: resolveAuditId(m, idx),
    refDes: m.refDes ?? '',
    net: m.net ?? m.name ?? '',
    layer: m.layer ?? 'F.Cu',
    action,
    detail: m.detail ?? '',
    disp,
    type: m.type,
    title
  };
}

export function categorizeSingleModification(m, idx, netContext) {
  const entry = extractModificationFields(m, idx);
  const category = determineCategory(entry, netContext);
  return { entry, category };
}

export function categorizeModifications(modifications = []) {
  const categories = {
    [CATEGORY.COMPONENTS]: [],
    [CATEGORY.POWER_NETS]: [],
    [CATEGORY.HIGH_SPEED_NETS]: [],
    [CATEGORY.SIGNALS]: [],
    [CATEGORY.MECHANICALS]: []
  };

  const netContext = {
    power: /\b(gnd|vcc|vdd|vss|3v3|\+3\.3v|5v|\+5v|12v|\+12v|vbat|vbus|pwr|vin|vout)\b/i,
    highSpeed: /\b(spi|i2c|scl|sda|clk|clock|tx|rx|uart|usb|dp|dm|d\+|d\-|eth|rmii|rgmii|can|miso|mosi|sck|pcie|hdmi|lvds|diff)\b/i
  };

  for (let idx = 0; idx < modifications.length; idx++) {
    const { entry, category } = categorizeSingleModification(modifications[idx], idx, netContext);
    categories[category].push(entry);
  }

  return categories;
}

function formatFocusCoords(coords) {
  if (coords && typeof coords.x === 'number') {
    return `Target (${coords.x.toFixed(2)}, ${coords.y.toFixed(2)})`;
  }
  return 'N/A';
}

function extractFocusMetadata(item) {
  return {
    label: item.refDes ?? item.name ?? item.title ?? 'Selected Element',
    coords: formatFocusCoords(item.targetCoords),
    shiftText: item.displacement ? ` (Shifted ${item.displacement.toFixed(2)} mm)` : '',
    itemType: item.type ?? 'Element',
    action: item.action ?? 'CHANGED',
    layer: item.layer ?? 'unknown',
    net: item.net ?? 'N/A',
    refDes: item.refDes ?? 'N/A',
    detail: item.detail ?? 'N/A'
  };
}

export function formatActiveFocusText(item, idx) {
  if (!item) return '';
  const actId = resolveAuditId(item, idx);
  const meta = extractFocusMetadata(item);

  return `
### USER ACTIVE FOCUS (The user is currently inspecting this specific item on the board):
- Item: ${formatAuditBadge(actId, meta.label)}
- Type: ${meta.itemType} | Action: ${meta.action} | Layer: ${meta.layer}
- Net: ${meta.net} | RefDes: ${meta.refDes}
- Detail: ${meta.detail}
- Location: ${meta.coords}${meta.shiftText}
`;
}

function formatNetList(list, limit) {
  return list.slice(0, limit).map(item => {
    const label = item.net || item.title;
    const detail = item.detail ? `, ${item.detail}` : '';
    return `- ${formatAuditBadge(item.id, label)} [${item.action}] Layer: ${item.layer}${detail}`;
  }).join('\n');
}

export function formatCategorySummaries({ components, powerNets, highSpeedNets, signals, mechanicals }) {
  const compSummary = components.slice(0, 30).map(c =>
    `- ${formatAuditBadge(c.id, c.refDes || c.title)} [${c.action}] ${c.detail || c.layer}${c.disp ? ` (${c.disp})` : ''}`
  ).join('\n');

  const pwrSummary = formatNetList(powerNets, 20);
  const hsSummary = formatNetList(highSpeedNets, 25);
  const sigSummary = formatNetList(signals, 25);

  const mechSummary = mechanicals.slice(0, 15).map(m =>
    `- ${formatAuditBadge(m.id, m.title)} [${m.action}] Layer: ${m.layer}`
  ).join('\n');

  return { compSummary, pwrSummary, hsSummary, sigSummary, mechSummary };
}

function formatModificationsSection(modsCount, categories, summaries) {
  if (modsCount === 0) {
    return '\n(No active diffs detected between these revisions)';
  }
  const { components, powerNets, highSpeedNets, signals, mechanicals } = categories;
  const { compSummary, pwrSummary, hsSummary, sigSummary, mechSummary } = summaries;
  const sections = [];

  if (components.length > 0) sections.push(`**Components Changed (${components.length}):**\n${compSummary}`);
  if (powerNets.length > 0) sections.push(`**Power & Ground Modifications (${powerNets.length}):**\n${pwrSummary}`);
  if (highSpeedNets.length > 0) sections.push(`**High-Speed & Bus Signals (${highSpeedNets.length}):**\n${hsSummary}`);
  if (signals.length > 0) sections.push(`**Signal Routing Changes (${signals.length}):**\n${sigSummary}`);
  if (mechanicals.length > 0) sections.push(`**Mechanical & Silkscreen Changes (${mechanicals.length}):**\n${mechSummary}`);

  return `### DETECTED MODIFICATIONS BY CATEGORY:\n` + sections.join('\n\n');
}

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

  const categories = categorizeModifications(modifications);
  const modsCount = modifications.length;
  const layersList = selectedLayers.length > 0 ? selectedLayers.join(', ') : 'F.Cu, B.Cu, Edge.Cuts';
  const activeFocusText = formatActiveFocusText(activeAuditItem, activeAuditIdx);
  const summaries = formatCategorySummaries(categories);
  const modsSection = formatModificationsSection(modsCount, categories, summaries);

  const stats = pcbMetadata
    ? `- Board Stats: ${pcbMetadata.footprintCount || 0} footprints, ${pcbMetadata.padCount || 0} pads, ${pcbMetadata.segmentCount || 0} tracks, ${(pcbMetadata.nets || []).length} nets\n`
    : '';
  const evolution = evolutionInfo
    ? `- Evolution Path: Step ${evolutionInfo.step + 1} of ${evolutionInfo.totalSteps} (${evolutionInfo.mode} mode)\n`
    : '';

  return `${HARDWARE_ENGINEER_GUIDELINES}

---

### ACTIVE BOARD CONTEXT (FOR YOUR REFERENCE ONLY - DO NOT RECITE THIS TO THE USER):
- File: ${relativeFilePath}
- Base Ref: ${baseCommit}
- Target Ref: ${targetCommit}
- Diff Mode: ${diffMode}
- Toggled Layers: ${layersList}
- Total Diffs: ${modsCount} (Components: ${categories.components.length}, Power Nets: ${categories.powerNets.length}, High-Speed: ${categories.highSpeedNets.length}, Signals: ${categories.signals.length}, Mechanical: ${categories.mechanicals.length})
${stats}${evolution}${activeFocusText}
${modsSection}`;
}
