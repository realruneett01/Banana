/**
 * Banana 2.0 — SVG Primitives & Geometry Parsing Engine
 */

export const DIFFABLE_TAGS = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'use', 'ellipse', 'image'];
export const TOLERANCE_EPSILON = 0.001;

export const COMPONENT_TYPE_MAP = Object.freeze({
  R: 'Resistor', RN: 'Resistor',
  C: 'Capacitor',
  U: 'Integrated Circuit', IC: 'Integrated Circuit',
  D: 'Diode',
  J: 'Connector', P: 'Connector',
  L: 'Inductor',
  Y: 'Crystal', X: 'Crystal',
  Q: 'Transistor',
  SW: 'Switch',
  F: 'Fuse',
  TP: 'Test Point'
});

export function getComponentType(refDes) {
  if (!refDes) return 'Component';
  const prefix = refDes.match(/^[A-Z]+/i);
  return (prefix && COMPONENT_TYPE_MAP[prefix[0].toUpperCase()]) ?? 'Component';
}

export function parseAttributes(attrStr) {
  const attrs = {};
  const re = /(\S+?)=["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

export const GEO_ATTRS = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'points', 'transform', 'viewBox'];

export function buildPrimitiveKeys(tag, attrs, attrStr) {
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
  return { geoKey, idKey, fullKey };
}

export function checkPathIsClosed(tag, attrs) {
  if (tag !== 'path') return false;
  const fillAttr = attrs['fill'];
  const styleAttr = attrs['style'] ?? '';
  const hasFillAttr = fillAttr && fillAttr !== 'none';
  const hasStyleFill = styleAttr.includes('fill:') && !styleAttr.includes('fill:none') && !styleAttr.includes('fill: none');
  const hasStyleFillNone = styleAttr.includes('fill:none') || styleAttr.includes('fill: none');
  return Boolean(hasFillAttr || (hasStyleFill && !hasStyleFillNone));
}

function getLineEndpoints(attrs) {
  const x1 = parseFloat(attrs.x1 || 0);
  const y1 = parseFloat(attrs.y1 || 0);
  const x2 = parseFloat(attrs.x2 || 0);
  const y2 = parseFloat(attrs.y2 || 0);
  return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
}

function getPathEndpoints(attrs) {
  const d = attrs.d || '';
  const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
  if (coords && coords.length >= 4) {
    const x1 = parseFloat(coords[0]);
    const y1 = parseFloat(coords[1]);
    const x2 = parseFloat(coords[coords.length - 2]);
    const y2 = parseFloat(coords[coords.length - 1]);
    return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } };
  }
  return null;
}

export function getSegmentEndpoints(el) {
  const attrs = parseAttributes(el.fullMatch);
  if (el.tag === 'line') return getLineEndpoints(attrs);
  if (el.tag === 'path') return getPathEndpoints(attrs);
  return null;
}

export function computeBoundingCenterFromCoords(coords) {
  if (!coords || coords.length < 2) return null;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < coords.length - 1; i += 2) {
    const x = parseFloat(coords[i]);
    const y = parseFloat(coords[i + 1]);
    if (!isNaN(x) && !isNaN(y)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX !== Infinity) {
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  return null;
}

const CENTER_CALCULATORS = {
  path: (attrs) => {
    const coords = (attrs.d || '').match(/[-+]?[0-9]*\.?[0-9]+/g);
    return computeBoundingCenterFromCoords(coords);
  },
  polygon: (attrs) => {
    const coords = (attrs.points || '').match(/[-+]?[0-9]*\.?[0-9]+/g);
    return computeBoundingCenterFromCoords(coords);
  },
  polyline: (attrs) => {
    const coords = (attrs.points || '').match(/[-+]?[0-9]*\.?[0-9]+/g);
    return computeBoundingCenterFromCoords(coords);
  },
  line: (attrs) => {
    const x1 = parseFloat(attrs.x1 || 0);
    const y1 = parseFloat(attrs.y1 || 0);
    const x2 = parseFloat(attrs.x2 || 0);
    const y2 = parseFloat(attrs.y2 || 0);
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  },
  circle: (attrs) => ({ x: parseFloat(attrs.cx || 0), y: parseFloat(attrs.cy || 0) }),
  ellipse: (attrs) => ({ x: parseFloat(attrs.cx || 0), y: parseFloat(attrs.cy || 0) }),
  rect: (attrs) => {
    const x = parseFloat(attrs.x || 0);
    const y = parseFloat(attrs.y || 0);
    const w = parseFloat(attrs.width || 0);
    const h = parseFloat(attrs.height || 0);
    return { x: x + w / 2, y: y + h / 2 };
  }
};

export function getElementCenter(el) {
  if (el.center) return el.center;
  const attrs = parseAttributes(el.fullMatch);
  const calc = CENTER_CALCULATORS[el.tag];
  const center = calc ? calc(attrs) : null;
  return center ?? { x: parseFloat(attrs.x || 0), y: parseFloat(attrs.y || 0) };
}

export function getDistance(el1, el2) {
  const c1 = getElementCenter(el1);
  const c2 = getElementCenter(el2);
  return Math.hypot(c1.x - c2.x, c1.y - c2.y);
}

export function extractPrimitives(content) {
  const primitives = [];
  const combinedRe = /<(path|circle|rect|line|polyline|polygon|text|use|ellipse|image)(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/\1>)/gs;

  let match;
  while ((match = combinedRe.exec(content)) !== null) {
    const tag = match[1];
    const fullMatch = match[0];
    const attrStr = match[2] || '';
    const attrs = parseAttributes(attrStr);
    const { geoKey, idKey, fullKey } = buildPrimitiveKeys(tag, attrs, attrStr);

    const id = attrs['id'] || '';
    const label = attrs['inkscape:label'] || '';
    const text = tag === 'text' && match[3] ? match[3].replace(/<[^>]*>/g, '').trim() : '';
    const isClosedPath = checkPathIsClosed(tag, attrs);

    primitives.push({
      tag,
      fullMatch,
      fullKey,
      idKey,
      geoKey,
      id,
      label,
      text,
      isClosedPath,
      startIndex: match.index,
      endIndex: match.index + fullMatch.length
    });
  }
  return primitives;
}

export function findGBlocks(svgContent) {
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

export function findWorksheetRanges(svgContent) {
  if (!svgContent) return [];
  const ranges = [];
  const startRe = /<g\b[^>]*style="[^"]*stroke:#(?:C872AB|c872ab)[^"]*"[^>]*>/gi;
  let match;
  while ((match = startRe.exec(svgContent)) !== null) {
    const startIdx = match.index;
    let depth = 1;
    let pos = startIdx + match[0].length;
    while (depth > 0 && pos < svgContent.length) {
      const nextOpen = svgContent.indexOf('<g', pos);
      const nextClose = svgContent.indexOf('</g>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 2;
      } else {
        depth--;
        pos = nextClose + 4;
      }
    }
    ranges.push({ start: startIdx, end: pos });
  }
  return ranges;
}

function hasExplicitNonWorksheetColor(fullMatch) {
  return /(?:stroke|fill):\s*#(?!C872AB|c872ab)[0-9A-Fa-f]{6}/i.test(fullMatch);
}

function hasWorksheetMagenta(fullMatch) {
  return /#(?:C872AB|c872ab)/i.test(fullMatch);
}

function isInWorksheetRange(startIndex, worksheetRanges) {
  if (startIndex === undefined || worksheetRanges.length === 0) return false;
  return worksheetRanges.some(r => startIndex >= r.start && startIndex < r.end);
}

function isPageRect(el) {
  if (el.tag !== 'rect') return false;
  const attrs = parseAttributes(el.fullMatch);
  const width = parseFloat(attrs.width || '0');
  const height = parseFloat(attrs.height || '0');
  return width > 150 && height > 100;
}

export function isWorksheetFrameElement(el, worksheetRanges = []) {
  if (!el?.fullMatch) return false;
  if (hasExplicitNonWorksheetColor(el.fullMatch)) return false;
  if (hasWorksheetMagenta(el.fullMatch)) return true;
  if (isInWorksheetRange(el.startIndex, worksheetRanges)) return true;
  if (isPageRect(el)) return true;

  const center = getElementCenter(el);
  return Boolean(center && center.x > 180 && center.y > 140);
}

export function computeComponentCenter(block) {
  const textAnchorMatch = block.innerContent.match(/<text\s+x=["']([^"']+)["']\s+y=["']([^"']+)["']/i);
  if (textAnchorMatch) {
    return { x: parseFloat(textAnchorMatch[1]), y: parseFloat(textAnchorMatch[2]) };
  }

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
  return count > 0 ? { x: sumX / count, y: sumY / count } : { x: 0, y: 0 };
}

export function extractRefDes(el) {
  if (el.refDes) return el.refDes;
  if (el.tag === 'text' && el.text) {
    const txt = el.text.trim();
    return /^[A-Z]+\d+$/i.test(txt) ? txt.toUpperCase() : txt;
  }
  const refDesRegex = /(?:^|[^a-zA-Z0-9])([A-Z]+\d+)(?:[^a-zA-Z0-9]|$)/i;
  const match = (el.id ?? '').match(refDesRegex) || (el.label ?? '').match(refDesRegex);
  return match ? match[1].toUpperCase() : null;
}

export function extractElements(svgContent) {
  const elements = [];
  const worksheetRanges = findWorksheetRanges(svgContent);

  let remainingSvg = svgContent;
  const matchedGBlocks = findGBlocks(svgContent);

  const sortedForRemoval = [...matchedGBlocks].sort((a, b) => b.startIndex - a.startIndex);
  for (const mb of sortedForRemoval) {
    remainingSvg = remainingSvg.substring(0, mb.startIndex) + `<!-- Component ${mb.refDes} -->` + remainingSvg.substring(mb.endIndex);
  }

  for (const block of matchedGBlocks) {
    const isFrame = worksheetRanges.some(r => block.startIndex >= r.start && block.startIndex < r.end);
    if (isFrame) continue;

    const center = computeComponentCenter(block);
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
      isClosedPath: true,
      isWorksheetFrame: false
    });
  }

  const remainingWorksheetRanges = findWorksheetRanges(remainingSvg);
  const primitives = extractPrimitives(remainingSvg);
  for (const el of primitives) {
    const isFrame = isWorksheetFrameElement(el, remainingWorksheetRanges);
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
