/**
 * svg-diff-processor.js
 *
 * Parses two KiCad-exported SVG strings side-by-side, classifies every
 * leaf graphic element and component block into one of four diff states,
 * and injects the corresponding class attribute directly into each SVG tag.
 *
 * Classification states:
 *   diff-deleted   — element present only in base SVG
 *   diff-added     — element present only in target SVG
 *   diff-changed   — element present in both but geometry/attributes/position differ
 *   diff-unchanged — element identical in both SVGs
 *
 * Uses only Node.js built-ins (no jsdom / xml parser dependency).
 */

// SVG leaf element tags that carry visual geometry we want to diff
const DIFFABLE_TAGS = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'use', 'ellipse', 'image'];

/**
 * Helper to determine a human-readable component type from its RefDes.
 */
function getComponentType(refDes) {
  if (!refDes) return 'Component';
  const prefix = refDes.match(/^[A-Z]+/i);
  if (!prefix) return 'Component';
  const p = prefix[0].toUpperCase();
  
  switch (p) {
    case 'R':
    case 'RN':
      return 'Resistor';
    case 'C':
      return 'Capacitor';
    case 'U':
    case 'IC':
      return 'Integrated Circuit';
    case 'D':
      return 'Diode';
    case 'J':
    case 'P':
      return 'Connector';
    case 'L':
      return 'Inductor';
    case 'Y':
    case 'X':
      return 'Crystal';
    case 'Q':
      return 'Transistor';
    case 'SW':
      return 'Switch';
    case 'F':
      return 'Fuse';
    case 'TP':
      return 'Test Point';
    default:
      return 'Component';
  }
}

/**
 * Helper to extract RefDes (Reference Designator) from element properties and child nodes.
 */
function getRefDesFromGroupAttrs(attrs, innerContent) {
  const refDesRegex = /\b([A-Z]+\d+)\b/i;
  
  if (attrs.id) {
    const match = attrs.id.match(refDesRegex);
    if (match) return match[1].toUpperCase();
  }
  if (attrs['inkscape:label']) {
    const match = attrs['inkscape:label'].match(refDesRegex);
    if (match) return match[1].toUpperCase();
  }

  // Check nested <text> tags inside group content
  const textTagRe = /<text[^>]*?>([\s\S]*?)<\/text>/gi;
  let textMatch;
  while ((textMatch = textTagRe.exec(innerContent)) !== null) {
    const rawText = textMatch[1].replace(/<[^>]*>/g, '').trim();
    const match = rawText.match(refDesRegex);
    if (match) return match[1].toUpperCase();
  }

  return null;
}

/**
 * Extracts raw primitive leaf shapes from an SVG fragment.
 */
function extractPrimitives(content) {
  const primitives = [];
  for (const tag of DIFFABLE_TAGS) {
    const selfClosingRe = new RegExp(`<${tag}(\\s[^>]*?)?/>`, 'gs');
    const openTagRe     = new RegExp(`<${tag}(\\s[^>]*?)?>([\\s\\S]*?)<\\/${tag}>`, 'gs');

    for (const re of [selfClosingRe, openTagRe]) {
      let match;
      while ((match = re.exec(content)) !== null) {
        const fullMatch = match[0];
        const attrStr   = match[1] || '';
        const attrs = parseAttributes(attrStr);

        const GEO_ATTRS = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
                           'width', 'height', 'points', 'transform', 'viewBox'];

        const geoKey = GEO_ATTRS
          .filter(a => attrs[a] !== undefined)
          .map(a => `${a}=${attrs[a]}`)
          .join(';');

        const idKey = tag + '|' + Object.keys(attrs)
          .filter(a => !GEO_ATTRS.includes(a))
          .sort()
          .map(a => `${a}=${attrs[a]}`)
          .join(';');

        const fullKey = `${tag}||${attrStr.trim()}`;
        const id = attrs['id'] || '';
        const label = attrs['inkscape:label'] || '';
        let text = '';
        if (tag === 'text') {
          text = match[2] ? match[2].replace(/<[^>]*>/g, '').trim() : '';
        }

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

        primitives.push({ tag, fullMatch, fullKey, idKey, geoKey, id, label, text, isClosedPath });
      }
    }
  }
  return primitives;
}

/**
 * Parses structural container groups (<g>) and remaining isolated primitives.
 * Returns a unified Component Block Record for component groups and isolated shapes.
 */
export function extractElements(svgContent) {
  const elements = [];
  
  // 1. Find all component-level <g> container groups
  const gTagRe = /<g(\s[^>]*?)?>([\s\S]*?)<\/g>/g;
  let match;
  let remainingSvg = svgContent;
  const gBlocks = [];

  while ((match = gTagRe.exec(svgContent)) !== null) {
    const fullMatch = match[0];
    const attrStr = match[1] || '';
    const innerContent = match[2] || '';
    const attrs = parseAttributes(attrStr);
    const refDes = getRefDesFromGroupAttrs(attrs, innerContent);
    
    if (refDes) {
      gBlocks.push({
        fullMatch,
        attrStr,
        innerContent,
        attrs,
        refDes
      });
      // Replace to prevent scanning child shapes as separate isolated primitives
      remainingSvg = remainingSvg.replace(fullMatch, `<!-- Component ${refDes} -->`);
    }
  }

  // 2. Add Component Block Records
  for (const block of gBlocks) {
    const childPrimitives = extractPrimitives(block.innerContent);
    let sumX = 0, sumY = 0, count = 0;
    for (const child of childPrimitives) {
      const c = getElementCenter(child);
      if (c && !isNaN(c.x) && !isNaN(c.y)) {
        sumX += c.x;
        sumY += c.y;
        count++;
      }
    }
    const center = count > 0 ? { x: sumX / count, y: sumY / count } : { x: 0, y: 0 };
    
    elements.push({
      tag: 'g',
      fullMatch: block.fullMatch,
      fullKey: `g||refDes=${block.refDes};inner=${block.innerContent.length}`,
      idKey: `g|refDes=${block.refDes}`,
      geoKey: `center=${center.x},${center.y}`,
      id: block.attrs.id || '',
      label: block.attrs['inkscape:label'] || '',
      text: block.refDes,
      refDes: block.refDes,
      center,
      isComponent: true,
      isClosedPath: true
    });
  }

  // 3. Add isolated primitive shapes
  const primitives = extractPrimitives(remainingSvg);
  for (const el of primitives) {
    elements.push({
      ...el,
      refDes: null,
      center: getElementCenter(el),
      isComponent: false
    });
  }

  return elements;
}

/**
 * Parses an attribute string into a key→value map.
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
 * Injects a class attribute into a raw SVG tag.
 */
function injectClass(elementStr, diffClass) {
  if (/class=["']/.test(elementStr)) {
    return elementStr.replace(/class=["']([^"']*)["']/, `class="$1 ${diffClass}"`);
  }
  return elementStr.replace(/^(<\w+)/, `$1 class="${diffClass}"`);
}

/**
 * Injects a data-diff-idx attribute.
 */
function injectDataAttr(elementStr, idx) {
  return elementStr.replace(/^(<\w+)/, `$1 data-diff-idx="${idx}"`);
}

const DIFF_COLORS = {
  'diff-changed': '#ffff00',
  'diff-added':   '#00ff66',
  'diff-deleted': '#ff3366',
};

/**
 * Injects inline styles for highlighted elements.
 */
function injectDiffStyle(elementStr, diffClass, isClosed, tag) {
  if (diffClass === 'diff-unchanged') return elementStr;

  const color = DIFF_COLORS[diffClass];
  if (!color) return elementStr;

  let styleProps;
  if (tag === 'text' || tag === 'use') {
    styleProps = `fill:${color};stroke:none;opacity:1;`;
  } else if (isClosed) {
    const fillAlphaColor = diffClass === 'diff-changed' ? 'rgba(255, 255, 0, 0.2)'
                         : diffClass === 'diff-added' ? 'rgba(0, 255, 102, 0.2)'
                         : 'rgba(255, 51, 102, 0.2)';
    styleProps = `fill:${fillAlphaColor};stroke:${color};stroke-width:1.5;opacity:1;`;
  } else {
    styleProps = `fill:none;stroke:${color};opacity:1;`;
  }

  if (/style=["']/.test(elementStr)) {
    return elementStr.replace(/style=["']([^"']*)["']/, `style="${styleProps}$1"`);
  }
  return elementStr.replace(/^(<\w+)/, `$1 style="${styleProps}"`);
}

/**
 * Helper to extract RefDes helper (retained for backward compatibility or simple leaf tags).
 */
function extractRefDes(el) {
  if (el.refDes) return el.refDes;
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
 * Calculates the exact physical coordinate center of primitive SVG shapes.
 */
function getElementCenter(el) {
  if (el.center) return el.center;

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
 */
export function processSvgDiff(baseSvg, targetSvg) {
  const baseElements   = extractElements(baseSvg);
  const targetElements = extractElements(targetSvg);

  const baseClassifications = new Map();
  const targetClassifications = new Map();

  const matchedBase = new Set();
  const matchedTarget = new Set();
  const matchedTargetToBase = new Map();
  const matchedBaseToTarget = new Map();

  // --- PASS 1: Relational Key Lookup (RefDes matching) ---
  for (const tEl of targetElements) {
    if (tEl.isComponent && tEl.refDes) {
      const bEl = baseElements.find(b => b.isComponent && b.refDes === tEl.refDes);
      if (bEl) {
        matchedBase.add(bEl);
        matchedTarget.add(tEl);
        matchedTargetToBase.set(tEl, bEl);
        matchedBaseToTarget.set(bEl, tEl);

        const dist = getDistance(bEl, tEl);
        const geoChanged = bEl.fullKey !== tEl.fullKey || bEl.geoKey !== tEl.geoKey || dist > 0.05;

        const stateClass = geoChanged ? 'diff-changed' : 'diff-unchanged';
        baseClassifications.set(bEl, { diffClass: stateClass });
        targetClassifications.set(tEl, { diffClass: stateClass });
      }
    }
  }

  // --- PASS 2: Exact Primitive Matching (identical geometry + attributes) ---
  const baseKeyGroups = new Map();
  for (const el of baseElements) {
    if (matchedBase.has(el)) continue;
    if (!baseKeyGroups.has(el.fullKey)) baseKeyGroups.set(el.fullKey, []);
    baseKeyGroups.get(el.fullKey).push(el);
  }

  for (const tEl of targetElements) {
    if (matchedTarget.has(tEl)) continue;
    const bEls = baseKeyGroups.get(tEl.fullKey);
    if (bEls && bEls.length > 0) {
      const bEl = bEls.shift();
      matchedBase.add(bEl);
      matchedTarget.add(tEl);
      baseClassifications.set(bEl, { diffClass: 'diff-unchanged' });
      targetClassifications.set(tEl, { diffClass: 'diff-unchanged' });
    }
  }

  // --- PASS 3: Proximity / Secondary Key matching for unmatched primitives ---
  const PROXIMITY_THRESHOLD = 5.0;

  for (const tEl of targetElements) {
    if (matchedTarget.has(tEl)) continue;
    
    const candidates = baseElements.filter(bEl => !matchedBase.has(bEl) && bEl.tag === tEl.tag);
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

        const dist = getDistance(bestMatch, tEl);
        const geoChanged = bestMatch.fullKey !== tEl.fullKey || bestMatch.geoKey !== tEl.geoKey || dist > 0.05;

        const stateClass = geoChanged ? 'diff-changed' : 'diff-unchanged';
        baseClassifications.set(bestMatch, { diffClass: stateClass });
        targetClassifications.set(tEl, { diffClass: stateClass });
      }
    }
  }

  // --- PASS 4: Classify remaining elements as added or deleted ---
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

  // Assign diffIdx and construct modification logs
  for (const el of baseElements) {
    const classification = baseClassifications.get(el);
    if (classification.diffClass === 'diff-deleted') {
      classification.diffIdx = diffIdx++;
      
      const center = getElementCenter(el);
      let label = el.refDes || el.id || el.tag;
      if (el.text && !label.includes(el.text)) {
        label += ` ${el.text}`;
      }

      modifications.push({
        type: 'delete',
        component: getComponentType(el.refDes),
        label: `Deleted ${label}`,
        tag: el.tag,
        id: el.id,
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
      let label = el.refDes || el.id || el.tag;
      if (el.text && !label.includes(el.text)) {
        label += ` ${el.text}`;
      }

      modifications.push({
        type: 'add',
        component: getComponentType(el.refDes),
        label: `Added ${label}`,
        tag: el.tag,
        id: el.id,
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
      
      let label = el.refDes || el.id || el.tag;
      if (el.text && !label.includes(el.text)) {
        label += ` ${el.text}`;
      }

      modifications.push({
        type: 'modify',
        component: getComponentType(el.refDes),
        label: `Changed ${label}`,
        tag: el.tag,
        id: el.id,
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

    const isClosed  = ['circle', 'rect', 'polygon', 'ellipse', 'g'].includes(el.tag) || el.isClosedPath;
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

    const isClosed  = ['circle', 'rect', 'polygon', 'ellipse', 'g'].includes(el.tag) || el.isClosedPath;
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
    
    if (!diffClass || diffClass === 'diff-unchanged') {
      if (el.tag === 'g' || el.tag === 'rect' || el.tag === 'polygon') {
        droppedCount++;
      }
    }
  });

  console.log(`Diagnostic Results -> Misclassified Modifications: ${misclassifiedCount}, Dropped: ${droppedCount}`);

  return { baseSvg: annotatedBase, targetSvg: annotatedTarget, modifications };
}
