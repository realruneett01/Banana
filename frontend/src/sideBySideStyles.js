export const FOCUS_CSS = `
  @keyframes diff-focus-pulse {
    0%   { opacity: 1;   r: 0;  }
    40%  { opacity: 0.9; }
    100% { opacity: 0;   r: 40px; }
  }
  .diff-focus-ring {
    pointer-events: none;
    fill: none !important;
    stroke-width: 0.35mm;
  }
  .diff-focus-ring.diff-changed { stroke: #ffff00 !important; }
  .diff-focus-ring.diff-added   { stroke: #00ff66 !important; }
  .diff-focus-ring.diff-deleted { stroke: #ff3366 !important; }
`;

export const DIFF_CSS = `
  .mode-side-by-side .diff-changed,
  .mode-side-by-side .diff-added,
  .mode-side-by-side .diff-deleted {
    opacity: 1 !important;
    filter:  none !important;
  }

  .diff-viewport svg {
    shape-rendering: geometricPrecision;
    text-rendering: geometricPrecision;
  }

  .mode-side-by-side.schematic-mode .diff-unchanged,
  .mode-side-by-side.pcb-mode .diff-unchanged,
  .mode-side-by-side .diff-unchanged {
    opacity: 0.70 !important;
    pointer-events: none;
  }

  .mode-side-by-side .diff-unchanged.diff-open,
  .mode-side-by-side .diff-unchanged:not(.diff-closed):not(g),
  .mode-side-by-side g.diff-open.diff-unchanged > path,
  .mode-side-by-side g.diff-open.diff-unchanged > line,
  .mode-side-by-side g.diff-open.diff-unchanged > polyline,
  .mode-side-by-side path.diff-unchanged:not(.diff-closed),
  .mode-side-by-side line.diff-unchanged,
  .mode-side-by-side polyline.diff-unchanged {
    stroke: #71717a !important;
    fill:   none    !important;
    stroke-width: var(--diff-trace-width, inherit);
  }

  .mode-side-by-side .diff-unchanged.diff-closed:not(.stroked-text),
  .mode-side-by-side .diff-unchanged.diff-closed:not(.stroked-text) * {
    fill:   #52525b !important;
    stroke: none    !important;
  }

  .mode-side-by-side text.diff-unchanged,
  .mode-side-by-side text.diff-unchanged tspan,
  .mode-side-by-side .diff-unchanged text,
  .mode-side-by-side .diff-unchanged tspan {
    fill:   #94a3b8 !important;
    stroke: none    !important;
  }

  .mode-side-by-side .stroked-text.diff-unchanged,
  .mode-side-by-side .stroked-text.diff-unchanged path,
  .mode-side-by-side .stroked-text.diff-unchanged * {
    stroke: #94a3b8 !important;
    fill:   none    !important;
  }

  .mode-side-by-side .diff-changed.diff-open,
  .mode-side-by-side .diff-changed:not(.diff-closed):not(g),
  .mode-side-by-side g.diff-open.diff-changed > path,
  .mode-side-by-side g.diff-open.diff-changed > line,
  .mode-side-by-side g.diff-open.diff-changed > polyline,
  .mode-side-by-side path.diff-changed:not(.diff-closed),
  .mode-side-by-side line.diff-changed,
  .mode-side-by-side polyline.diff-changed {
    stroke: #ffff00 !important;
    fill:   none    !important;
    stroke-width: var(--diff-trace-width, inherit);
  }
  .mode-side-by-side .diff-changed.diff-closed:not(.stroked-text):not(.diff-focus-ring),
  .mode-side-by-side .diff-changed.diff-closed:not(.stroked-text):not(.diff-focus-ring) *:not(.diff-focus-ring) {
    fill:   #ffff00 !important;
    stroke: none    !important;
  }
  .mode-side-by-side [class*="CrtYd"],
  .mode-side-by-side [class*="courtyard"] {
    fill: none !important;
  }
  .mode-side-by-side text.diff-changed,
  .mode-side-by-side text.diff-changed tspan,
  .mode-side-by-side .diff-changed text,
  .mode-side-by-side .diff-changed tspan {
    fill:   #ffff00 !important;
    stroke: none    !important;
  }
  .mode-side-by-side .stroked-text.diff-changed,
  .mode-side-by-side .stroked-text.diff-changed path,
  .mode-side-by-side .stroked-text.diff-changed * {
    stroke: #ffff00 !important;
    fill:   none    !important;
  }

  .mode-side-by-side .diff-added.diff-open,
  .mode-side-by-side .diff-added:not(.diff-closed):not(g),
  .mode-side-by-side g.diff-open.diff-added > path,
  .mode-side-by-side g.diff-open.diff-added > line,
  .mode-side-by-side g.diff-open.diff-added > polyline,
  .mode-side-by-side path.diff-added:not(.diff-closed),
  .mode-side-by-side line.diff-added,
  .mode-side-by-side polyline.diff-added {
    stroke: #00ff66 !important;
    fill:   none    !important;
    stroke-width: var(--diff-trace-width, inherit);
  }
  .mode-side-by-side .diff-added.diff-closed:not(.stroked-text):not(.diff-focus-ring),
  .mode-side-by-side .diff-added.diff-closed:not(.stroked-text):not(.diff-focus-ring) *:not(.diff-focus-ring) {
    fill:   #00ff66 !important;
    stroke: none    !important;
  }
  .mode-side-by-side text.diff-added,
  .mode-side-by-side text.diff-added tspan,
  .mode-side-by-side .diff-added text,
  .mode-side-by-side .diff-added tspan {
    fill:   #00ff66 !important;
    stroke: none    !important;
  }
  .mode-side-by-side .stroked-text.diff-added,
  .mode-side-by-side .stroked-text.diff-added path,
  .mode-side-by-side .stroked-text.diff-added * {
    stroke: #00ff66 !important;
    fill:   none    !important;
  }

  .mode-side-by-side .diff-deleted.diff-open,
  .mode-side-by-side .diff-deleted:not(.diff-closed):not(g),
  .mode-side-by-side g.diff-open.diff-deleted > path,
  .mode-side-by-side g.diff-open.diff-deleted > line,
  .mode-side-by-side g.diff-open.diff-deleted > polyline,
  .mode-side-by-side path.diff-deleted:not(.diff-closed),
  .mode-side-by-side line.diff-deleted,
  .mode-side-by-side polyline.diff-deleted {
    stroke: #ff3366 !important;
    fill:   none    !important;
    stroke-width: var(--diff-trace-width, inherit);
  }
  .mode-side-by-side .diff-deleted.diff-closed:not(.stroked-text):not(.diff-focus-ring),
  .mode-side-by-side .diff-deleted.diff-closed:not(.stroked-text):not(.diff-focus-ring) *:not(.diff-focus-ring) {
    fill:   #ff3366 !important;
    stroke: none    !important;
  }
  .mode-side-by-side text.diff-deleted,
  .mode-side-by-side text.diff-deleted tspan,
  .mode-side-by-side .diff-deleted text,
  .mode-side-by-side .diff-deleted tspan {
    fill:   #ff3366 !important;
    stroke: none    !important;
  }
  .mode-side-by-side .stroked-text.diff-deleted,
  .mode-side-by-side .stroked-text.diff-deleted path,
  .mode-side-by-side .stroked-text.diff-deleted * {
    stroke: #ff3366 !important;
    fill:   none    !important;
  }

  .mode-side-by-side [data-diff-hovered="true"],
  .mode-side-by-side .diff-highlighted {
    filter: drop-shadow(0 0 6px #ffffff) drop-shadow(0 0 2px #ffffff) !important;
    opacity: 1 !important;
  }

  .diff-focus-ring {
    fill: none !important;
    animation: pulse-ring 2s infinite ease-in-out;
  }

  @keyframes pulse-ring {
    0% { stroke-width: 0.25mm; stroke-opacity: 1; }
    50% { stroke-width: 0.45mm; stroke-opacity: 0.7; }
    100% { stroke-width: 0.25mm; stroke-opacity: 1; }
  }
`;

export const DIFF_CONFIG = {
  MODE_NATIVE: 'inherit',
  DEFAULT_TRACE_WIDTH: 'inherit',
  FALLBACK_TRACE_WIDTH: '0.200mm',
  DEFAULT_TRACE_WIDTH_MM: 0.200,
  DEFAULT_TRACE_WIDTH_MILS: 7.874,
  TRACE_WIDTH_CSS_VAR: '--diff-trace-width',
  MM_TO_MILS: 39.3700787,
  MILS_TO_MM: 0.0254,
  TRACE_WIDTH_PRESETS: [
    { label: 'Native KiCad (Dimension-to-Dimension)', value: 'inherit' },
    { label: '0.200mm (7.9 mils) · Standard Uniform', value: '0.200mm' },
    { label: '0.150mm (5.9 mils)', value: '0.150mm' },
    { label: '0.250mm (9.8 mils)', value: '0.250mm' },
    { label: '0.300mm (11.8 mils)', value: '0.300mm' },
  ],
};
