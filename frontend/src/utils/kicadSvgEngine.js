/**
 * kicadSvgEngine.js
 *
 * Senior Frontend Graphics & WebGL/SVG Engineering utility for KiCad SVG inspection,
 * sanitization, coordinate normalization, bounding-box calculation, and zoom-to-fit geometry.
 */

const DRAWING_SHEET_REGEX = /<g\b[^>]*(?:class|id)=["'][^"']*(?:kicad_drawing_sheet|drawing_sheet|title_block|worksheet_frame)[^"']*["']>[\s\S]*?<\/g>/gi;
const PAPER_BG_REGEX = /<g\b[^>]*style=["'][^"']*fill:\s*#(?:F5F4EF|FFFFFF|FFFEF2|FEFEFE|F0EFE9|ffffff|fffef2|f5f4ef)[^"']*["']>\s*<rect\b[^>]*width=["']29[0-9][^"']*["'][^>]*\/?>\s*<\/g>/gi;
const TITLE_TEXT_REGEX = /<text\b[^>]*class=["'][^"']*title_text[^"']*["']>[\s\S]*?<\/text>/gi;

/**
 * Parses a viewBox string "minX minY width height" into a numeric object.
 *
 * @param {string} viewBoxStr
 * @returns {{ minX: number, minY: number, width: number, height: number } | null}
 */
export function parseViewBox(viewBoxStr) {
  if (!viewBoxStr || typeof viewBoxStr !== 'string') return null;
  const parts = viewBoxStr.trim().split(/[\s,]+/).map(parseFloat);
  if (parts.length < 4 || parts.slice(0, 4).some(isNaN)) {
    return null;
  }
  return {
    minX: parts[0],
    minY: parts[1],
    width: parts[2],
    height: parts[3]
  };
}

/**
 * Formats a bounding box object into a valid SVG viewBox attribute string.
 *
 * @param {{ minX: number, minY: number, width: number, height: number }} box
 * @returns {string}
 */
export function formatViewBox(box) {
  return `${Number(box.minX.toFixed(4))} ${Number(box.minY.toFixed(4))} ${Number(box.width.toFixed(4))} ${Number(box.height.toFixed(4))}`;
}

function isWithinSheetBoundary(x, y) {
  return x >= 1 && y >= 1 && x <= 296 && y <= 209;
}

class BBoxCollector {
  constructor(filterSheet = true) {
    this.filterSheet = filterSheet;
    this.minX = Infinity;
    this.maxX = -Infinity;
    this.minY = Infinity;
    this.maxY = -Infinity;
    this.edgeMinX = Infinity;
    this.edgeMaxX = -Infinity;
    this.edgeMinY = Infinity;
    this.edgeMaxY = -Infinity;
    this.hasEdgeCuts = false;
  }

  updateMainBounds(x, y) {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }

  updateEdgeBounds(x, y) {
    this.hasEdgeCuts = true;
    this.edgeMinX = Math.min(this.edgeMinX, x);
    this.edgeMaxX = Math.max(this.edgeMaxX, x);
    this.edgeMinY = Math.min(this.edgeMinY, y);
    this.edgeMaxY = Math.max(this.edgeMaxY, y);
  }

  addPoint(x, y, isEdgeCut = false) {
    if (isNaN(x) || isNaN(y)) return;
    if (this.filterSheet && !isWithinSheetBoundary(x, y)) return;

    this.updateMainBounds(x, y);
    if (isEdgeCut) {
      this.updateEdgeBounds(x, y);
    }
  }

  toResult() {
    const safeMinX = this.minX === Infinity ? 0 : this.minX;
    const safeMaxX = this.maxX === -Infinity ? 100 : this.maxX;
    const safeMinY = this.minY === Infinity ? 0 : this.minY;
    const safeMaxY = this.maxY === -Infinity ? 100 : this.maxY;

    const result = {
      minX: safeMinX,
      minY: safeMinY,
      maxX: safeMaxX,
      maxY: safeMaxY,
      width: Math.max(0.1, safeMaxX - safeMinX),
      height: Math.max(0.1, safeMaxY - safeMinY),
      hasEdgeCuts: this.hasEdgeCuts
    };

    if (this.hasEdgeCuts && this.edgeMinX !== Infinity) {
      result.edgeCutsBox = {
        minX: this.edgeMinX,
        minY: this.edgeMinY,
        maxX: this.edgeMaxX,
        maxY: this.edgeMaxY,
        width: Math.max(0.1, this.edgeMaxX - this.edgeMinX),
        height: Math.max(0.1, this.edgeMaxY - this.edgeMinY)
      };
    }
    return result;
  }
}

function scanPathCoords(attrStr, collector) {
  const isEdgeCut = /class=["'][^"']*(?:edge_cuts|Edge\.Cuts|Edge_Cuts)[^"']*["']/i.test(attrStr) ||
                    /stroke=["'](?:#C8C832|#FFE600|yellow)["']/i.test(attrStr);
  const dMatch = attrStr.match(/\bd=["']([^"']+)["']/i);
  if (!dMatch) return;

  const coords = dMatch[1].match(/[-+]?[0-9]*\.?[0-9]+/g);
  if (!coords || coords.length < 2) return;

  for (let i = 0; i < coords.length - 1; i += 2) {
    collector.addPoint(parseFloat(coords[i]), parseFloat(coords[i + 1]), isEdgeCut);
  }
}

function scanPaths(svgContent, collector) {
  const pathRe = /<path\b([^>]*?)(?:\/>|>([\s\S]*?)<\/path>)/gi;
  let m;
  while ((m = pathRe.exec(svgContent)) !== null) {
    scanPathCoords(m[1], collector);
  }
}

function scanCircles(svgContent, collector) {
  const circleRe = /<(?:circle|ellipse)\b([^>]*?)\/?>/gi;
  let m;
  while ((m = circleRe.exec(svgContent)) !== null) {
    const attrs = m[1];
    const cx = parseFloat(attrs.match(/\bcx=["']([^"']+)["']/i)?.[1] || 0);
    const cy = parseFloat(attrs.match(/\bcy=["']([^"']+)["']/i)?.[1] || 0);
    const r = parseFloat(attrs.match(/\br=["']([^"']+)["']/i)?.[1] || 0);
    const rx = parseFloat(attrs.match(/\brx=["']([^"']+)["']/i)?.[1] || r);
    const ry = parseFloat(attrs.match(/\bry=["']([^"']+)["']/i)?.[1] || r);

    collector.addPoint(cx - rx, cy - ry);
    collector.addPoint(cx + rx, cy + ry);
  }
}

function isSheetBackgroundRect(w, h) {
  return w > 150 && h > 100;
}

function extractRectMetrics(attrs) {
  const w = parseFloat(attrs.match(/\bwidth=["']([^"']+)["']/i)?.[1] || 0);
  const h = parseFloat(attrs.match(/\bheight=["']([^"']+)["']/i)?.[1] || 0);
  const x = parseFloat(attrs.match(/\bx=["']([^"']+)["']/i)?.[1] || 0);
  const y = parseFloat(attrs.match(/\by=["']([^"']+)["']/i)?.[1] || 0);
  return { x, y, w, h };
}

function scanRects(svgContent, collector, filterSheet) {
  const rectRe = /<rect\b([^>]*?)\/?>/gi;
  let m;
  while ((m = rectRe.exec(svgContent)) !== null) {
    const { x, y, w, h } = extractRectMetrics(m[1]);
    if (filterSheet && isSheetBackgroundRect(w, h)) continue;

    collector.addPoint(x, y);
    collector.addPoint(x + w, y + h);
  }
}

function scanLines(svgContent, collector) {
  const lineRe = /<line\b([^>]*?)\/?>/gi;
  let m;
  while ((m = lineRe.exec(svgContent)) !== null) {
    const attrs = m[1];
    const x1 = parseFloat(attrs.match(/\bx1=["']([^"']+)["']/i)?.[1] || 0);
    const y1 = parseFloat(attrs.match(/\by1=["']([^"']+)["']/i)?.[1] || 0);
    const x2 = parseFloat(attrs.match(/\bx2=["']([^"']+)["']/i)?.[1] || 0);
    const y2 = parseFloat(attrs.match(/\by2=["']([^"']+)["']/i)?.[1] || 0);

    collector.addPoint(x1, y1);
    collector.addPoint(x2, y2);
  }
}

/**
 * Extracts raw geometric bounding box from SVG markup using fast regex parsing.
 *
 * @param {string} svgContent
 * @param {Object} [options]
 * @param {boolean} [options.filterSheet=true]
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number, hasEdgeCuts: boolean, edgeCutsBox?: Object }}
 */
export function extractGraphicBoundingBox(svgContent, options = {}) {
  const filterSheet = options.filterSheet !== false;
  const collector = new BBoxCollector(filterSheet);

  scanPaths(svgContent, collector);
  scanCircles(svgContent, collector);
  scanRects(svgContent, collector, filterSheet);
  scanLines(svgContent, collector);

  return collector.toResult();
}

function resolveGeometricViewBox(content, stripSheet, sheetPadding) {
  const geoBox = extractGraphicBoundingBox(content, { filterSheet: stripSheet });
  const targetBox = (stripSheet && geoBox.hasEdgeCuts && geoBox.edgeCutsBox)
    ? geoBox.edgeCutsBox
    : geoBox;

  return {
    minX: targetBox.minX - sheetPadding,
    minY: targetBox.minY - sheetPadding,
    width: targetBox.width + 2 * sheetPadding,
    height: targetBox.height + 2 * sheetPadding
  };
}

function sanitizeRootSvgTag(rootAttrs, viewBox) {
  const sanitizedAttrs = rootAttrs
    .replace(/\b(?:width|height)=["'][^"']*["']/gi, '')
    .replace(/\bviewBox=["'][^"']*["']/gi, '')
    .replace(/\bstyle=["'][^"']*["']/gi, (styleAttr) => {
      return styleAttr
        .replace(/width\s*:\s*[^;]+;?/gi, '')
        .replace(/height\s*:\s*[^;]+;?/gi, '');
    });

  const viewBoxStr = formatViewBox(viewBox);
  return `<svg ${sanitizedAttrs.trim()} width="100%" height="100%" viewBox="${viewBoxStr}" preserveAspectRatio="xMidYMid meet" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" style="width:100%; height:100%; position:absolute; top:0; left:0; overflow:visible;">`;
}

function stripSheetMarkup(content) {
  return content
    .replace(DRAWING_SHEET_REGEX, '')
    .replace(PAPER_BG_REGEX, '')
    .replace(TITLE_TEXT_REGEX, '');
}

/**
 * Sanitizes and normalizes KiCad-exported SVGs for responsive web rendering.
 *
 * @param {string} rawSvgContent
 * @param {Object} [options]
 * @returns {{ sanitizedSvg: string, viewBox: Object, originalViewBox: Object | null, isNormalized: boolean }}
 */
export function sanitizeAndNormalizeKiCadSvg(rawSvgContent, options = {}) {
  if (!rawSvgContent || typeof rawSvgContent !== 'string') {
    return { sanitizedSvg: '', viewBox: { minX: 0, minY: 0, width: 100, height: 100 }, originalViewBox: null, isNormalized: false };
  }

  const stripSheet = Boolean(options.stripDrawingSheet);
  const sheetPadding = options.sheetPaddingMm ?? 4.0;
  const content = stripSheet ? stripSheetMarkup(rawSvgContent) : rawSvgContent;

  const rootSvgMatch = content.match(/<svg\b([^>]*)>/i);
  if (!rootSvgMatch) {
    return { sanitizedSvg: content, viewBox: { minX: 0, minY: 0, width: 100, height: 100 }, originalViewBox: null, isNormalized: false };
  }

  const rootAttrs = rootSvgMatch[1];
  const vbMatch = rootAttrs.match(/\bviewBox=["']([^"']+)["']/i);
  const originalViewBox = vbMatch ? parseViewBox(vbMatch[1]) : null;

  const activeViewBox = (!originalViewBox || stripSheet)
    ? resolveGeometricViewBox(content, stripSheet, sheetPadding)
    : originalViewBox;

  const normalizedRoot = sanitizeRootSvgTag(rootAttrs, activeViewBox);
  const sanitizedSvg = content.replace(/<svg\b[^>]*>/i, normalizedRoot);

  return {
    sanitizedSvg,
    viewBox: activeViewBox,
    originalViewBox,
    isNormalized: true
  };
}

/**
 * Calculates optimal scale and translation (Zoom-to-Fit) to center content perfectly inside container.
 *
 * @param {{ width: number, height: number }} containerDims
 * @param {{ minX: number, minY: number, width: number, height: number }} contentBox
 * @param {number} [paddingRatio=0.05]
 * @returns {{ scale: number, x: number, y: number }}
 */
export function calculateZoomToFit(containerDims, contentBox, paddingRatio = 0.05) {
  const hasValidDims = (dims) => Boolean(dims && dims.width > 0 && dims.height > 0);
  if (!hasValidDims(containerDims) || !hasValidDims(contentBox)) {
    return { scale: 1, x: 0, y: 0 };
  }

  const availableWidth = containerDims.width * (1 - 2 * paddingRatio);
  const availableHeight = containerDims.height * (1 - 2 * paddingRatio);

  const scale = Math.min(availableWidth / contentBox.width, availableHeight / contentBox.height);
  const contentWidthOnScreen = contentBox.width * scale;
  const contentHeightOnScreen = contentBox.height * scale;

  const x = (containerDims.width - contentWidthOnScreen) / 2 - (contentBox.minX || 0) * scale;
  const y = (containerDims.height - contentHeightOnScreen) / 2 - (contentBox.minY || 0) * scale;

  return { scale, x, y };
}

/**
 * Converts screen client pixel coordinates to SVG coordinate space.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {DOMRect} containerRect
 * @param {{ scale: number, x: number, y: number }} transform
 * @returns {{ svgX: number, svgY: number, mmX: number, mmY: number, milsX: number, milsY: number }}
 */
export function screenToSvgCoords(clientX, clientY, containerRect, transform) {
  const containerX = clientX - containerRect.left;
  const containerY = clientY - containerRect.top;

  const svgX = (containerX - transform.x) / transform.scale;
  const svgY = (containerY - transform.y) / transform.scale;
  const mmX = svgX;
  const mmY = svgY;

  return {
    svgX,
    svgY,
    mmX,
    mmY,
    milsX: mmX * 39.3700787,
    milsY: mmY * 39.3700787
  };
}

/**
 * Converts SVG coordinate to screen pixel position within container.
 *
 * @param {number} svgX
 * @param {number} svgY
 * @param {{ scale: number, x: number, y: number }} transform
 * @returns {{ screenX: number, screenY: number }}
 */
export function svgToScreenCoords(svgX, svgY, transform) {
  return {
    screenX: transform.x + svgX * transform.scale,
    screenY: transform.y + svgY * transform.scale
  };
}
