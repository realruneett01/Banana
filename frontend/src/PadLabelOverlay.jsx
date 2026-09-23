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
 * that is ALWAYS the last child of contentEl — after every layer <div> — so it
 * renders on top of all copper/silkscreen layers regardless of DOM order.
 *
 * The viewBox is refreshed on every call (not just on first creation) so that if
 * the underlying board SVGs are replaced (new diff loaded), the overlay stays in sync.
 *
 * @param {HTMLElement} contentEl  - The ref'd content div inside SvgPanel
 * @param {string|null} viewBoxStr - Optional explicit viewBox; falls back to reading
 *                                   from the first non-overlay <svg> in contentEl
 */
function getOrCreateOverlaySvg(contentEl, viewBoxStr) {
  let overlay = contentEl.querySelector('svg.pad-label-overlay');

  // Read viewBox from the first real layer SVG (all share an identical viewBox per 1b.1)
  const sourceSvg = contentEl.querySelector('svg:not(.pad-label-overlay)');
  const vb = viewBoxStr ?? sourceSvg?.getAttribute('viewBox');

  if (!overlay) {
    overlay = document.createElementNS(NS, 'svg');
    overlay.setAttribute('class', 'pad-label-overlay');
    overlay.setAttribute('xmlns', NS);
    // Match the layout of SideBySideSvgLayer: position:absolute, fills parent, non-interactive
    overlay.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      // overflow:visible so labels near the board edge aren't clipped by the SVG bounds
      'overflow:visible',
    ].join(';');
    // Append LAST — always topmost regardless of how many layer divs exist
    contentEl.appendChild(overlay);
  }

  // Always refresh viewBox, even when reusing an existing overlay (fixes stale viewBox
  // after a new diff is loaded while the overlay element is kept alive)
  if (vb) overlay.setAttribute('viewBox', vb);

  return overlay;
}

// ─── Layer Matching ────────────────────────────────────────────────────────────

/**
 * Returns the primary copper layer token for a pad's layer list.
 *
 * Through-hole pads in KiCad use "*.Cu" (KiCad 10) or *.Cu (KiCad 6/7) as a
 * wildcard meaning "all copper layers". We return the wildcard token as-is
 * so callers can handle it explicitly — a literal string match against
 * selectedLayers would always fail for "*.Cu".
 *
 * SMD pads list named layers explicitly (e.g. ["F.Cu", "F.Paste", "F.Mask"]).
 *
 * Known limitation: for inner-layer SMD pads on 4+ layer boards, this picks
 * the first .Cu layer in array order, which may not match user intent. Not
 * an issue for the 2-layer boards (F.Cu/B.Cu only) in this project.
 * Documented in context.md § Known Limitations.
 */
function getPrimaryLayer(padLayers) {
  if (!padLayers || padLayers.length === 0) return null;
  if (padLayers.some(l => l === '*.Cu')) return '*.Cu';
  return padLayers.find(l => l.endsWith('.Cu')) ?? padLayers[0];
}

/**
 * Returns true if this pad's labels should be visible given current UI state.
 * Implements all three visibility gates from Phase 1b.2:
 *   1. selectedLayers  — layer must be checked in the layer panel
 *   2. soloLayer       — non-soloed layers are suppressed
 *   3. layerOpacities  — opacity === 0 suppresses labels
 */
function padShouldShowLabel(padLayers, selectedLayers, soloLayer, layerOpacities) {
  const primary = getPrimaryLayer(padLayers);
  if (!primary) return false;

  if (primary === '*.Cu') {
    // Through-hole: visible if ANY copper layer is selected
    const anySelectedCu = selectedLayers.some(l => l.endsWith('.Cu'));
    if (!anySelectedCu) return false;
    // Solo: suppressed unless the soloed layer is a copper layer
    if (soloLayer && !soloLayer.endsWith('.Cu')) return false;
    // Opacity: check the soloed copper layer, or F.Cu as a proxy
    const proxyLayer = soloLayer ?? 'F.Cu';
    const op = layerOpacities[proxyLayer] ?? 1;
    return op > 0;
  }

  // SMD pad: named copper layer
  if (!selectedLayers.includes(primary)) return false;
  if (soloLayer && soloLayer !== primary) return false;
  const op = layerOpacities[primary] ?? 1;
  return op > 0;
}

// ─── DOM Injection ─────────────────────────────────────────────────────────────

/**
 * Injects <text> pad-label elements into the dedicated overlay SVG inside contentEl.
 * Clears and rebuilds from scratch on every call — same pattern as the existing
 * focus-ring feature (drawFocusRing in SideBySideDiff.jsx:583).
 */
function injectLabels(contentEl, footprints, activeLayers, soloLayer, layerOpacities) {
  if (!contentEl) return;

  const overlaySvg = getOrCreateOverlaySvg(contentEl, null);

  // Clear previous injection
  while (overlaySvg.firstChild) overlaySvg.removeChild(overlaySvg.firstChild);

  if (!footprints || footprints.length === 0) return;

  for (const fp of footprints) {
    const refUpper = (fp.ref || '').toUpperCase();
    const valUpper = (fp.value || '').toUpperCase();
    const fpNameUpper = (fp.footprint || '').toUpperCase();
    const isMountingHole =
      /^M?H\d+$/.test(refUpper) ||
      refUpper.startsWith('MOUNT') ||
      valUpper.includes('MOUNTINGHOLE') ||
      fpNameUpper.includes('MOUNTINGHOLE');
    if (isMountingHole) {
      continue;
    }

    for (const pad of fp.pads) {
      if (!padShouldShowLabel(pad.layers, activeLayers, soloLayer, layerOpacities)) {
        continue;
      }

      const { x, y } = pad.absAt;
      const minDim = Math.min(pad.size.w ?? 0.5, pad.size.h ?? 0.5);

      // Font sizes in board-mm: 35%/28% of the pad's shortest dimension,
      // clamped so tiny pads don't produce 0-size text.
      const numFontSize = Math.max(0.08, minDim * 0.35);
      const netFontSize = Math.max(0.07, minDim * 0.28);

      // Gap between the two labels, measured along the stacking axis.
      const halfGap = (numFontSize + netFontSize) * 0.5;

      // ── Text orientation (KiCad rule) ────────────────────────────────────
      // Base rotation is chosen from the pad's LOCAL (pre-rotation) aspect
      // ratio so text aligns with the pad's long axis.
      //   Wide/square pad  → 0°   (horizontal text)
      //   Tall pad         → -90° (vertical text, reads bottom-to-top)
      const isTallPad = (pad.size.h ?? 0) > (pad.size.w ?? 0);
      let textRotation = isTallPad ? -90 : 0;

      // Add the pad's own board-space rotation, snapped to nearest 90° so
      // text stays axis-aligned regardless of oblique footprint placement.
      const padRotSnapped = Math.round((pad.absAt.rotation ?? 0) / 90) * 90;
      textRotation = (textRotation + padRotSnapped) % 360;

      // Normalize: keep text in the readable range [-90°, 90°] — never upside-down.
      if (textRotation > 90 || textRotation < -90) {
        textRotation = (textRotation + 180) % 360;
      }

      // ── Label stacking axis ──────────────────────────────────────────────
      // Offsets are in the pad's PRE-ROTATION local coordinate space.
      // The rotate() transform applied below maps them to screen space.
      //
      // Wide pad  (textRotation ≈ 0°):  stack in Y — labels above/below centre.
      // Tall pad  (textRotation ≈ -90°): stack in X — labels left/right of centre
      //   before rotation, which rotate(-90, x, y) maps to above/below in screen,
      //   keeping both labels on the pad's long (vertical) axis.
      let numX = x, numY = y, netX = x, netY = y;
      if (isTallPad) {
        numX = x + halfGap * 0.35;   // 'above' in post-rotation screen space
        netX = x - halfGap * 0.9;    // 'below' in post-rotation screen space
      } else {
        numY = y - halfGap * 0.35;   // above centre
        netY = y + halfGap * 0.9;    // below centre
      }

      // ── Pad number (yellow) ─────────────────────────────────────────────
      const numEl = document.createElementNS(NS, 'text');
      numEl.setAttribute('x', numX);
      numEl.setAttribute('y', numY);
      numEl.setAttribute('font-size', numFontSize);
      numEl.setAttribute('text-anchor', 'middle');
      numEl.setAttribute('dominant-baseline', 'central');
      numEl.setAttribute('fill', '#fadb14');
      numEl.setAttribute('font-family', 'monospace, Courier New, monospace');
      numEl.setAttribute('class', 'pad-label pad-label-num');
      numEl.setAttribute('transform', `rotate(${textRotation}, ${x}, ${y})`);
      numEl.textContent = pad.number;
      overlaySvg.appendChild(numEl);

      // ── Net name (grey, truncated) ──────────────────────────────────────
      const fullNet = pad.net ?? '';
      const displayNet = fullNet.length > 12 ? fullNet.slice(0, 11) + '\u2026' : fullNet;

      const netEl = document.createElementNS(NS, 'text');
      netEl.setAttribute('x', netX);
      netEl.setAttribute('y', netY);
      netEl.setAttribute('font-size', netFontSize);
      netEl.setAttribute('text-anchor', 'middle');
      netEl.setAttribute('dominant-baseline', 'central');
      netEl.setAttribute('fill', '#a6adbb');
      netEl.setAttribute('font-family', 'monospace, Courier New, monospace');
      netEl.setAttribute('class', 'pad-label pad-label-net');
      netEl.setAttribute('transform', `rotate(${textRotation}, ${x}, ${y})`);

      // Native browser tooltip: full net name on hover
      if (fullNet) {
        const titleEl = document.createElementNS(NS, 'title');
        titleEl.textContent = fullNet;
        netEl.appendChild(titleEl);
      }
      netEl.appendChild(document.createTextNode(displayNet));
      overlaySvg.appendChild(netEl);
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * PadLabelOverlay
 *
 * A renderless React component (returns null) that manages pad/net label
 * injection into both diff panels via imperative SVG DOM operations.
 *
 * Labels are native SVG <text> elements inside a dedicated overlay <svg>
 * appended as the last child of each panel's content div — always topmost,
 * inheriting the CSS translate3d+scale transform for free.
 *
 * Props:
 *   repoPath            {string}
 *   baseCommit          {string}
 *   targetCommit        {string}
 *   relativeFilePath    {string}
 *   leftContentRef      {React.RefObject}  content div ref for base panel
 *   rightContentRef     {React.RefObject}  content div ref for target panel
 *   activeLayers        {string[]}         selectedLayers from App
 *   soloLayer           {string|null}
 *   layerOpacities      {{ [name]: number }}
 *   baseTransformScale  {number}           baseTransform.scale for zoom gate
 *   targetTransformScale {number}          targetTransform.scale for zoom gate
 */
export default function PadLabelOverlay({
  repoPath,
  baseCommit,
  targetCommit,
  relativeFilePath,
  leftContentRef,
  rightContentRef,
  activeLayers,
  soloLayer,
  layerOpacities,
  baseTransformScale,
  targetTransformScale,
}) {
  const [basePads, setBasePads] = useState(null);
  const [targetPads, setTargetPads] = useState(null);

  // ── Fetch base pad data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!repoPath || !baseCommit || !relativeFilePath) return;
    let cancelled = false;

    fetch(`${API_BASE_URL}/api/board/pads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath, commit: baseCommit, relativeFilePath }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { if (!cancelled) setBasePads(d.footprints ?? null); })
      .catch(err => console.warn('[PadLabelOverlay] base fetch failed:', err));

    return () => { cancelled = true; };
  }, [repoPath, baseCommit, relativeFilePath]);

  // ── Fetch target pad data ───────────────────────────────────────────────────
  useEffect(() => {
    if (!repoPath || !targetCommit || !relativeFilePath) return;
    let cancelled = false;

    fetch(`${API_BASE_URL}/api/board/pads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath, commit: targetCommit, relativeFilePath }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { if (!cancelled) setTargetPads(d.footprints ?? null); })
      .catch(err => console.warn('[PadLabelOverlay] target fetch failed:', err));

    return () => { cancelled = true; };
  }, [repoPath, targetCommit, relativeFilePath]);

  // ── Inject/refresh labels when data or visibility state changes ─────────────
  useEffect(() => {
    if (leftContentRef.current && basePads) {
      injectLabels(leftContentRef.current, basePads, activeLayers, soloLayer, layerOpacities);
    }
  }, [basePads, leftContentRef, activeLayers, soloLayer, layerOpacities]);

  useEffect(() => {
    if (rightContentRef.current && targetPads) {
      injectLabels(rightContentRef.current, targetPads, activeLayers, soloLayer, layerOpacities);
    }
  }, [targetPads, rightContentRef, activeLayers, soloLayer, layerOpacities]);

  // ── Zoom gate: base panel ───────────────────────────────────────────────────
  useEffect(() => {
    if (leftContentRef.current) {
      leftContentRef.current.classList.toggle(
        'pad-labels-hidden',
        baseTransformScale < ZOOM_THRESHOLD
      );
    }
  }, [baseTransformScale, leftContentRef]);

  // ── Zoom gate: target panel ─────────────────────────────────────────────────
  useEffect(() => {
    if (rightContentRef.current) {
      rightContentRef.current.classList.toggle(
        'pad-labels-hidden',
        targetTransformScale < ZOOM_THRESHOLD
      );
    }
  }, [targetTransformScale, rightContentRef]);

  // ── Cleanup overlays on unmount ─────────────────────────────────────────────
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

  // Renderless — all work is done imperatively on the SVG DOM
  return null;
}
