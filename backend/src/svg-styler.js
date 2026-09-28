/**
 * Banana 2.0 — SVG Annotation & Styling Engine
 */

export const DIFF_CONFIG = Object.freeze({
  DEFAULT_TRACE_WIDTH: '0.200mm',
  DEFAULT_TRACE_WIDTH_MM: 0.200,
  DEFAULT_TRACE_WIDTH_MILS: 7.874,
  TRACE_WIDTH_CSS_VAR: '--diff-trace-width',
  MM_TO_MILS: 39.3700787,
  MILS_TO_MM: 0.0254
});

export const DIFF_PALETTE = Object.freeze({
  CHANGED: '#FACC15',
  ADDED: '#22C55E',
  DELETED: '#EF4444',
  UNCHANGED: {
    TRACE: '#4B5563',
    PAD: '#374151',
    COURTYARD: '#FF00FF'
  }
});

export function cleanNetName(rawNet) {
  if (!rawNet || rawNet === 'unconnected' || rawNet === '0') return 'signal';
  return String(rawNet)
    .replace(/^\//, '')
    .replace(/^unconnected-\((.*?)\)$/i, '$1')
    .replace(/^Net-\((.*?)\)$/i, '$1')
    .toLowerCase();
}

export function cleanLayerName(layer) {
  if (!layer) return 'F.Cu';
  let cleaned = String(layer).replace(/\.svg$/i, '');
  if (cleaned.includes('-')) {
    cleaned = cleaned.substring(cleaned.lastIndexOf('-') + 1);
  }
  return cleaned.replace(/_/g, '.');
}

export function formatSemanticTitle(action, type, name) {
  const verb = action.toLowerCase();
  if (type === 'TRACE') {
    return `${verb} ${cleanNetName(name)} trace`;
  }
  if (type === 'COMPONENT') {
    return `${verb} ${name} component`;
  }
  return `${verb} ${name.toLowerCase()}`;
}

export function extractNativeStrokeWidth(elementHtml) {
  const styleMatch = elementHtml.match(/\bstyle=["']([^"']*)["']/i);
  if (styleMatch) {
    const swMatch = styleMatch[1].match(/\bstroke-width\s*:\s*([^;]+)/i);
    if (swMatch) return swMatch[1].trim();
  }
  const attrMatch = elementHtml.match(/\bstroke-width=["']([^"']*)["']/i);
  return attrMatch ? attrMatch[1].trim() : null;
}

export function buildDiffStyleString(diffClass, isCourtyard, isClosed, nativeStrokeWidth) {
  const color = diffClass === 'diff-changed'
    ? DIFF_PALETTE.CHANGED
    : diffClass === 'diff-added'
      ? DIFF_PALETTE.ADDED
      : DIFF_PALETTE.DELETED;

  if (isCourtyard) {
    const swCss = nativeStrokeWidth ? `stroke-width: ${nativeStrokeWidth} !important; ` : 'stroke-width: 0.15mm !important; ';
    return `stroke: ${color} !important; fill: none !important; ${swCss}stroke-linecap: round; stroke-linejoin: round; opacity: 1.0 !important;`;
  }
  if (isClosed) {
    return `fill: ${color} !important; stroke: none !important; opacity: 1.0 !important;`;
  }
  const swCss = nativeStrokeWidth ? `stroke-width: ${nativeStrokeWidth} !important; ` : `stroke-width: var(${DIFF_CONFIG.TRACE_WIDTH_CSS_VAR}, inherit) !important; `;
  return `stroke: ${color} !important; fill: none !important; ${swCss}stroke-linecap: round; stroke-linejoin: round; opacity: 1.0 !important;`;
}

export function injectClass(elementStr, diffClass) {
  if (/class=["']/.test(elementStr)) {
    return elementStr.replace(/class=["']([^"']*)["']/, `class="$1 ${diffClass}"`);
  }
  return elementStr.replace(/^(<\w+)/, `$1 class="${diffClass}"`);
}

export function injectDataAttr(elementStr, idx) {
  return elementStr.replace(/^(<\w+)/, `$1 data-diff-idx="${idx}"`);
}

export function injectDiffStyle(elementHtml, diffClass, isClosed) {
  if (diffClass === 'diff-unchanged') {
    return elementHtml;
  }

  const isCourtyard = /class="[^"]*(?:CrtYd|courtyard)[^"]*"/i.test(elementHtml) ||
                      /stroke="[^"]*(?:#E066E0|#C878C8|#DA70D6|magenta|pink)[^"]*"/i.test(elementHtml);
  const nativeStrokeWidth = extractNativeStrokeWidth(elementHtml);

  const sanitized = elementHtml
    .replace(/\bstroke="[^"]*"/gi, '')
    .replace(/\bfill="[^"]*"/gi, '')
    .replace(/\bstyle="[^"]*"/gi, '');

  const styleString = buildDiffStyleString(diffClass, isCourtyard, isClosed, nativeStrokeWidth);
  return sanitized.replace(/(\/?>)$/, ` style="${styleString}" $1`);
}

export function rewriteSchematicBackground(svgContent) {
  return svgContent.replace(
    /(<g\s[^>]*fill:\s*#(?:F5F4EF|FFFFFF|FFFEF2|FEFEFE|F0EFE9|ffffff|fffef2|f5f4ef)[^>]*>\s*<rect[^>]*width="29[0-9])/g,
    (match) => match.replace(/fill:\s*#[0-9A-Fa-f]{3,6}/, 'fill:#12131e')
      .replace(/stroke:\s*#[0-9A-Fa-f]{3,6}/, 'stroke:#12131e')
  );
}

const SVG_TAG_PATTERN = /<g\s+class=["']stroked-text["'][^>]*>[\s\S]*?<\/g>|<text\b[^>]*>[\s\S]*?<\/text>|<(?:path|circle|rect|line|polyline|polygon|use|ellipse|image)\b[^>]*\/?>/gi;

function applySvgReplacements(svgContent, replacementMap) {
  if (replacementMap.size === 0) return svgContent;
  return svgContent.replace(SVG_TAG_PATTERN, match => replacementMap.get(match) || match);
}

function buildAnnotatedElement(el, classification) {
  const diffClass = classification.diffClass;
  const isClosed = ['circle', 'rect', 'polygon', 'ellipse'].includes(el.tag) || el.isClosedPath;
  const typeClass = isClosed ? 'diff-closed' : 'diff-open';

  let annotated = injectClass(el.fullMatch, `${diffClass} ${typeClass}`);
  if (diffClass !== 'diff-unchanged') {
    annotated = injectDiffStyle(annotated, diffClass, isClosed);
    if (classification.diffIdx !== undefined) {
      annotated = injectDataAttr(annotated, classification.diffIdx);
    }
  }
  return annotated;
}

function buildAnnotationMap(elements, classifications, transformFn) {
  const replacementMap = new Map();
  for (const el of elements) {
    if (el.isWorksheetFrame) continue;
    const classification = classifications.get(el);
    const replacement = transformFn(el, classification);
    if (replacement) {
      replacementMap.set(el.fullMatch, replacement);
    }
  }
  return replacementMap;
}

export function annotateSvgSinglePass(svgContent, elements, classifications) {
  if (!svgContent || !elements || elements.length === 0) return svgContent;
  const map = buildAnnotationMap(elements, classifications, (el, c) => (c ? buildAnnotatedElement(el, c) : null));
  return applySvgReplacements(svgContent, map);
}

export function annotateSvgDataOnly(svgContent, elements, classifications) {
  if (!svgContent || !elements || elements.length === 0) return svgContent;
  const map = buildAnnotationMap(elements, classifications, (el, c) => {
    if (!c || c.diffClass === 'diff-unchanged' || c.diffIdx === undefined) return null;
    return injectDataAttr(el.fullMatch, c.diffIdx);
  });
  return applySvgReplacements(svgContent, map);
}

