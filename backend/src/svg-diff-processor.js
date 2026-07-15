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
    const fillAlphaColor = diffClass === 'diff-changed' ? 'rgba(255, 255, 0, 0.2)'
                         : diffClass === 'diff-added' ? 'rgba(0, 255, 102, 0.2)'
                         : 'rgba(255, 51, 102, 0.2)';
    styleProps = `fill:${fillAlphaColor};stroke:${color};stroke-width:1.5;opacity:1;`;
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
/**
 * Helper to extract RefDes (Reference Designator) from element properties.
 */
function extractRefDes(el) {
  if (el.tag === 'text' && el.text) {
    const txt = el.text.trim();
    if (/^[A-Z]+\d+$/i.test(txt)) return txt.toUpperCase();
    return txt;
  }
  const id = el.id || '';
  const label = el.label || '';
  const refDesRegex = /(?:^|[^a-zA-Z0-9])([A-Z]+\d+)(?:[^a-zA-Z0-9]|$)/i;
  let match = id.match(refDesRegex) || label.match(refDesRegex);
  if (match) return match[1].toUpperCase();
  return null;
}

/**
 * Calculates the exact physical coordinate center of SVG shapes (paths, lines, circles, rects, text, etc.) using their geometry attributes.
 */
function getElementCenter(el) {
  const attrs = parseAttributes(el.fullMatch);
  if (el.tag === 'path') {
    const d = attrs.d || '';
    const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
    if (coords && coords.length >= 2) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < coords.length - 1; i += 2) {
        const x = parseFloat(coords[i]);
        const y = parseFloat(coords[i+1]);
        if (!isNaN(x) && !isNaN(y)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (minX !== Infinity) {
        return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      }
    }
  }
  if (el.tag === 'line') {
    const x1 = parseFloat(attrs.x1 || 0);
    const y1 = parseFloat(attrs.y1 || 0);
    const x2 = parseFloat(attrs.x2 || 0);
    const y2 = parseFloat(attrs.y2 || 0);
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }
  if (el.tag === 'circle' || el.tag === 'ellipse') {
    const cx = parseFloat(attrs.cx || 0);
    const cy = parseFloat(attrs.cy || 0);
    return { x: cx, y: cy };
  }
  if (el.tag === 'rect') {
    const x = parseFloat(attrs.x || 0);
    const y = parseFloat(attrs.y || 0);
    const w = parseFloat(attrs.width || 0);
    const h = parseFloat(attrs.height || 0);
    return { x: x + w / 2, y: y + h / 2 };
  }
  if (el.tag === 'polygon' || el.tag === 'polyline') {
    const pointsStr = attrs.points || '';
    const coords = pointsStr.match(/[-+]?[0-9]*\.?[0-9]+/g);
    if (coords && coords.length >= 2) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < coords.length - 1; i += 2) {
        const x = parseFloat(coords[i]);
        const y = parseFloat(coords[i+1]);
        if (!isNaN(x) && !isNaN(y)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (minX !== Infinity) {
        return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      }
    }
  }
  // Text or others
  const x = parseFloat(attrs.x || 0);
  const y = parseFloat(attrs.y || 0);
  return { x, y };
}

/**
 * Computes geometric distance between two element centers.
 */
function getDistance(el1, el2) {
  const c1 = getElementCenter(el1);
  const c2 = getElementCenter(el2);
  return Math.hypot(c1.x - c2.x, c1.y - c2.y);
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

  // --- Diagnostic console logs ---
  const totalPathsBase = baseElements.filter(el => el.tag === 'path').length;
  const totalPathsTarget = targetElements.filter(el => el.tag === 'path').length;
  console.log(`[Diagnostic] Total <path> tags in base: ${totalPathsBase}, target: ${totalPathsTarget}`);

  const baseClassifications = new Map();
  const targetClassifications = new Map();

  const matchedBase = new Set();
  const matchedTarget = new Set();
  const matchedTargetToBase = new Map();
  const matchedBaseToTarget = new Map();

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

  // 2. Pass 2: Match by identity (ID, RefDes, or text content)
  const unmatchedBase = baseElements.filter(el => !matchedBase.has(el));
  const unmatchedTarget = targetElements.filter(el => !matchedTarget.has(el));

  // Match by exact ID
  for (const tEl of unmatchedTarget) {
    if (matchedTarget.has(tEl)) continue;
    if (tEl.id) {
      const bEl = unmatchedBase.find(el => !matchedBase.has(el) && el.id === tEl.id);
      if (bEl) {
        matchedBase.add(bEl);
        matchedTarget.add(tEl);
        matchedTargetToBase.set(tEl, bEl);
        matchedBaseToTarget.set(bEl, tEl);
        baseClassifications.set(bEl, { diffClass: 'diff-changed' });
        targetClassifications.set(tEl, { diffClass: 'diff-changed' });
      }
    }
  }

  // Match by RefDes (Reference Designator)
  for (const tEl of unmatchedTarget) {
    if (matchedTarget.has(tEl)) continue;
    const tRef = extractRefDes(tEl);
    if (tRef) {
      const candidates = unmatchedBase.filter(bEl => !matchedBase.has(bEl) && bEl.tag === tEl.tag && extractRefDes(bEl) === tRef);
      if (candidates.length > 0) {
        let bestMatch = null;
        let minDistance = Infinity;
        for (const bEl of candidates) {
          const dist = getDistance(tEl, bEl);
          if (dist < minDistance) {
            minDistance = dist;
            bestMatch = bEl;
          }
        }
        if (bestMatch) {
          matchedBase.add(bestMatch);
          matchedTarget.add(tEl);
          matchedTargetToBase.set(tEl, bestMatch);
          matchedBaseToTarget.set(bestMatch, tEl);
          baseClassifications.set(bestMatch, { diffClass: 'diff-changed' });
          targetClassifications.set(tEl, { diffClass: 'diff-changed' });
        }
      }
    }
  }

  // Match text elements by text content
  for (const tEl of unmatchedTarget) {
    if (matchedTarget.has(tEl) || tEl.tag !== 'text') continue;
    if (tEl.text) {
      const candidates = unmatchedBase.filter(bEl => !matchedBase.has(bEl) && bEl.tag === 'text' && bEl.text === tEl.text);
      if (candidates.length > 0) {
        let bestMatch = null;
        let minDistance = Infinity;
        for (const bEl of candidates) {
          const dist = getDistance(tEl, bEl);
          if (dist < minDistance) {
            minDistance = dist;
            bestMatch = bEl;
          }
        }
        if (bestMatch) {
          matchedBase.add(bestMatch);
          matchedTarget.add(tEl);
          matchedTargetToBase.set(tEl, bestMatch);
          matchedBaseToTarget.set(bestMatch, tEl);
          baseClassifications.set(bestMatch, { diffClass: 'diff-changed' });
          targetClassifications.set(tEl, { diffClass: 'diff-changed' });
        }
      }
    }
  }

  // 3. Pass 3: Proximity matching for raw traces/vias/pads
  const stillUnmatchedBase = unmatchedBase.filter(el => !matchedBase.has(el));
  const stillUnmatchedTarget = unmatchedTarget.filter(el => !matchedTarget.has(el));

  const PROXIMITY_THRESHOLD = 5.0;

  for (const tEl of stillUnmatchedTarget) {
    if (matchedTarget.has(tEl)) continue;
    const candidates = stillUnmatchedBase.filter(bEl => !matchedBase.has(bEl) && bEl.tag === tEl.tag);
    if (candidates.length > 0) {
      let bestMatch = null;
      let minDistance = Infinity;
      for (const bEl of candidates) {
        const dist = getDistance(tEl, bEl);
        if (dist < minDistance && dist < PROXIMITY_THRESHOLD) {
          minDistance = dist;
          bestMatch = bEl;
        }
      }
      if (bestMatch) {
        matchedBase.add(bestMatch);
        matchedTarget.add(tEl);
        matchedTargetToBase.set(tEl, bestMatch);
        matchedBaseToTarget.set(bestMatch, tEl);
        baseClassifications.set(bestMatch, { diffClass: 'diff-changed' });
        targetClassifications.set(tEl, { diffClass: 'diff-changed' });
      }
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

  // Assign diffIdx to all non-unchanged elements, ensuring matched pairs share the same index
  for (const el of baseElements) {
    const classification = baseClassifications.get(el);
    if (classification.diffClass === 'diff-deleted') {
      classification.diffIdx = diffIdx++;
      
      const center = getElementCenter(el);
      let label = extractRefDes(el) || el.id || el.tag;
      if (el.text && !label.includes(el.text)) {
        label += ` ${el.text}`;
      }

      modifications.push({
        type: 'delete',
        tag: el.tag,
        id: el.id,
        label: `Deleted ${label}`,
        text: el.text,
        side: 'base',
        diffIdx: classification.diffIdx,
        baseCoords: center,
        targetCoords: null
      });
    }
  }

  for (const el of targetElements) {
    const classification = targetClassifications.get(el);
    if (classification.diffClass === 'diff-added') {
      classification.diffIdx = diffIdx++;
      
      const center = getElementCenter(el);
      let label = extractRefDes(el) || el.id || el.tag;
      if (el.text && !label.includes(el.text)) {
        label += ` ${el.text}`;
      }

      modifications.push({
        type: 'add',
        tag: el.tag,
        id: el.id,
        label: `Added ${label}`,
        text: el.text,
        side: 'target',
        diffIdx: classification.diffIdx,
        baseCoords: null,
        targetCoords: center
      });
    } else if (classification.diffClass === 'diff-changed') {
      const bEl = matchedTargetToBase.get(el);
      const bClassification = baseClassifications.get(bEl);
      
      const sharedIdx = diffIdx++;
      classification.diffIdx = sharedIdx;
      bClassification.diffIdx = sharedIdx;
      
      const baseCenter = getElementCenter(bEl);
      const targetCenter = getElementCenter(el);
      
      let label = extractRefDes(el) || el.id || el.tag;
      if (el.text && !label.includes(el.text)) {
        label += ` ${el.text}`;
      }

      modifications.push({
        type: 'modify',
        tag: el.tag,
        id: el.id,
        label: `Changed ${label}`,
        text: el.text,
        side: 'target',
        diffIdx: sharedIdx,
        baseCoords: baseCenter,
        targetCoords: targetCenter
      });
    }
  }

  // Annotate base SVG
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

  // Annotate target SVG
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
  // Temporary Diagnostic Injection Code
  console.log("--- BANANA 2.0 AUDIT ENGINE LOG ---");
  let misclassifiedCount = 0;
  let droppedCount = 0;

  targetElements.forEach(el => {
    const classification = targetClassifications.get(el);
    const diffClass = classification ? classification.diffClass : null;
    const elRef = extractRefDes(el);

    // Check if an item is being called an addition but shares structural text characteristics with the base
    if (diffClass === 'diff-added') {
      const potentialBaseTwin = baseElements.find(b => {
        const bRef = extractRefDes(b);
        return (elRef && bRef && bRef === elRef) || (b.text && b.text === el.text);
      });
      if (potentialBaseTwin) {
        console.warn(`[MISCLASSIFICATION DETECTED]: Element tagged as ADDED, but a twin exists in Base! Label: ${el.text || elRef}`);
        misclassifiedCount++;
      }
    }
    
    // Track elements that are completely bypassed by the audit list payload generator
    if (!diffClass || diffClass === 'diff-unchanged') {
      // If it's a major primitive shape but missing from the final audit payload logs
      if (el.tag === 'g' || el.tag === 'rect' || el.tag === 'polygon') {
        droppedCount++;
      }
    }
  });

  console.log(`Diagnostic Results -> Misclassified Modifications: ${misclassifiedCount}, Dropped: ${droppedCount}`);

  return { baseSvg: annotatedBase, targetSvg: annotatedTarget, modifications };
}

