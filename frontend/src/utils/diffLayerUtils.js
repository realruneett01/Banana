export const PCB_LAYER_TOKENS = ['_cu', 'silkscreen', 'edge_cuts', 'silks', 'mask', 'paste', 'courtyard'];

export const ALL_PCB_LAYERS = [
  { value: 'F.Cu', label: 'F.Cu (Front Copper)' },
  { value: 'B.Cu', label: 'B.Cu (Back Copper)' },
  { value: 'In1.Cu', label: 'In1.Cu (Inner Copper 1)' },
  { value: 'In2.Cu', label: 'In2.Cu (Inner Copper 2)' },
  { value: 'In3.Cu', label: 'In3.Cu (Inner Copper 3)' },
  { value: 'In4.Cu', label: 'In4.Cu (Inner Copper 4)' },
  { value: 'F.SilkS', label: 'F.SilkS (Front Silkscreen)' },
  { value: 'B.SilkS', label: 'B.SilkS (Back Silkscreen)' },
  { value: 'F.Mask', label: 'F.Mask (Front Solder Mask)' },
  { value: 'B.Mask', label: 'B.Mask (Back Solder Mask)' },
  { value: 'F.Paste', label: 'F.Paste (Front Solder Paste)' },
  { value: 'B.Paste', label: 'B.Paste (Back Solder Paste)' },
  { value: 'F.Adhes', label: 'F.Adhes (Front Adhesive)' },
  { value: 'B.Adhes', label: 'B.Adhes (Back Adhesive)' },
  { value: 'Edge.Cuts', label: 'Edge.Cuts (Board Outline)' },
  { value: 'Margin', label: 'Margin (Board Margin)' },
  { value: 'F.Courtyard', label: 'F.Courtyard (Front Courtyard)' },
  { value: 'B.Courtyard', label: 'B.Courtyard (Back Courtyard)' },
  { value: 'F.Fab', label: 'F.Fab (Front Fabrication)' },
  { value: 'B.Fab', label: 'B.Fab (Back Fabrication)' },
  { value: 'Dwgs.User', label: 'Dwgs.User (Drawings User)' },
  { value: 'Cmts.User', label: 'Cmts.User (Comments User)' },
  { value: 'Eco1.User', label: 'Eco1.User (Eco 1 User)' },
  { value: 'Eco2.User', label: 'Eco2.User (Eco 2 User)' },
  { value: 'User.Drawings', label: 'User.Drawings (Drawings)' },
  { value: 'User.Comments', label: 'User.Comments (Comments)' },
  { value: 'User.Eco1', label: 'User.Eco1 (Eco 1)' },
  { value: 'User.Eco2', label: 'User.Eco2 (Eco 2)' }
];

export function matchLayerName(name, layerStr) {
  const nl = layerStr.replace('.', '_').toLowerCase();
  if (nl === 'f_silks') {
    return name.includes('f_silkscreen') || name.includes('f_silks');
  }
  if (nl === 'b_silks') {
    return name.includes('b_silkscreen') || name.includes('b_silks');
  }
  return name.includes(nl);
}

export function isLayerActive(filename, activeLayers) {
  const name = filename.toLowerCase();
  const isPcbLayer = PCB_LAYER_TOKENS.some((token) => name.includes(token));
  if (!isPcbLayer) return true;
  return activeLayers.some((layer) => matchLayerName(name, layer));
}

export function isLayerSolo(filename, soloLayer) {
  if (!soloLayer) return true;
  const name = filename.toLowerCase();
  return matchLayerName(name, soloLayer);
}

export function getLayerOpacity(filename, layerOpacities) {
  if (!layerOpacities || Object.keys(layerOpacities).length === 0) return 1;
  const name = filename.toLowerCase();
  for (const [layerValue, opacity] of Object.entries(layerOpacities)) {
    if (matchLayerName(name, layerValue)) {
      return opacity;
    }
  }
  return 1;
}

export function resolveLayerVisuals(filename, soloLayer, layerOpacities) {
  const solo = isLayerSolo(filename, soloLayer);
  const greyOut = Boolean(soloLayer && !solo);
  const layerOp = getLayerOpacity(filename, layerOpacities);
  return {
    layerTier: greyOut ? 'layer-background' : 'layer-active',
    opacityStyle: greyOut ? 0.6 : layerOp,
    filterStyle: greyOut ? 'grayscale(1) contrast(0.5)' : 'none'
  };
}

export function applyTransformToDom(element, transform) {
  if (element && transform) {
    element.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  }
}

export function getScreenCoordsFromSvg(viewportContentEl, coords) {
  if (!coords || !viewportContentEl) return null;
  const svg = viewportContentEl.querySelector('svg');
  if (!svg) return null;

  const svgRect = svg.getBoundingClientRect();
  const viewBoxStr = svg.getAttribute('viewBox');
  if (!viewBoxStr) return null;

  const vb = viewBoxStr.split(/[\s,]+/).map(Number);
  if (vb.length < 4 || vb[2] <= 0 || vb[3] <= 0) return null;

  const normX = (coords.x - vb[0]) / vb[2];
  const normY = (coords.y - vb[1]) / vb[3];

  return {
    x: svgRect.left + normX * svgRect.width,
    y: svgRect.top + normY * svgRect.height
  };
}

export function findDiffDomRect(rootEl, diffIdx) {
  if (!rootEl || diffIdx == null) return null;
  const target = rootEl.querySelector(`[data-diff-idx="${diffIdx}"]`);
  return target ? target.getBoundingClientRect() : null;
}

export function createPadLabelProps({ repoPath, baseCommit, targetCommit, relativeFilePath, selectedRemoteRepo, githubToken }) {
  if (!relativeFilePath?.endsWith('.kicad_pcb')) return null;
  return {
    repoPath,
    baseCommit,
    targetCommit,
    relativeFilePath,
    owner: selectedRemoteRepo?.owner,
    repo: selectedRemoteRepo?.name,
    filePath: relativeFilePath,
    githubToken,
  };
}
