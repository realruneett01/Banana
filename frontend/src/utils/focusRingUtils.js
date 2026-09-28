export function createFocusRingElement(cx, cy, r, ringClass) {
  const strokeColor = ringClass === 'diff-added'
    ? '#00ff66'
    : ringClass === 'diff-deleted'
    ? '#ff3366'
    : '#ffff00';

  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  ring.setAttribute('cx', cx);
  ring.setAttribute('cy', cy);
  ring.setAttribute('r', r);
  ring.setAttribute('class', `diff-focus-ring ${ringClass || 'diff-changed'}`);
  ring.setAttribute('style', `stroke: ${strokeColor}; stroke-width: ${Math.max(0.35, r * 0.08)}mm; fill: none !important; pointer-events: none;`);
  return ring;
}

function calcRingGeometry(directCoords, targetElOrRect, svgRect, vb, scale, offset) {
  if (directCoords && typeof directCoords.x === 'number' && typeof directCoords.y === 'number') {
    return { cx: directCoords.x, cy: directCoords.y, r: 3.0 };
  }
  const elRect = targetElOrRect?.getBoundingClientRect?.() || targetElOrRect;
  if (!elRect) return null;
  const cxPx = (elRect.left + elRect.width / 2) - svgRect.left;
  const cyPx = (elRect.top + elRect.height / 2) - svgRect.top;
  const cx = vb[0] + (cxPx - offset.x) / scale;
  const cy = vb[1] + (cyPx - offset.y) / scale;
  const r = Math.max(2.5, Math.min(5.0, Math.max(elRect.width, elRect.height) / (2 * scale) + 1.0));
  return { cx, cy, r };
}

function resolveHostSvg(contentEl, targetElOrRect) {
  if (!contentEl) return null;
  return targetElOrRect instanceof Element
    ? targetElOrRect.closest('svg')
    : contentEl.querySelector('svg');
}

function parseViewBox(hostSvg) {
  const viewBoxStr = hostSvg?.getAttribute('viewBox');
  if (!viewBoxStr) return null;
  const vb = viewBoxStr.split(/[\s,]+/).map(parseFloat);
  return (vb.length >= 4 && vb[2] > 0 && vb[3] > 0) ? vb : null;
}

export function drawFocusRing(contentEl, targetElOrRect, ringClass, directCoords = null) {
  const hostSvg = resolveHostSvg(contentEl, targetElOrRect);
  if (!hostSvg) return;

  const vb = parseViewBox(hostSvg);
  if (!vb) return;

  const svgRect = hostSvg.getBoundingClientRect();
  const scale = Math.min(svgRect.width / vb[2], svgRect.height / vb[3]);
  const offset = {
    x: (svgRect.width - vb[2] * scale) / 2,
    y: (svgRect.height - vb[3] * scale) / 2
  };

  const geom = calcRingGeometry(directCoords, targetElOrRect, svgRect, vb, scale, offset);
  if (!geom) return;

  const ring = createFocusRingElement(geom.cx, geom.cy, geom.r, ringClass);
  hostSvg.appendChild(ring);
  setTimeout(() => ring.remove(), 2500);
}
