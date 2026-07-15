/**
 * svg-diff-processor.js
 *
 * Parses two KiCad-exported SVG strings side-by-side, classifies every
 * leaf graphic element into one of four diff states, and injects the
 * corresponding class attribute directly into each SVG tag.
 *
 * Classification states:
 *   diff-deleted   — element present only in base SVG
 *   diff-added     — element present only in target SVG
 *   diff-changed   — element present in both but geometry/attributes differ
 *   diff-unchanged — element identical in both SVGs
 *
 * Uses only Node.js built-ins (no jsdom / xml parser dependency).
 */

// SVG leaf element tags that carry visual geometry we want to diff
const DIFFABLE_TAGS = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'use', 'ellipse', 'image'];

/**
 * Extracts all leaf SVG elements from an SVG string.
 * Returns an array of { tag, fullMatch, identity, geometry } objects.
 *
 * identity  — canonical key built from tag + non-geometry attributes (stable across moves)
 * geometry  — key built from geometry/position attributes (changes when element moves/resizes)
 * fullMatch — the original raw substring of the element in the SVG
 */
/**
 * Extracts all leaf SVG elements from an SVG string.
 * Returns an array of { tag, fullMatch, fullKey, idKey, geoKey, id, label, text } objects.
 */
function extractElements(svgContent) {
  const elements = [];

  for (const tag of DIFFABLE_TAGS) {
    // Matches self-closing tags: <circle ... /> and full open tags: <text ...>...</text>
    const selfClosingRe = new RegExp(`<${tag}(\\s[^>]*?)?/>`, 'gs');
    const openTagRe     = new RegExp(`<${tag}(\\s[^>]*?)?>([\\s\\S]*?)<\\/${tag}>`, 'gs');

    for (const re of [selfClosingRe, openTagRe]) {
      let match;
      while ((match = re.exec(svgContent)) !== null) {
        const fullMatch = match[0];
        const attrStr   = match[1] || '';

        // Parse attributes into a map
        const attrs = parseAttributes(attrStr);

        // Geometry attributes (position/shape)
        const GEO_ATTRS = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
                           'width', 'height', 'points', 'transform', 'viewBox'];

        const geoKey = GEO_ATTRS
          .filter(a => attrs[a] !== undefined)
          .map(a => `${a}=${attrs[a]}`)
          .join(';');

        // For identity, use non-geometry attributes plus tag name
        const idKey = tag + '|' + Object.keys(attrs)
          .filter(a => !GEO_ATTRS.includes(a))
          .sort()
          .map(a => `${a}=${attrs[a]}`)
          .join(';');

        // Full canonical key = identity + geometry (uniquely identifies exact element)
        const fullKey = `${tag}||${attrStr.trim()}`;

        // Extract metadata for audit logging
        const id = attrs['id'] || '';
        const label = attrs['inkscape:label'] || '';
        let text = '';
        if (tag === 'text') {
          // Clean inner HTML tag tags if any inside text (like tspan)
          text = match[2] ? match[2].replace(/<[^>]*>/g, '').trim() : '';
        }

        // Detect if the path is closed (filled) vs open (stroke-only)
        let isClosedPath = false;
        if (tag === 'path') {
          const fillAttr = attrs['fill'];
          const styleAttr = attrs['style'] || '';
          const hasFillAttr = fillAttr && fillAttr !== 'none';
          const hasStyleFill = styleAttr.includes('fill:') && !styleAttr.includes('fill:none') && !styleAttr.includes('fill: none');
          const hasStyleFillNone = styleAttr.includes('fill:none') || styleAttr.includes('fill: none');
          if (hasFillAttr || (hasStyleFill && !hasStyleFillNone)) {
            isClosedPath = true;
          }
        }

        elements.push({ tag, fullMatch, fullKey, idKey, geoKey, id, label, text, isClosedPath });
      }
    }
  }

  return elements;
}

/**
 * Parses an attribute string into a key→value map.
 * e.g. ' id="foo" cx="10.5" ' → { id: 'foo', cx: '10.5' }
 */
function parseAttributes(attrStr) {
  const attrs = {};
  const re = /(\S+?)=["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

/**
 * Injects a class attribute into a raw SVG element string.
 * If the element already has a class, it appends. Otherwise inserts one.
 */
function injectClass(elementStr, diffClass) {
  if (/class=["']/.test(elementStr)) {
    return elementStr.replace(/class=["']([^"']*)["']/, `class="$1 ${diffClass}"`);
  }
  // Insert class right after the tag name
  return elementStr.replace(/^(<\w+)/, `$1 class="${diffClass}"`);
}

/**
 * Stamps a 'data-diff-idx' attribute on an SVG element string.
 * This numeric index is shared between the emitted modification object and the
 * live SVG DOM node, giving the frontend a stable, O(1) DOM selector:
 *   document.querySelector('[data-diff-idx="42"]')
 */
function injectDataAttr(elementStr, idx) {
  return elementStr.replace(/^(<\w+)/, `$1 data-diff-idx="${idx}"`);
}

/**
 * For diff-highlighted elements (changed / added / deleted), injects an inline
 * style that overrides ONLY the paint color (fill / stroke) while leaving every
 * native KiCad attribute — stroke-width, transform, d-path, viewBox, defs —
 * completely intact.
 *
 * Why inline style and not stripPresentationAttrs + CSS?
 *   CSS `!important` rules cannot beat HTML presentation attributes (e.g.
 *   fill="rgb(0,132,0)") — they occupy different cascade layers. The only
 *   standards-correct mechanism to win over a presentation attribute without
 *   deleting it is an inline style="" declaration, which sits above presentation
 *   attributes in cascade priority.
 *
 * Unchanged elements are NOT touched — they render with their full native
 * KiCad appearance and only receive the CSS class-based opacity fade.
 *
 * @param {string}  elementStr - Raw SVG element markup string
 * @param {string}  diffClass  - 'diff-changed' | 'diff-added' | 'diff-deleted' | 'diff-unchanged'
 * @param {boolean} isClosed   - true → pad/zone/fill shape;  false → track/line/open path
 * @param {string}  tag        - SVG element tag name
 * @returns {string}
 */
const DIFF_COLORS = {
  'diff-changed': '#ffff00',
  'diff-added':   '#00ff66',
  'diff-deleted': '#ff3366',
};

function injectDiffStyle(elementStr, diffClass, isClosed, tag) {
  // Unchanged: class injection only — native KiCad attributes preserved 1:1
  if (diffClass === 'diff-unchanged') return elementStr;

  const color = DIFF_COLORS[diffClass];
  if (!color) return elementStr;

  let styleProps;
  if (tag === 'text' || tag === 'use') {
    styleProps = `fill:${color};stroke:none;opacity:1;`;
  } else if (isClosed) {
    // Pads, vias, zone fills, component bodies → paint with semi-transparent fill and solid stroke
    // This ensures overlay text and details remain highly visible and readable.
    styleProps = `fill:${color};fill-opacity:0.2;stroke:${color};stroke-width:1.5;opacity:1;`;
  } else {
    // Copper tracks, lines, ratsnest → stroke-only, fill:none preserves exact line weight
    styleProps = `fill:none;stroke:${color};opacity:1;`;
  }

  // Merge with any existing inline style — KiCad sometimes writes both a style
  // block and presentation attributes; we prepend so our values take priority.
  if (/style=["']/.test(elementStr)) {
    return elementStr.replace(/style=["']([^"']*)["']/, `style="${styleProps}$1"`);
  }
  return elementStr.replace(/^(<\w+)/, `$1 style="${styleProps}"`);
}

/**
 * Extracts geometric endpoints or centroids from SVG elements for matching.
 */
function getEndpoints(el) {
  if (el.tag === 'line') {
    const attrs = parseAttributes(el.fullMatch);
    const x1 = parseFloat(attrs.x1 || 0);
    const y1 = parseFloat(attrs.y1 || 0);
    const x2 = parseFloat(attrs.x2 || 0);
    const y2 = parseFloat(attrs.y2 || 0);
    return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
  }
  if (el.tag === 'path') {
    const attrs = parseAttributes(el.fullMatch);
    const d = attrs.d || '';
    const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
    if (coords && coords.length >= 4) {
      const x1 = parseFloat(coords[0]);
      const y1 = parseFloat(coords[1]);
      const x2 = parseFloat(coords[coords.length - 2]);
      const y2 = parseFloat(coords[coords.length - 1]);
      return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
    }
  }
  const attrs = parseAttributes(el.fullMatch);
  if (attrs.cx !== undefined && attrs.cy !== undefined) {
    const cx = parseFloat(attrs.cx);
    const cy = parseFloat(attrs.cy);
    return { start: { x: cx, y: cy }, end: { x: cx, y: cy } };
  }
  if (attrs.x !== undefined && attrs.y !== undefined) {
    const x = parseFloat(attrs.x);
    const y = parseFloat(attrs.y);
    const w = parseFloat(attrs.width || 0);
    const h = parseFloat(attrs.height || 0);
    const cx = x + w / 2;
    const cy = y + h / 2;
    return { start: { x: cx, y: cy }, end: { x: cx, y: cy } };
  }
  return null;
}

/**
 * Computes geometric distance between two trace endpoints.
 */
function getTraceDistance(pt1, pt2) {
  if (!pt1 || !pt2) return Infinity;
  const d1 = Math.hypot(pt1.start.x - pt2.start.x, pt1.start.y - pt2.start.y) +
             Math.hypot(pt1.end.x - pt2.end.x, pt1.end.y - pt2.end.y);
  const d2 = Math.hypot(pt1.start.x - pt2.end.x, pt1.start.y - pt2.end.y) +
             Math.hypot(pt1.end.x - pt2.start.x, pt1.end.y - pt2.start.y);
  return Math.min(d1, d2);
}

/**
 * Core diff processor.
 * Takes two raw SVG strings, classifies elements, and returns annotated SVGs
 * along with the list of detected modifications.
 *
 * @param {string} baseSvg
 * @param {string} targetSvg
 * @returns {{ baseSvg: string, targetSvg: string, modifications: Array }}
 */
export function processSvgDiff(baseSvg, targetSvg) {
  const baseElements   = extractElements(baseSvg);
  const targetElements = extractElements(targetSvg);

  // --- Diagnostic console logs (Requirement 3) ---
  const totalPathsBase = baseElements.filter(el => el.tag === 'path').length;
  const totalPathsTarget = targetElements.filter(el => el.tag === 'path').length;
  console.log(`[Diagnostic] Total <path> tags in base: ${totalPathsBase}, target: ${totalPathsTarget}`);

  const sampleTrace = targetElements.find(el => el.tag === 'path');
  if (sampleTrace) {
    console.log(`[Diagnostic] Sample trace element properties:`, {
      tag: sampleTrace.tag,
      id: sampleTrace.id,
      fullKey: sampleTrace.fullKey.substring(0, 100) + '...',
      idKey: sampleTrace.idKey,
      geoKey: sampleTrace.geoKey.substring(0, 100) + '...'
    });
  }

  const baseClassifications = new Map();
  const targetClassifications = new Map();

  const matchedBase = new Set();
  const matchedTarget = new Set();

  // 1. Pass 1: Exact matches (same tag, attributes, and geometry) paired 1-to-1
  const baseKeyGroups = new Map();
  for (const el of baseElements) {
    if (!baseKeyGroups.has(el.fullKey)) baseKeyGroups.set(el.fullKey, []);
    baseKeyGroups.get(el.fullKey).push(el);
  }

  for (const tEl of targetElements) {
    const bEls = baseKeyGroups.get(tEl.fullKey);
    if (bEls && bEls.length > 0) {
      const bEl = bEls.shift();
      matchedBase.add(bEl);
      matchedTarget.add(tEl);
      baseClassifications.set(bEl, { diffClass: 'diff-unchanged' });
      targetClassifications.set(tEl, { diffClass: 'diff-unchanged' });
    }
  }

  // 2. Pass 2: Match by unique ID
  const unmatchedBase = baseElements.filter(el => !matchedBase.has(el));
  const unmatchedTarget = targetElements.filter(el => !matchedTarget.has(el));

  const baseIdMap = new Map();
  for (const el of unmatchedBase) {
    if (el.id) baseIdMap.set(el.id, el);
  }

  for (const tEl of unmatchedTarget) {
    if (tEl.id && baseIdMap.has(tEl.id)) {
      const bEl = baseIdMap.get(tEl.id);
      matchedBase.add(bEl);
      matchedTarget.add(tEl);
      baseClassifications.set(bEl, { diffClass: 'diff-changed' });
      targetClassifications.set(tEl, { diffClass: 'diff-changed' });
    }
  }

  // 3. Pass 3: Geometric endpoint/proximity matching for raw traces/tracks/vias (Requirement 2)
  const stillUnmatchedBase = unmatchedBase.filter(el => !matchedBase.has(el));
  const stillUnmatchedTarget = unmatchedTarget.filter(el => !matchedTarget.has(el));

  const baseEndpoints = new Map();
  for (const el of stillUnmatchedBase) {
    const pts = getEndpoints(el);
    if (pts) baseEndpoints.set(el, pts);
  }

  const targetEndpoints = new Map();
  for (const el of stillUnmatchedTarget) {
    const pts = getEndpoints(el);
    if (pts) targetEndpoints.set(el, pts);
  }

  const GEOM_THRESHOLD = 5.0; // Max geometric distance to qualify as a modification of the same trace/pad

  for (const tEl of stillUnmatchedTarget) {
    const tPts = targetEndpoints.get(tEl);
    if (!tPts) continue;

    let bestMatch = null;
    let minDistance = Infinity;

    for (const bEl of stillUnmatchedBase) {
      if (matchedBase.has(bEl) || bEl.tag !== tEl.tag) continue;
      const bPts = baseEndpoints.get(bEl);
      if (!bPts) continue;

      const dist = getTraceDistance(tPts, bPts);
      if (dist < minDistance && dist < GEOM_THRESHOLD) {
        minDistance = dist;
        bestMatch = bEl;
      }
    }

    if (bestMatch) {
      matchedBase.add(bestMatch);
      matchedTarget.add(tEl);
      baseClassifications.set(bestMatch, { diffClass: 'diff-changed' });
      targetClassifications.set(tEl, { diffClass: 'diff-changed' });
    }
  }

  // 4. Pass 4: Classify remaining as added or deleted
  for (const el of baseElements) {
    if (!baseClassifications.has(el)) {
      baseClassifications.set(el, { diffClass: 'diff-deleted' });
    }
  }

  for (const el of targetElements) {
    if (!targetClassifications.has(el)) {
      targetClassifications.set(el, { diffClass: 'diff-added' });
    }
  }

  let diffIdx = 0;
  const modifications = [];

  // Write base classifications and build deleted modifications
  for (const el of baseElements) {
    const classification = baseClassifications.get(el);
    let diffClass = classification.diffClass;

    if (diffClass === 'diff-deleted') {
      modifications.push({
        type: 'delete',
        tag: el.tag,
        id: el.id,
        label: el.label,
        text: el.text,
        side: 'base',
        diffIdx: diffIdx,
      });
    }

    if (diffClass !== 'diff-unchanged') {
      classification.diffIdx = diffIdx;
      diffIdx++;
    }
  }

  // Write target classifications and build added/modified modifications
  for (const el of targetElements) {
    const classification = targetClassifications.get(el);
    let diffClass = classification.diffClass;

    if (diffClass === 'diff-changed') {
      modifications.push({
        type: 'modify',
        tag: el.tag,
        id: el.id,
        label: el.label,
        text: el.text,
        side: 'target',
        diffIdx: diffIdx,
      });
    } else if (diffClass === 'diff-added') {
      modifications.push({
        type: 'add',
        tag: el.tag,
        id: el.id,
        label: el.label,
        text: el.text,
        side: 'target',
        diffIdx: diffIdx,
      });
    }

    if (diffClass !== 'diff-unchanged') {
      classification.diffIdx = diffIdx;
      diffIdx++;
    }
  }

  let annotatedBase = baseSvg;
  for (const el of baseElements) {
    const classification = baseClassifications.get(el);
    const diffClass = classification.diffClass;

    const isClosed  = ['circle', 'rect', 'polygon', 'ellipse'].includes(el.tag) || el.isClosedPath;
    const typeClass = isClosed ? 'diff-closed' : 'diff-open';

    let annotated = injectClass(el.fullMatch, `${diffClass} ${typeClass}`);
    annotated = injectDiffStyle(annotated, diffClass, isClosed, el.tag);
    if (diffClass !== 'diff-unchanged') {
      annotated = injectDataAttr(annotated, classification.diffIdx);
    }
    annotatedBase = annotatedBase.replace(el.fullMatch, annotated);
  }

  let annotatedTarget = targetSvg;
  for (const el of targetElements) {
    const classification = targetClassifications.get(el);
    const diffClass = classification.diffClass;

    const isClosed  = ['circle', 'rect', 'polygon', 'ellipse'].includes(el.tag) || el.isClosedPath;
    const typeClass = isClosed ? 'diff-closed' : 'diff-open';

    let annotated = injectClass(el.fullMatch, `${diffClass} ${typeClass}`);
    annotated = injectDiffStyle(annotated, diffClass, isClosed, el.tag);
    if (diffClass !== 'diff-unchanged') {
      annotated = injectDataAttr(annotated, classification.diffIdx);
    }
    annotatedTarget = annotatedTarget.replace(el.fullMatch, annotated);
  }

  return { baseSvg: annotatedBase, targetSvg: annotatedTarget, modifications };
}

