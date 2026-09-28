import { useEffect, useState } from 'react';
import { API_BASE_URL } from './config.js';

// ─── Constants ────────────────────────────────────────────────────────────────
// Labels become visible only above this CSS-transform scale value.
// At scale < 3.0 they are illegibly small in mm-space.
const ZOOM_THRESHOLD = 3.0;

const NS = 'http://www.w3.org/2000/svg';

// ─── Overlay SVG Management ───────────────────────────────────────────────────

/**
 * Returns (creating if needed) a dedicated <svg class="pad-label-overlay"> element
 * that is ALWAYS the last child of contentEl.
 *
 * @param {HTMLElement} contentEl
 * @param {string|null} viewBoxStr
 */
function getOrCreateOverlaySvg(contentEl, viewBoxStr) {
  let overlay = contentEl.querySelector('svg.pad-label-overlay');
  const sourceSvg = contentEl.querySelector('svg:not(.pad-label-overlay)');
  const vb = viewBoxStr ?? sourceSvg?.getAttribute('viewBox');

  if (!overlay) {
    overlay = document.createElementNS(NS, 'svg');
    overlay.setAttribute('class', 'pad-label-overlay');
    overlay.setAttribute('xmlns', NS);
    overlay.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'overflow:visible',
    ].join(';');
    contentEl.appendChild(overlay);
  }

  if (vb) overlay.setAttribute('viewBox', vb);
  return overlay;
}

// ─── Layer Matching ────────────────────────────────────────────────────────────

function getPrimaryLayer(padLayers) {
  if (!padLayers || padLayers.length === 0) return null;
  if (padLayers.some(l => l === '*.Cu')) return '*.Cu';
  return padLayers.find(l => l.endsWith('.Cu')) ?? padLayers[0];
}

function isThroughHoleVisible(selectedLayers, soloLayer, layerOpacities) {
  const anySelectedCu = selectedLayers.some(l => l.endsWith('.Cu'));
  if (!anySelectedCu) return false;
  if (soloLayer && !soloLayer.endsWith('.Cu')) return false;
  const proxyLayer = soloLayer ?? 'F.Cu';
  const op = layerOpacities[proxyLayer] ?? 1;
  return op > 0;
}

function isSmdVisible(primary, selectedLayers, soloLayer, layerOpacities) {
  if (!selectedLayers.includes(primary)) return false;
  if (soloLayer && soloLayer !== primary) return false;
  const op = layerOpacities[primary] ?? 1;
  return op > 0;
}

function padShouldShowLabel(padLayers, layerState) {
  const { selectedLayers, soloLayer, layerOpacities } = layerState;
  const primary = getPrimaryLayer(padLayers);
  if (!primary) return false;

  return primary === '*.Cu'
    ? isThroughHoleVisible(selectedLayers, soloLayer, layerOpacities)
    : isSmdVisible(primary, selectedLayers, soloLayer, layerOpacities);
}

// ─── DOM Injection ─────────────────────────────────────────────────────────────

function isMountingHoleFootprint(fp) {
  const refUpper = (fp.ref || '').toUpperCase();
  const valUpper = (fp.value || '').toUpperCase();
  const fpNameUpper = (fp.footprint || '').toUpperCase();
  return (
    /^M?H\d+$/.test(refUpper) ||
    refUpper.startsWith('MOUNT') ||
    valUpper.includes('MOUNTINGHOLE') ||
    fpNameUpper.includes('MOUNTINGHOLE')
  );
}

function computePadLabelLayout(pad) {
  const { x, y } = pad.absAt;
  const minDim = Math.min(pad.size.w ?? 0.5, pad.size.h ?? 0.5);
  const numFontSize = Math.max(0.08, minDim * 0.35);
  const netFontSize = Math.max(0.07, minDim * 0.28);
  const halfGap = (numFontSize + netFontSize) * 0.5;

  const isTallPad = (pad.size.h ?? 0) > (pad.size.w ?? 0);
  let textRotation = isTallPad ? -90 : 0;
  const padRotSnapped = Math.round((pad.absAt.rotation ?? 0) / 90) * 90;
  textRotation = (textRotation + padRotSnapped) % 360;
  if (textRotation > 90 || textRotation < -90) {
    textRotation = (textRotation + 180) % 360;
  }

  let numX = x, numY = y, netX = x, netY = y;
  if (isTallPad) {
    numX = x + halfGap * 0.35;
    netX = x - halfGap * 0.9;
  } else {
    numY = y - halfGap * 0.35;
    netY = y + halfGap * 0.9;
  }

  return { x, y, numX, numY, netX, netY, numFontSize, netFontSize, textRotation };
}

function createSvgTextElement(options) {
  const { x, y, fontSize, color, className, transform } = options;
  const el = document.createElementNS(NS, 'text');
  el.setAttribute('x', x);
  el.setAttribute('y', y);
  el.setAttribute('font-size', fontSize);
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('dominant-baseline', 'central');
  el.setAttribute('fill', color);
  el.setAttribute('font-family', 'monospace, Courier New, monospace');
  el.setAttribute('class', className);
  el.setAttribute('transform', transform);
  return el;
}

function createPadNumberElement({ numX, numY, numFontSize, textRotation, x, y, number }) {
  const transform = `rotate(${textRotation}, ${x}, ${y})`;
  const numEl = createSvgTextElement({
    x: numX,
    y: numY,
    fontSize: numFontSize,
    color: '#fadb14',
    className: 'pad-label pad-label-num',
    transform
  });
  numEl.textContent = number;
  return numEl;
}

function createNetNameElement({ netX, netY, netFontSize, textRotation, x, y, net }) {
  const fullNet = net ?? '';
  const displayNet = fullNet.length > 12 ? fullNet.slice(0, 11) + '\u2026' : fullNet;
  const transform = `rotate(${textRotation}, ${x}, ${y})`;
  const netEl = createSvgTextElement({
    x: netX,
    y: netY,
    fontSize: netFontSize,
    color: '#a6adbb',
    className: 'pad-label pad-label-net',
    transform
  });

  if (fullNet) {
    const titleEl = document.createElementNS(NS, 'title');
    titleEl.textContent = fullNet;
    netEl.appendChild(titleEl);
  }
  netEl.appendChild(document.createTextNode(displayNet));
  return netEl;
}

function renderPadLabel(pad, overlaySvg) {
  const layout = computePadLabelLayout(pad);
  overlaySvg.appendChild(createPadNumberElement({
    ...layout,
    number: pad.number
  }));
  overlaySvg.appendChild(createNetNameElement({
    ...layout,
    net: pad.net
  }));
}

function renderFootprintPads(fp, layerState, overlaySvg) {
  if (isMountingHoleFootprint(fp)) return;

  for (const pad of fp.pads) {
    if (padShouldShowLabel(pad.layers, layerState)) {
      renderPadLabel(pad, overlaySvg);
    }
  }
}

/**
 * Injects <text> pad-label elements into the dedicated overlay SVG inside contentEl.
 */
function injectLabels(contentEl, footprints, layerState) {
  if (!contentEl) return;

  const overlaySvg = getOrCreateOverlaySvg(contentEl, null);
  while (overlaySvg.firstChild) overlaySvg.removeChild(overlaySvg.firstChild);

  if (!footprints?.length) return;

  for (const fp of footprints) {
    renderFootprintPads(fp, layerState, overlaySvg);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

function hasValidRepoTarget(repoPath, owner, repo) {
  return Boolean(repoPath || (owner && repo));
}

function useCommitPads({ repoPath, owner, repo, commit, activeFilePath, githubToken }) {
  const [pads, setPads] = useState(null);

  useEffect(() => {
    if (!hasValidRepoTarget(repoPath, owner, repo) || !commit || !activeFilePath) return;
    let cancelled = false;

    const headers = { 'Content-Type': 'application/json' };
    if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

    fetch(`${API_BASE_URL}/api/board/pads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        repoPath,
        owner,
        repo,
        commit,
        relativeFilePath: activeFilePath,
        filePath: activeFilePath
      }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { if (!cancelled) setPads(d.footprints ?? null); })
      .catch(err => console.warn('[PadLabelOverlay] pad fetch failed:', err));

    return () => { cancelled = true; };
  }, [repoPath, owner, repo, commit, activeFilePath, githubToken]);

  return pads;
}

function useOverlaySync(contentRef, pads, layerState, transformScale) {
  const { selectedLayers, soloLayer, layerOpacities } = layerState;

  useEffect(() => {
    if (contentRef.current && pads) {
      injectLabels(contentRef.current, pads, layerState);
    }
  }, [pads, contentRef, selectedLayers, soloLayer, layerOpacities, layerState]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.classList.toggle(
        'pad-labels-hidden',
        transformScale < ZOOM_THRESHOLD
      );
    }
  }, [transformScale, contentRef]);
}

/**
 * PadLabelOverlay
 *
 * A renderless React component (returns null) that manages pad/net label
 * injection into both diff panels via imperative SVG DOM operations.
 */
export default function PadLabelOverlay({
  repoPath,
  baseCommit,
  targetCommit,
  relativeFilePath,
  owner,
  repo,
  filePath,
  githubToken,
  leftContentRef,
  rightContentRef,
  activeLayers,
  soloLayer,
  layerOpacities,
  baseTransformScale,
  targetTransformScale,
}) {
  const activeFilePath = relativeFilePath || filePath;
  const layerState = { selectedLayers: activeLayers, soloLayer, layerOpacities };

  const basePads = useCommitPads({
    repoPath, owner, repo, commit: baseCommit, activeFilePath, githubToken
  });
  const targetPads = useCommitPads({
    repoPath, owner, repo, commit: targetCommit, activeFilePath, githubToken
  });

  useOverlaySync(leftContentRef, basePads, layerState, baseTransformScale);
  useOverlaySync(rightContentRef, targetPads, layerState, targetTransformScale);

  useEffect(() => {
    return () => {
      [leftContentRef, rightContentRef].forEach(ref => {
        if (!ref?.current) return;
        ref.current.querySelector('svg.pad-label-overlay')?.remove();
        ref.current.classList.remove('pad-labels-hidden');
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
