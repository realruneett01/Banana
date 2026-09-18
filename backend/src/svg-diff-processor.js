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
  if (attrs.id && attrs.id.startsWith('symbol:')) {
    const match = attrs.id.match(/\b([A-Z]+\d+)\b/i);
    if (match) return match[1].toUpperCase();
  }
  if (attrs['inkscape:label']) {
    const match = attrs['inkscape:label'].match(/\b([A-Z]+\d+)\b/i);
    if (match) return match[1].toUpperCase();
  }

  // Check nested <desc> tags inside stroked-text groups
  const descMatches = new Set();
  const descRegex = /<g\s+class=["']stroked-text["']>\s*<desc>([A-Z]+\d+)<\/desc>/gi;
  let m;
  while ((m = descRegex.exec(innerContent)) !== null) {
    descMatches.add(m[1].toUpperCase());
  }

  // If this group contains EXACTLY ONE distinct component RefDes, return it.
  // If it contains multiple distinct RefDes labels (e.g. C38 AND C3 AND TP9), it is a multi-component layer container, NOT a single component.
  if (descMatches.size === 1) {
    return Array.from(descMatches)[0];
  }

  return null;
}

/**
 * Extracts raw primitive leaf shapes from an SVG fragment.
 */
function extractPrimitives(content) {
  const primitives = [];
  const combinedRe = /<(path|circle|rect|line|polyline|polygon|text|use|ellipse|image)(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/\1>)/gs;

  let match;
  while ((match = combinedRe.exec(content)) !== null) {
    const tag = match[1];
    const fullMatch = match[0];
    const attrStr = match[2] || '';
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
      text = match[3] ? match[3].replace(/<[^>]*>/g, '').trim() : '';
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
  return primitives;
}

/**
 * Scans SVG markup for outer <g> elements at top-level
 * and returns complete <g> blocks, accurately handling nested <g> tags.
 */
function findGBlocks(svgContent) {
  const blocks = [];
  const startTag = '<g class="stroked-text">';
  const endTag = '</g>';
  let searchIdx = 0;
  
  while (true) {
    const startPos = svgContent.indexOf(startTag, searchIdx);
    if (startPos === -1) break;
    
    const endPos = svgContent.indexOf(endTag, startPos);
    if (endPos === -1) break;
    
    const fullMatch = svgContent.substring(startPos, endPos + endTag.length);
    const innerContent = fullMatch.substring(startTag.length, fullMatch.length - endTag.length);
    const descMatch = innerContent.match(/<desc>([A-Z]+\d+)<\/desc>/i);
    
    if (descMatch) {
      blocks.push({
        fullMatch,
        attrStr: 'class="stroked-text"',
        innerContent,
        startIndex: startPos,
        endIndex: startPos + fullMatch.length,
        refDes: descMatch[1].toUpperCase(),
        attrs: { id: '', 'inkscape:label': '' }
      });
    }
    searchIdx = endPos + endTag.length;
  }
  return blocks;
}

/**
 * Parses structural container groups (<g>) and remaining isolated primitives.
 * Returns a unified Component Block Record for component groups and isolated shapes.
 */
export function extractElements(svgContent) {
  const elements = [];
  
  // 1. Find all component-level <g> container groups
  let remainingSvg = svgContent;
  const matchedGBlocks = findGBlocks(svgContent);

  // Perform back-to-front character index slicing to cleanly remove component blocks from remainingSvg
  const sortedForRemoval = [...matchedGBlocks].sort((a, b) => b.startIndex - a.startIndex);
  for (const mb of sortedForRemoval) {
    remainingSvg = remainingSvg.substring(0, mb.startIndex) + `<!-- Component ${mb.refDes} -->` + remainingSvg.substring(mb.endIndex);
  }

  // 2. Add Component Block Records
  for (const block of matchedGBlocks) {
    // Prefer text label anchor point <text x="..." y="..."> for component center calculation
    const textAnchorMatch = block.innerContent.match(/<text\s+x=["']([^"']+)["']\s+y=["']([^"']+)["']/i);
    let center;
    if (textAnchorMatch) {
      center = { x: parseFloat(textAnchorMatch[1]), y: parseFloat(textAnchorMatch[2]) };
    } else {
      const bodyContent = block.innerContent
        .replace(/<g\s+class=["'][^"']*stroked-text[^"']*["']>[\s\S]*?<\/g>/gi, '')
        .replace(/<text[^>]*?>[\s\S]*?<\/text>/gi, '');
      const childPrimitives = extractPrimitives(bodyContent.trim() ? bodyContent : block.innerContent);
      let sumX = 0, sumY = 0, count = 0;
      for (const child of childPrimitives) {
        const c = getElementCenter(child);
        if (c && !isNaN(c.x) && !isNaN(c.y)) {
          sumX += c.x;
          sumY += c.y;
          count++;
        }
      }
      center = count > 0 ? { x: sumX / count, y: sumY / count } : { x: 0, y: 0 };
    }
    
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
    const isFrame = isWorksheetFrameElement(el);
    elements.push({
      ...el,
      refDes: null,
      center: getElementCenter(el),
      isComponent: false,
      isWorksheetFrame: isFrame
    });
  }

  return elements;
}

/**
 * Detects whether an element is part of the worksheet / page frame / background rect.
 */
function isWorksheetFrameElement(el) {
  if (!el || !el.fullMatch) return false;
  if (el.tag === 'rect') {
    const attrs = parseAttributes(el.fullMatch);
    const width = parseFloat(attrs.width || '0');
    const height = parseFloat(attrs.height || '0');
    // Page rectangle covering standard page sizes (e.g. A4/A3/A2 width > 150mm and height > 100mm)
    if (width > 150 && height > 100) {
      return true;
    }
  }
  const center = getElementCenter(el);
  if (center && center.x > 180 && center.y > 140) {
    return true; // Title block metadata region at bottom-right of A4 sheet
  }
  return false;
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

// ─── STRICT COLOR PALETTE ──────────────────────────────────────────────────────
const DIFF_PALETTE = {
  CHANGED:   '#FACC15', // Yellow
  ADDED:     '#22C55E', // Green
  DELETED:   '#EF4444', // Red
  UNCHANGED: {
    TRACE:     '#4B5563',               // Slate grey for signal lines
    PAD:       '#374151',               // Darker slate grey for filled copper pads
    COURTYARD: '#FF00FF' // Bright KiCad magenta/pink courtyard outline
  }
};

/**
 * Injects precise color highlights while strictly preserving native KiCad geometry and stroke-widths.
 */
function injectDiffStyle(elementHtml, diffClass, isClosed, tag) {
  // 1. Detect if the element belongs to the KiCad Courtyard layer (F.CrtYd / B.CrtYd)
  const isCourtyard = /class="[^"]*(?:CrtYd|courtyard)[^"]*"/i.test(elementHtml) ||
                      /stroke="[^"]*(?:#E066E0|#C878C8|#DA70D6|magenta|pink)[^"]*"/i.test(elementHtml);

  // 2. Strip only existing color definitions; DO NOT touch stroke-width or path data
  let sanitized = elementHtml
    .replace(/\bstroke="[^"]*"/gi, '')
    .replace(/\bfill="[^"]*"/gi, '')
    .replace(/\bstyle="[^"]*"/gi, '');

  let styleString = '';

  if (diffClass === 'diff-unchanged') {
    if (isCourtyard) {
      // Crisp KiCad Pink Courtyard boundary outline
      styleString = `stroke: ${DIFF_PALETTE.UNCHANGED.COURTYARD} !important; fill: none !important; opacity: 0.60 !important; pointer-events: none;`;
    } else if (isClosed) {
      // Background pads, vias, zones: Filled with muted grey, no artificial stroke added
      styleString = `fill: ${DIFF_PALETTE.UNCHANGED.PAD} !important; stroke: none !important; opacity: 0.40 !important; pointer-events: none;`;
    } else {
      // Native-width signal traces: Colored grey, original stroke-width preserved
      styleString = `stroke: ${DIFF_PALETTE.UNCHANGED.TRACE} !important; fill: none !important; opacity: 0.40 !important; pointer-events: none;`;
    }
  } else {
    // ACTIVE DIFF (CHANGED, ADDED, DELETED)
    const color = diffClass === 'diff-changed'
      ? DIFF_PALETTE.CHANGED
      : diffClass === 'diff-added'
        ? DIFF_PALETTE.ADDED
        : DIFF_PALETTE.DELETED;

    if (isClosed) {
      // Changed/Added/Deleted closed pads: Solid color fill with high opacity
      styleString = `fill: ${color} !important; stroke: none !important; opacity: 1.0 !important;`;
    } else {
      // Changed/Added/Deleted traces: Exact native width colored sharply with zero blur filters
      styleString = `stroke: ${color} !important; fill: none !important; stroke-linecap: round; stroke-linejoin: round; opacity: 1.0 !important;`;
    }
  }

  return sanitized.replace(/(\/?>)$/, ` style="${styleString}" $1`);
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
 * Extracts start and end coordinates of path/line trace segments.
 */
function getSegmentEndpoints(el) {
  const attrs = parseAttributes(el.fullMatch);
  if (el.tag === 'line') {
    const x1 = parseFloat(attrs.x1 || 0);
    const y1 = parseFloat(attrs.y1 || 0);
    const x2 = parseFloat(attrs.x2 || 0);
    const y2 = parseFloat(attrs.y2 || 0);
    return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
  }
  if (el.tag === 'path') {
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
  return null;
}

/**
 * FIX (a): Determine if a given SVG filename belongs to a copper layer.
 * KiCad CLI --mode-multi exports one SVG per layer, named e.g.
 * "boardname-F_Cu.svg", "boardname-B_Cu.svg", "boardname-In1_Cu.svg".
 * Individual <path>/<line> elements inside those SVGs have NO class attribute,
 * so we must use the filename itself to gate chain assembly.
 */
function isCopperLayerFilename(layerFilename) {
  return /\b(F_Cu|B_Cu|In\d+_Cu)\b/i.test(layerFilename || '');
}

/**
 * Assembles copper trace primitives into contiguous polylines/chains.
 * @param {Array} elements  - extracted element list from extractElements()
 * @param {string} layerFilename - basename of the SVG file being processed
 *                                 (used to gate copper detection; KiCad path/line
 *                                 elements carry no class attr in their SVG output)
 */
function assembleTrackChains(elements, layerFilename) {
  // FIX (a): Only attempt chain assembly when the SVG file IS a copper layer.
  // The old code checked `attrs.class` for 'cu'/'_cu', but KiCad SVG <path>/<line>
  // elements never have a class attribute — so that filter always returned []
  // and Pass 0 was silently dead for every real board diff.
  if (!isCopperLayerFilename(layerFilename)) {
    return [];
  }

  // On a copper layer SVG, every non-closed open path/line IS a copper trace segment.
  // (Closed paths = pads/vias/fills — excluded via isClosedPath)
  const copperTracks = elements.filter(el => {
    if (el.isComponent) return false;
    if (el.tag !== 'path' && el.tag !== 'line') return false;
    return !el.isClosedPath;
  });

  const nodes = copperTracks.map((el, index) => {
    const pts = getSegmentEndpoints(el);
    return {
      el,
      index,
      pts,
      visited: false
    };
  }).filter(node => node.pts !== null);

  const chains = [];

  function isClose(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y) <= 0.1;
  }

  // Spatial hash grid (0.2 mm cells) for O(1) neighbor lookups
  const GRID_SIZE = 0.2;
  const grid = new Map();

  function gridKey(x, y) {
    return `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;
  }

  function addToGrid(pt, node) {
    const key = gridKey(pt.x, pt.y);
    let arr = grid.get(key);
    if (!arr) {
      arr = [];
      grid.set(key, arr);
    }
    arr.push({ pt, node });
  }

  for (const node of nodes) {
    addToGrid(node.pts.start, node);
    addToGrid(node.pts.end, node);
  }

  function getNeighbors(curr) {
    const neighbors = [];
    for (const pt of [curr.pts.start, curr.pts.end]) {
      const gx = Math.floor(pt.x / GRID_SIZE);
      const gy = Math.floor(pt.y / GRID_SIZE);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const k = `${gx + dx},${gy + dy}`;
          const cell = grid.get(k);
          if (cell) {
            for (const item of cell) {
              if (!item.node.visited && item.node !== curr) {
                if (isClose(pt, item.pt)) {
                  neighbors.push(item.node);
                }
              }
            }
          }
        }
      }
    }
    return neighbors;
  }

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].visited) continue;

    const component = [];
    const queue = [nodes[i]];
    nodes[i].visited = true;

    while (queue.length > 0) {
      const curr = queue.shift();
      component.push(curr);

      const neighbors = getNeighbors(curr);
      for (const n of neighbors) {
        if (!n.visited) {
          n.visited = true;
          queue.push(n);
        }
      }
    }

    // Determine terminal/end anchor points of this chain
    const endpoints = [];
    for (const node of component) {
      endpoints.push(node.pts.start, node.pts.end);
    }

    const terminalAnchors = [];
    for (let k = 0; k < endpoints.length; k++) {
      const pt = endpoints[k];
      let shareCount = 0;
      for (let m = 0; m < endpoints.length; m++) {
        if (isClose(pt, endpoints[m])) {
          shareCount++;
        }
      }
      if (shareCount === 1) {
        if (!terminalAnchors.some(t => isClose(t, pt))) {
          terminalAnchors.push(pt);
        }
      }
    }

    const startAnchor = terminalAnchors[0] || component[0].pts.start;
    const endAnchor = terminalAnchors[1] || component[component.length - 1].pts.end;

    chains.push({
      startAnchor,
      endAnchor,
      subSegments: component.map(node => node.el)
    });
  }

  return chains;
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
 * Replaces KiCad's exported paper-color background (#F5F4EF cream / white) in schematic
 * SVGs with the app's dark canvas background (#12131e) so schematic view matches PCB view.
 *
 * The KiCad SVG exporter always emits a full-page <rect> inside a group with
 *   style="fill:#F5F4EF; ..."
 * This function rewrites that fill to the dark background while leaving all
 * schematic component and wire colors completely untouched.
 */
function rewriteSchematicBackground(svgContent) {
  // Match KiCad's paper-color group (cream variants: #F5F4EF, #FFFFFF, white, #FFFEF2, etc.)
  // The full-page rect sits inside a <g style="fill:#XXXXXX ..."> immediately after the header.
  return svgContent.replace(
    /(<g\s[^>]*fill:\s*#(?:F5F4EF|FFFFFF|FFFEF2|FEFEFE|F0EFE9|ffffff|fffef2|f5f4ef)[^>]*>\s*<rect[^>]*width="29[0-9])/g,
    (match) => match.replace(/fill:\s*#[0-9A-Fa-f]{3,6}/, 'fill:#12131e')
               .replace(/stroke:\s*#[0-9A-Fa-f]{3,6}/, 'stroke:#12131e')
  );
}

/**
 * O(L) Single-Pass SVG Annotation Engine.
 * Builds an O(1) replacement dictionary keyed by element match string,
 * then traverses the raw SVG buffer exactly once using regex.
 */
function annotateSvgSinglePass(svgContent, elements, classifications) {
  if (!svgContent || !elements || elements.length === 0) {
    return svgContent;
  }

  // 1. Build an O(1) replacement map
  const replacementMap = new Map();

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.isWorksheetFrame) continue;

    const classification = classifications.get(el);
    if (!classification) continue;

    const diffClass = classification.diffClass;
    const isClosed = ['circle', 'rect', 'polygon', 'ellipse', 'g'].includes(el.tag) || el.isClosedPath;
    const typeClass = isClosed ? 'diff-closed' : 'diff-open';

    let annotated = injectClass(el.fullMatch, `${diffClass} ${typeClass}`);
    annotated = injectDiffStyle(annotated, diffClass, isClosed, el.tag);
    
    if (diffClass !== 'diff-unchanged' && classification.diffIdx !== undefined) {
      annotated = injectDataAttr(annotated, classification.diffIdx);
    }

    replacementMap.set(el.fullMatch, annotated);
  }

  // 2. Single-pass regex traversing the SVG buffer once
  const tagPattern = /<g\s+class=["']stroked-text["'][^>]*>[\s\S]*?<\/g>|<text\b[^>]*>[\s\S]*?<\/text>|<(?:path|circle|rect|line|polyline|polygon|use|ellipse|image)\b[^>]*\/?>/gi;
  return svgContent.replace(tagPattern, (match) => {
    return replacementMap.get(match) || match;
  });
}

/**
 * Injects data-diff-idx attributes ONLY on modified elements.
 * Strictly preserves 100% of native KiCad colors, fills, strokes, and stroke widths.
 * Used for Overlay Slider and Color Delta Map diff modes.
 */
function annotateSvgDataOnly(svgContent, elements, classifications) {
  if (!svgContent || !elements || elements.length === 0) {
    return svgContent;
  }

  const replacementMap = new Map();

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.isWorksheetFrame) continue;

    const classification = classifications.get(el);
    if (!classification) continue;

    const diffClass = classification.diffClass;
    if (diffClass !== 'diff-unchanged' && classification.diffIdx !== undefined) {
      const annotated = injectDataAttr(el.fullMatch, classification.diffIdx);
      replacementMap.set(el.fullMatch, annotated);
    }
  }

  if (replacementMap.size === 0) return svgContent;

  const tagPattern = /<g\s+class=["']stroked-text["'][^>]*>[\s\S]*?<\/g>|<text\b[^>]*>[\s\S]*?<\/text>|<(?:path|circle|rect|line|polyline|polygon|use|ellipse|image)\b[^>]*\/?>/gi;
  return svgContent.replace(tagPattern, (match) => {
    return replacementMap.get(match) || match;
  });
}

/**
 * Normalizes KiCad net names into clean natural identifiers.
 * e.g. "/ETHERNET/PMODE1" -> "ethernet/pmode1"
 *      "Net-(U8-Pad61)"   -> "u8_pad61"
 */
function cleanNetName(rawNet) {
  if (!rawNet || rawNet === 'unconnected' || rawNet === '0') return 'signal';
  return String(rawNet)
    .replace(/^\//, '')                     // Strip leading root slash
    .replace(/^unconnected-\((.*?)\)$/i, '$1')
    .replace(/^Net-\((.*?)\)$/i, '$1')
    .toLowerCase();
}

/**
 * Builds the natural semantic audit phrase: "[action] [name] [trace|component]".
 * @param {'CHANGED'|'ADDED'|'DELETED'} action
 * @param {'TRACE'|'COMPONENT'|'GRAPHIC'} type
 * @param {string} name  - raw net name or ref-des string
 */
function formatSemanticTitle(action, type, name) {
  const verb = action.toLowerCase(); // "changed" | "added" | "deleted"

  if (type === 'TRACE') {
    return `${verb} ${cleanNetName(name)} trace`;
  }
  if (type === 'COMPONENT') {
    // name may be "R38 (10k)" — keep it as-is, just lower-verb prefix
    return `${verb} ${name} component`;
  }
  return `${verb} ${name.toLowerCase()}`;
}

/**
 * Resolves the semantic identity (RefDes or Net name) for a diff element.
 */
function resolveSemanticIdentity(diffItem, pcbMetadata) {
  if (!pcbMetadata) {
    return { name: diffItem.refDes || 'signal', type: 'TRACE', layer: diffItem.layer || 'F.Cu' };
  }

  const { footprints = [], segments = [] } = pcbMetadata;

  // 1. Check Component Footprint Match
  if (diffItem.refDes) {
    const fp = footprints.find(f => f.ref === diffItem.refDes);
    return {
      name: `${diffItem.refDes}${fp?.value ? ` (${fp.value})` : ''}`,
      type: 'COMPONENT',
      layer: fp?.layer || diffItem.layer || 'F.Cu'
    };
  }

  // 2. Check Track Segment Coordinate Proximity
  const center = diffItem.center || (diffItem.bbox ? {
    x: (diffItem.bbox.x1 + diffItem.bbox.x2) / 2,
    y: (diffItem.bbox.y1 + diffItem.bbox.y2) / 2
  } : null);

  if (center && segments.length > 0) {
    let closestNet = null;
    let minDistance = 3.0; // 3.0 mm tolerance for SVG-to-board coordinate alignment

    for (const seg of segments) {
      if (!seg.start || !seg.end) continue;
      const dStart = Math.hypot(seg.start.x - center.x, seg.start.y - center.y);
      const dEnd   = Math.hypot(seg.end.x - center.x, seg.end.y - center.y);
      const dMid   = Math.hypot((seg.start.x + seg.end.x) / 2 - center.x, (seg.start.y + seg.end.y) / 2 - center.y);
      
      const dist = Math.min(dStart, dEnd, dMid);
      if (dist < minDistance) {
        minDistance = dist;
        closestNet = seg.net || seg.netName;
      }
    }

    if (closestNet) {
      return {
        name: closestNet,
        type: 'TRACE',
        layer: diffItem.layer || 'F.Cu'
      };
    }
  }

  return {
    name: diffItem.netName || diffItem.net || 'signal',
    type: 'TRACE',
    layer: diffItem.layer || 'F.Cu'
  };
}

/**
 * Generates structured modification records for the client audit sidebar.
 */
function generatePreciseAuditLog(targetClassifications, baseClassifications, pcbMetadata) {
  const modifications = [];
  const seenDiffIndices = new Set();

  const processMap = (classMap, defaultSide) => {
    if (!classMap) return;
    classMap.forEach((meta, el) => {
      if (!meta || meta.diffClass === 'diff-unchanged') return;
      if (meta.diffIdx !== undefined && seenDiffIndices.has(meta.diffIdx)) return;
      if (meta.diffIdx !== undefined) seenDiffIndices.add(meta.diffIdx);

      const identity = resolveSemanticIdentity(meta, pcbMetadata);

      // Determine strict action verb
      let action = 'CHANGED';
      if (meta.diffClass === 'diff-added')   action = 'ADDED';
      if (meta.diffClass === 'diff-deleted') action = 'DELETED';

      // Build the primary semantic phrase (e.g. "changed spi2_cs trace")
      const title = formatSemanticTitle(action, identity.type, identity.name);

      // Build concise context detail
      let detail = '';
      if (identity.type === 'TRACE') {
        detail = identity.connection
          ? `${identity.connection} • Layer ${identity.layer}`
          : `Layer ${identity.layer}`;
      } else if (identity.type === 'COMPONENT') {
        if (action === 'CHANGED' && meta.displacement && meta.displacement > 2.0) {
          detail = `Relocated by ${meta.displacement.toFixed(2)} mm on ${identity.layer}`;
        } else {
          detail = `${identity.layer} • (${meta.center?.x?.toFixed(1) ?? 0}, ${meta.center?.y?.toFixed(1) ?? 0})`;
        }
      }

      modifications.push({
        diffIdx: meta.diffIdx,
        action,          // 'CHANGED' | 'ADDED' | 'DELETED'
        title,           // e.g. "changed spi2_cs trace", "deleted r38 component"
        type: identity.type,
        name: identity.name,
        detail,
        layer: identity.layer || 'F.Cu',
        bbox: meta.bbox,
        // Retained for diff-highlight call-site
        side: meta.side || defaultSide,
        baseCoords: meta.baseCoords,
        targetCoords: meta.targetCoords
      });
    });
  };

  processMap(targetClassifications, 'target');
  processMap(baseClassifications, 'base');

  return modifications;
}

/**
 * Core diff processor.
 */
export function processSvgDiff(baseSvg, targetSvg, layerFilename, pcbMetadata = null) {
  const tTotalStart = performance.now();
  
  // Rewrite KiCad's cream paper-color background to dark canvas for schematic SVGs
  const tBgStart = performance.now();
  baseSvg   = rewriteSchematicBackground(baseSvg);
  targetSvg = rewriteSchematicBackground(targetSvg);
  const tBg = performance.now() - tBgStart;

  const tExtractStart = performance.now();
  const baseElements   = extractElements(baseSvg);
  const targetElements = extractElements(targetSvg);
  const tExtract = performance.now() - tExtractStart;

  const baseClassifications = new Map();
  const targetClassifications = new Map();

  const matchedBase = new Set();
  const matchedTarget = new Set();
  const matchedTargetToBase = new Map();
  const matchedBaseToTarget = new Map();

  let diffIdx = 0;

  // --- PASS 0: Contiguous Track Chain Assembly & Topological Matching ---
  const tPass0Start = performance.now();
  const baseChains = assembleTrackChains(baseElements, layerFilename);
  const targetChains = assembleTrackChains(targetElements, layerFilename);

  const matchedBaseChains = new Set();

  for (const tChain of targetChains) {
    let bestBaseChain = null;
    let minD = Infinity;

    for (const bChain of baseChains) {
      if (matchedBaseChains.has(bChain)) continue;

      const d1 = Math.hypot(bChain.startAnchor.x - tChain.startAnchor.x, bChain.startAnchor.y - tChain.startAnchor.y) +
                 Math.hypot(bChain.endAnchor.x - tChain.endAnchor.x, bChain.endAnchor.y - tChain.endAnchor.y);

      const d2 = Math.hypot(bChain.startAnchor.x - tChain.endAnchor.x, bChain.startAnchor.y - tChain.endAnchor.y) +
                 Math.hypot(bChain.endAnchor.x - tChain.startAnchor.x, bChain.endAnchor.y - tChain.startAnchor.y);

      const dTerminals = Math.min(d1, d2);
      if (dTerminals < minD && dTerminals <= 5.0) {
        minD = dTerminals;
        bestBaseChain = bChain;
      }
    }

    if (bestBaseChain) {
      matchedBaseChains.add(bestBaseChain);

      // FIX (c): Geometry equality check before assigning diff-changed.
      // Use geoKey (coordinate-only) not fullKey — fullKey encodes non-geometric
      // attributes (style, inkscape-label, etc.) that differ between renders of
      // the same trace, causing false positives.
      const bKeys = bestBaseChain.subSegments.map(el => el.geoKey).sort();
      const tKeys = tChain.subSegments.map(el => el.geoKey).sort();
      const chainsIdentical = bKeys.length === tKeys.length && bKeys.every((k, i) => k === tKeys[i]);

      if (chainsIdentical) {
        // Chains are geometrically identical — classify as unchanged, no modification entry
        for (const el of bestBaseChain.subSegments) {
          matchedBase.add(el);
          baseClassifications.set(el, { diffClass: 'diff-unchanged' });
        }
        for (const el of tChain.subSegments) {
          matchedTarget.add(el);
          targetClassifications.set(el, { diffClass: 'diff-unchanged' });
        }
      } else {
        // Chains differ — classify as changed and emit one modification entry
        const sharedIdx = diffIdx++;

        // Calculate midpoints for centering/navigation
        const baseCenter = {
          x: (bestBaseChain.startAnchor.x + bestBaseChain.endAnchor.x) / 2,
          y: (bestBaseChain.startAnchor.y + bestBaseChain.endAnchor.y) / 2
        };
        const targetCenter = {
          x: (tChain.startAnchor.x + tChain.endAnchor.x) / 2,
          y: (tChain.startAnchor.y + tChain.endAnchor.y) / 2
        };

        const bbox = {
          x1: Math.min(tChain.startAnchor.x, tChain.endAnchor.x),
          y1: Math.min(tChain.startAnchor.y, tChain.endAnchor.y),
          x2: Math.max(tChain.startAnchor.x, tChain.endAnchor.x),
          y2: Math.max(tChain.startAnchor.y, tChain.endAnchor.y),
        };

        // Mark all base sub-segments as changed and lock them
        for (const el of bestBaseChain.subSegments) {
          matchedBase.add(el);
          baseClassifications.set(el, {
            diffClass: 'diff-changed',
            diffIdx: sharedIdx,
            startPoint: bestBaseChain.startAnchor,
            endPoint: bestBaseChain.endAnchor,
            segmentCount: bestBaseChain.subSegments.length,
            layer: layerFilename,
            center: baseCenter,
            baseCoords: baseCenter,
            targetCoords: targetCenter,
            bbox
          });
        }

        // Mark all target sub-segments as changed and lock them
        for (const el of tChain.subSegments) {
          matchedTarget.add(el);
          targetClassifications.set(el, {
            diffClass: 'diff-changed',
            diffIdx: sharedIdx,
            startPoint: tChain.startAnchor,
            endPoint: tChain.endAnchor,
            segmentCount: tChain.subSegments.length,
            layer: layerFilename,
            center: targetCenter,
            baseCoords: baseCenter,
            targetCoords: targetCenter,
            bbox
          });
        }
      }
    }
  }

  const tPass0 = performance.now() - tPass0Start;

  // --- PASS 1: Relational Key Lookup (RefDes matching) ---
  const tPass1Start = performance.now();
  for (const tEl of targetElements) {
    if (matchedTarget.has(tEl)) continue;
    if (tEl.isComponent && tEl.refDes) {
      const candidates = baseElements.filter(b => !matchedBase.has(b) && b.isComponent && b.refDes === tEl.refDes);
      if (candidates.length > 0) {
        let bestMatch = candidates[0];
        let minDistance = getDistance(bestMatch, tEl);
        for (let i = 1; i < candidates.length; i++) {
          const d = getDistance(candidates[i], tEl);
          if (d < minDistance) {
            minDistance = d;
            bestMatch = candidates[i];
          }
        }

        matchedBase.add(bestMatch);
        matchedTarget.add(tEl);
        matchedTargetToBase.set(tEl, bestMatch);
        matchedBaseToTarget.set(bestMatch, tEl);

        const dist = getDistance(bestMatch, tEl);
        const geoChanged = dist > 2.0;

        const stateClass = geoChanged ? 'diff-changed' : 'diff-unchanged';
        baseClassifications.set(bestMatch, { diffClass: stateClass });
        targetClassifications.set(tEl, { diffClass: stateClass });
      }
    }
  }
  const tPass1 = performance.now() - tPass1Start;

  // --- PASS 2: Exact Primitive Matching (identical geometry + attributes) ---
  const tPass2Start = performance.now();
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
  const tPass2 = performance.now() - tPass2Start;

  // --- PASS 3: Proximity / Secondary Key matching for unmatched primitives ---
  const tPass3Start = performance.now();
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
        // Dist <= 0.5mm is font metric rendering noise -> classify as diff-unchanged
        const geoChanged = dist > 0.5;

        const stateClass = geoChanged ? 'diff-changed' : 'diff-unchanged';
        baseClassifications.set(bestMatch, { diffClass: stateClass });
        targetClassifications.set(tEl, { diffClass: stateClass });
      }
    }
  }
  const tPass3 = performance.now() - tPass3Start;

  // --- PASS 4: Classify remaining elements as added or deleted ---
  const tPass4Start = performance.now();
  for (const el of baseElements) {
    if (el.isWorksheetFrame) continue;
    if (!baseClassifications.has(el)) {
      const center = getElementCenter(el);
      const endpts = getSegmentEndpoints(el);
      const delIdx = diffIdx++;
      baseClassifications.set(el, {
        diffClass: 'diff-deleted',
        diffIdx: delIdx,
        refDes: el.refDes,
        name: el.text || el.id || el.tag,
        layer: layerFilename,
        center,
        baseCoords: center,
        startPoint: endpts ? endpts.start : null,
        endPoint: endpts ? endpts.end : null,
        bbox: {
          x1: center.x - 1,
          y1: center.y - 1,
          x2: center.x + 1,
          y2: center.y + 1
        }
      });
    }
  }

  for (const el of targetElements) {
    if (el.isWorksheetFrame) continue;
    if (!targetClassifications.has(el)) {
      const center = getElementCenter(el);
      const endpts = getSegmentEndpoints(el);
      const addIdx = diffIdx++;
      targetClassifications.set(el, {
        diffClass: 'diff-added',
        diffIdx: addIdx,
        refDes: el.refDes,
        name: el.text || el.id || el.tag,
        layer: layerFilename,
        center,
        targetCoords: center,
        startPoint: endpts ? endpts.start : null,
        endPoint: endpts ? endpts.end : null,
        bbox: {
          x1: center.x - 1,
          y1: center.y - 1,
          x2: center.x + 1,
          y2: center.y + 1
        }
      });
    } else if (targetClassifications.get(el).diffClass === 'diff-changed') {
      const classification = targetClassifications.get(el);
      if (classification.diffIdx === undefined) {
        if (matchedTargetToBase.has(el)) {
          const bEl = matchedTargetToBase.get(el);
          const bClassification = baseClassifications.get(bEl);
          const sharedIdx = diffIdx++;
          classification.diffIdx = sharedIdx;
          classification.refDes = el.refDes;
          classification.name = el.text || el.id || el.tag;
          classification.layer = layerFilename;
          classification.center = getElementCenter(el);
          classification.targetCoords = getElementCenter(el);
          classification.baseCoords = getElementCenter(bEl);
          classification.bbox = {
            x1: Math.min(classification.baseCoords.x, classification.targetCoords.x) - 1,
            y1: Math.min(classification.baseCoords.y, classification.targetCoords.y) - 1,
            x2: Math.max(classification.baseCoords.x, classification.targetCoords.x) + 1,
            y2: Math.max(classification.baseCoords.y, classification.targetCoords.y) + 1
          };

          if (bClassification) {
            bClassification.diffIdx = sharedIdx;
            bClassification.refDes = bEl.refDes;
            bClassification.name = bEl.text || bEl.id || bEl.tag;
            bClassification.layer = layerFilename;
            bClassification.center = getElementCenter(bEl);
            bClassification.baseCoords = getElementCenter(bEl);
            bClassification.targetCoords = getElementCenter(el);
            bClassification.bbox = classification.bbox;
          }
        }
      }
    }
  }
  const tPass4 = performance.now() - tPass4Start;

  // Annotate base and target SVGs using O(L) single-pass annotation engine
  const tAnnotateStart = performance.now();
  const annotatedBase = annotateSvgSinglePass(baseSvg, baseElements, baseClassifications);
  const annotatedTarget = annotateSvgSinglePass(targetSvg, targetElements, targetClassifications);
  // Pure native vector graphics with data-diff-idx injected (no style/color alteration)
  const cleanBaseSvg = annotateSvgDataOnly(baseSvg, baseElements, baseClassifications);
  const cleanTargetSvg = annotateSvgDataOnly(targetSvg, targetElements, targetClassifications);
  const tAnnotate = performance.now() - tAnnotateStart;

  // Generate structured modification records for client audit sidebar
  const modifications = generatePreciseAuditLog(targetClassifications, baseClassifications, pcbMetadata);

  // Diagnostic Code
  const tDiagStart = performance.now();
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
        misclassifiedCount++;
      }
    }
    
    if (!diffClass || diffClass === 'diff-unchanged') {
      if (el.tag === 'g' || el.tag === 'rect' || el.tag === 'polygon') {
        droppedCount++;
      }
    }
  });
  const tDiag = performance.now() - tDiagStart;
  const tTotalDiff = performance.now() - tTotalStart;

  const telemetry = {
    tBg,
    tExtract,
    tPass0,
    tPass1,
    tPass2,
    tPass3,
    tPass4,
    tAnnotate,
    tDiag,
    tTotalDiff,
    baseCount: baseElements.length,
    targetCount: targetElements.length
  };

  console.log(`[PERF TIMERS] Diff Breakdown:
  - Background Rewrite: ${tBg.toFixed(2)} ms
  - Extract Elements (${baseElements.length}b / ${targetElements.length}t): ${tExtract.toFixed(2)} ms
  - Pass 0 (Track Chains): ${tPass0.toFixed(2)} ms
  - Pass 1 (RefDes Match): ${tPass1.toFixed(2)} ms
  - Pass 2 (Exact Primitives): ${tPass2.toFixed(2)} ms
  - Pass 3 (Proximity Match): ${tPass3.toFixed(2)} ms
  - Pass 4 (Residuals & Mods): ${tPass4.toFixed(2)} ms
  - String Annotation Replace: ${tAnnotate.toFixed(2)} ms
  - Diagnostic Checks: ${tDiag.toFixed(2)} ms
  - TOTAL Diff Engine Time: ${tTotalDiff.toFixed(2)} ms`);

  return { baseSvg: annotatedBase, targetSvg: annotatedTarget, cleanBaseSvg, cleanTargetSvg, modifications, telemetry };
}
