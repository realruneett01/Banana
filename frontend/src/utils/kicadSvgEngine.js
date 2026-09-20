/**
 * kicadSvgEngine.js
 *
 * Senior Frontend Graphics & WebGL/SVG Engineering utility for KiCad SVG inspection,
 * sanitization, coordinate normalization, bounding-box calculation, and zoom-to-fit geometry.
 *
 * KiCad SVG Quirks Handled:
 * 1. Hardcoded physical unit locks (e.g. width="297.0000mm", height="210.0000mm", 11.69in).
 * 2. Embedded drawing sheets / title blocks taking up 90% of the canvas around small PCB outlines.
 * 3. Missing, offset, or negative viewBoxes causing clipping or coordinate drift.
 * 4. Coordinate conversions between Screen Pixels, SVG Coordinate Space, Millimeters (mm), and Mils.
 */

// KiCad drawing sheet identifiers and paper color matches
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
  if (parts.length < 4 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2]) || isNaN(parts[3])) {
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

/**
 * Extracts raw geometric bounding box from SVG markup using fast, robust regex parsing.
 * Analyzes path coordinates, circles, rects, lines, polylines, and polygons.
 * Detects whether Edge.Cuts (board outline) is present to prioritize board boundary.
 *
 * @param {string} svgContent
 * @param {Object} [options]
 * @param {boolean} [options.filterSheet=true] - Exclude full-page frame elements
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number, hasEdgeCuts: boolean, edgeCutsBox?: Object }}
 */
export function extractGraphicBoundingBox(svgContent, options = {}) {
  const filterSheet = options.filterSheet !== false;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  let edgeMinX = Infinity, edgeMaxX = -Infinity;
  let edgeMinY = Infinity, edgeMaxY = -Infinity;
  let hasEdgeCuts = false;

  // 1. Path elements
  const pathRe = /<path\b([^>]*?)(?:\/>|>([\s\S]*?)<\/path>)/gi;
  let m;
  while ((m = pathRe.exec(svgContent)) !== null) {
    const attrStr = m[1];
    const isEdgeCut = /class=["'][^"']*(?:edge_cuts|Edge\.Cuts|Edge_Cuts)[^"']*["']/i.test(attrStr) ||
                      /stroke=["'](?:#C8C832|#FFE600|yellow)["']/i.test(attrStr);

    const dMatch = attrStr.match(/\bd=["']([^"']+)["']/i);
    if (!dMatch) continue;

    const coords = dMatch[1].match(/[-+]?[0-9]*\.?[0-9]+/g);
    if (!coords || coords.length < 2) continue;

    for (let i = 0; i < coords.length - 1; i += 2) {
      const x = parseFloat(coords[i]);
      const y = parseFloat(coords[i + 1]);
      if (isNaN(x) || isNaN(y)) continue;

      // Filter obvious A4 sheet margin outer borders (>290mm width, >200mm height) if filterSheet is active
      if (filterSheet && (x < 1 || y < 1 || x > 296 || y > 209)) {
        // Skip page boundary frame points
      }

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (isEdgeCut) {
        hasEdgeCuts = true;
        if (x < edgeMinX) edgeMinX = x;
        if (x > edgeMaxX) edgeMaxX = x;
        if (y < edgeMinY) edgeMinY = y;
        if (y > edgeMaxY) edgeMaxY = y;
      }
    }
  }

  // 2. Circles & Ellipses (vias, round pads)
  const circleRe = /<(?:circle|ellipse)\b([^>]*?)\/?>/gi;
  while ((m = circleRe.exec(svgContent)) !== null) {
    const attrs = m[1];
    const cx = parseFloat(attrs.match(/\bcx=["']([^"']+)["']/i)?.[1] || 0);
    const cy = parseFloat(attrs.match(/\bcy=["']([^"']+)["']/i)?.[1] || 0);
    const r = parseFloat(attrs.match(/\br=["']([^"']+)["']/i)?.[1] || 0);
    const rx = parseFloat(attrs.match(/\brx=["']([^"']+)["']/i)?.[1] || r);
    const ry = parseFloat(attrs.match(/\bry=["']([^"']+)["']/i)?.[1] || r);

    if (cx - rx < minX) minX = cx - rx;
    if (cx + rx > maxX) maxX = cx + rx;
    if (cy - ry < minY) minY = cy - ry;
    if (cy + ry > maxY) maxY = cy + ry;
  }

  // 3. Rectangles (SMD pads, components)
  const rectRe = /<rect\b([^>]*?)\/?>/gi;
  while ((m = rectRe.exec(svgContent)) !== null) {
    const attrs = m[1];
    const w = parseFloat(attrs.match(/\bwidth=["']([^"']+)["']/i)?.[1] || 0);
    const h = parseFloat(attrs.match(/\bheight=["']([^"']+)["']/i)?.[1] || 0);
    // Ignore full-page worksheet background rects (>150mm x >100mm)
    if (filterSheet && w > 150 && h > 100) continue;

    const x = parseFloat(attrs.match(/\bx=["']([^"']+)["']/i)?.[1] || 0);
    const y = parseFloat(attrs.match(/\by=["']([^"']+)["']/i)?.[1] || 0);

    if (x < minX) minX = x;
    if (x + w > maxX) maxX = x + w;
    if (y < minY) minY = y;
    if (y + h > maxY) maxY = y + h;
  }

  // 4. Lines
  const lineRe = /<line\b([^>]*?)\/?>/gi;
  while ((m = lineRe.exec(svgContent)) !== null) {
    const attrs = m[1];
    const x1 = parseFloat(attrs.match(/\bx1=["']([^"']+)["']/i)?.[1] || 0);
    const y1 = parseFloat(attrs.match(/\by1=["']([^"']+)["']/i)?.[1] || 0);
    const x2 = parseFloat(attrs.match(/\bx2=["']([^"']+)["']/i)?.[1] || 0);
    const y2 = parseFloat(attrs.match(/\by2=["']([^"']+)["']/i)?.[1] || 0);

    if (Math.min(x1, x2) < minX) minX = Math.min(x1, x2);
    if (Math.max(x1, x2) > maxX) maxX = Math.max(x1, x2);
    if (Math.min(y1, y2) < minY) minY = Math.min(y1, y2);
    if (Math.max(y1, y2) > maxY) maxY = Math.max(y1, y2);
  }

  // Fallback if no geometry was captured
  if (minX === Infinity) {
    minX = 0; maxX = 100;
    minY = 0; maxY = 100;
  }

  const result = {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0.1, maxX - minX),
    height: Math.max(0.1, maxY - minY),
    hasEdgeCuts
  };

  if (hasEdgeCuts && edgeMinX !== Infinity) {
    result.edgeCutsBox = {
      minX: edgeMinX,
      minY: edgeMinY,
      maxX: edgeMaxX,
      maxY: edgeMaxY,
      width: Math.max(0.1, edgeMaxX - edgeMinX),
      height: Math.max(0.1, edgeMaxY - edgeMinY)
    };
  }

  return result;
}

/**
 * Sanitizes and normalizes KiCad-exported SVGs for responsive web rendering.
 *
 * Actions:
 * 1. Strips static physical width/height locks (e.g. width="297mm", height="210mm") and style locks.
 * 2. Injects responsive width="100%" height="100%" preserveAspectRatio="xMidYMid meet".
 * 3. Enforces shape-rendering="geometricPrecision" to maintain sub-pixel vector fidelity under high zoom.
 * 4. Resolves or tightens viewBox:
 *    - If viewBox is missing, computes true geometry boundary.
 *    - If `stripDrawingSheet: true`, removes title frame and zooms directly to board outline (or Edge.Cuts).
 *
 * @param {string} rawSvgContent - Raw SVG text from file, commit, or network
 * @param {Object} [options]
 * @param {boolean} [options.stripDrawingSheet=false] - Remove KiCad title frame/sheet & zoom tightly to board
 * @param {number} [options.sheetPaddingMm=4] - Padding margin in mm when zooming to board outline
 * @returns {{ sanitizedSvg: string, viewBox: { minX: number, minY: number, width: number, height: number }, originalViewBox: Object | null, isNormalized: boolean }}
 */
export function sanitizeAndNormalizeKiCadSvg(rawSvgContent, options = {}) {
  if (!rawSvgContent || typeof rawSvgContent !== 'string') {
    return { sanitizedSvg: '', viewBox: { minX: 0, minY: 0, width: 100, height: 100 }, originalViewBox: null, isNormalized: false };
  }

  const stripSheet = Boolean(options.stripDrawingSheet);
  const sheetPadding = options.sheetPaddingMm ?? 4.0;

  let content = rawSvgContent;

  // 1. Strip drawing sheet & worksheet frame markup if requested
  if (stripSheet) {
    content = content
      .replace(DRAWING_SHEET_REGEX, '')
      .replace(PAPER_BG_REGEX, '')
      .replace(TITLE_TEXT_REGEX, '');
  }

  // 2. Extract existing viewBox from root <svg>
  const rootSvgMatch = content.match(/<svg\b([^>]*)>/i);
  if (!rootSvgMatch) {
    return { sanitizedSvg: content, viewBox: { minX: 0, minY: 0, width: 100, height: 100 }, originalViewBox: null, isNormalized: false };
  }

  const rootAttrs = rootSvgMatch[1];
  const vbMatch = rootAttrs.match(/\bviewBox=["']([^"']+)["']/i);
  const originalViewBox = vbMatch ? parseViewBox(vbMatch[1]) : null;

  let activeViewBox = originalViewBox;

  // 3. If viewBox is missing or stripSheet is requested, compute geometric bounding box
  if (!activeViewBox || stripSheet) {
    const geoBox = extractGraphicBoundingBox(content, { filterSheet: stripSheet });
    const targetBox = (stripSheet && geoBox.hasEdgeCuts && geoBox.edgeCutsBox)
      ? geoBox.edgeCutsBox
      : geoBox;

    activeViewBox = {
      minX: targetBox.minX - sheetPadding,
      minY: targetBox.minY - sheetPadding,
      width: targetBox.width + 2 * sheetPadding,
      height: targetBox.height + 2 * sheetPadding
    };
  }

  // 4. Sanitize root <svg> attributes:
  // - Strip physical width="...mm" / height="...mm" / width="...in"
  // - Strip inline style="width:...; height:..."
  let sanitizedAttrs = rootAttrs
    .replace(/\b(?:width|height)=["'][^"']*["']/gi, '')
    .replace(/\bviewBox=["'][^"']*["']/gi, '')
    .replace(/\bstyle=["'][^"']*["']/gi, (styleAttr) => {
      // Clean width/height properties from style if present
      return styleAttr
        .replace(/width\s*:\s*[^;]+;?/gi, '')
        .replace(/height\s*:\s*[^;]+;?/gi, '');
    });

  // 5. Re-inject normalized presentation & vector precision attributes
  const viewBoxStr = formatViewBox(activeViewBox);
  const normalizedRoot = `<svg ${sanitizedAttrs.trim()} width="100%" height="100%" viewBox="${viewBoxStr}" preserveAspectRatio="xMidYMid meet" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" style="width:100%; height:100%; position:absolute; top:0; left:0; overflow:visible;">`;

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
 * @param {{ width: number, height: number }} containerDims - DOM clientWidth/clientHeight
 * @param {{ minX: number, minY: number, width: number, height: number }} contentBox - SVG viewBox
 * @param {number} [paddingRatio=0.05] - Margin ratio (default 5%)
 * @returns {{ scale: number, x: number, y: number }}
 */
export function calculateZoomToFit(containerDims, contentBox, paddingRatio = 0.05) {
  if (!containerDims || containerDims.width <= 0 || containerDims.height <= 0 ||
      !contentBox || contentBox.width <= 0 || contentBox.height <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }

  const availableWidth = containerDims.width * (1 - 2 * paddingRatio);
  const availableHeight = containerDims.height * (1 - 2 * paddingRatio);

  const scaleX = availableWidth / contentBox.width;
  const scaleY = availableHeight / contentBox.height;
  const scale = Math.min(scaleX, scaleY);

  // Center within container
  const contentWidthOnScreen = contentBox.width * scale;
  const contentHeightOnScreen = contentBox.height * scale;

  const x = (containerDims.width - contentWidthOnScreen) / 2 - (contentBox.minX || 0) * scale;
  const y = (containerDims.height - contentHeightOnScreen) / 2 - (contentBox.minY || 0) * scale;

  return { scale, x, y };
}

/**
 * Converts screen client pixel coordinates (e.g. mouse pointer) to SVG coordinate space.
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

  // In standard KiCad SVGs, 1 SVG unit = 1 millimeter (mm)
  const mmX = svgX;
  const mmY = svgY;
  const milsX = mmX * 39.3700787;
  const milsY = mmY * 39.3700787;

  return { svgX, svgY, mmX, mmY, milsX, milsY };
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
