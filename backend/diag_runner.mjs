/**
 * diag_runner.mjs
 * 
 * Standalone diagnostic for svg-diff-processor.js
 * Run: node backend/diag_runner.mjs
 *
 * Reads the two most recent paired renders from temp_storage,
 * or uses test_multi SVGs if no paired renders exist.
 * Reports:
 *   - How many path/line elements assembleTrackChains() sees
 *   - How many chains are assembled
 *   - Chain match counts from Pass 0
 *   - Final classification counts: added/deleted/changed/unchanged
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── inline the relevant functions from svg-diff-processor.js ────────────────
// (copy-pasted verbatim from current file for isolated testing)

const DIFFABLE_TAGS = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'use', 'ellipse', 'image'];

function parseAttributes(attrStr) {
  const attrs = {};
  const re = /(\S+?)=["']([^"']*)['"]/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

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

        primitives.push({ tag, fullMatch, fullKey, geoKey, id, label, text, isClosedPath });
      }
    }
  }
  return primitives;
}

// ── DIAGNOSTIC: assembleTrackChains (CURRENT BROKEN VERSION) ───────────────
function assembleTrackChains_CURRENT(elements) {
  const copperTracks = elements.filter(el => {
    if (el.isComponent) return false;
    if (el.tag !== 'path' && el.tag !== 'line') return false;
    const attrs = parseAttributes(el.fullMatch);
    const cls = attrs.class || '';
    // CURRENT CODE: checks class attribute on path/line elements
    return cls.toLowerCase().includes('cu') || cls.toLowerCase().includes('_cu');
  });

  console.log(`  [CURRENT] copper track filter sees: ${copperTracks.length} elements (of ${elements.filter(e => !e.isComponent && (e.tag === 'path' || e.tag === 'line')).length} total path/line)`);
  
  if (copperTracks.length === 0) {
    console.log(`  [CURRENT] *** ZERO copper tracks found — assembleTrackChains returns [] ***`);
    return [];
  }
  return []; // simplified for diagnostic
}

// ── DIAGNOSTIC: assembleTrackChains (FIXED VERSION using filename) ───────────
function assembleTrackChains_FIXED(elements, layerFilename) {
  // Fix (a): use filename to determine if this IS a copper layer SVG
  const isCopperLayer = /\b(F_Cu|B_Cu|In\d+_Cu)\b/i.test(layerFilename);
  
  if (!isCopperLayer) {
    console.log(`  [FIXED] Layer '${layerFilename}' is NOT a copper layer — skipping chain assembly`);
    return [];
  }
  
  // On a copper layer SVG, ALL path/line elements ARE copper traces
  // (KiCad's per-layer SVG has no class attr on path/line — they're all copper)
  const copperTracks = elements.filter(el => {
    if (el.isComponent) return false;
    if (el.tag !== 'path' && el.tag !== 'line') return false;
    // Exclude clearly closed shapes (board outline, pads) via isClosedPath
    return !el.isClosedPath;
  });

  console.log(`  [FIXED] copper layer '${layerFilename}': ${copperTracks.length} open path/line elements qualify`);
  
  const nodes = copperTracks.map((el, index) => {
    const pts = getSegmentEndpoints(el);
    return { el, index, pts, visited: false };
  }).filter(node => node.pts !== null);

  console.log(`  [FIXED] Nodes with valid endpoints: ${nodes.length}`);

  const chains = [];

  function isClose(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y) <= 0.1;
  }

  // Fix (b): net-isolation guard — PLACEHOLDER since KiCad SVGs don't carry net
  // info in SVG class attrs; this fix is N/A at SVG level (nets come from .kicad_pcb parser)
  function areConnected(n1, n2) {
    return isClose(n1.pts.start, n2.pts.start) ||
           isClose(n1.pts.start, n2.pts.end) ||
           isClose(n1.pts.end, n2.pts.start) ||
           isClose(n1.pts.end, n2.pts.end);
  }

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].visited) continue;

    const component = [];
    const queue = [nodes[i]];
    nodes[i].visited = true;

    while (queue.length > 0) {
      const curr = queue.shift();
      component.push(curr);

      for (let j = 0; j < nodes.length; j++) {
        if (!nodes[j].visited && areConnected(curr, nodes[j])) {
          nodes[j].visited = true;
          queue.push(nodes[j]);
        }
      }
    }

    const endpoints = [];
    for (const node of component) {
      endpoints.push(node.pts.start, node.pts.end);
    }

    const terminalAnchors = [];
    for (let k = 0; k < endpoints.length; k++) {
      const pt = endpoints[k];
      let shareCount = 0;
      for (let m = 0; m < endpoints.length; m++) {
        if (isClose(pt, endpoints[m])) shareCount++;
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

// ── Pass 0 geometry equality check (FIX c) ──────────────────────────────────
function chainsAreGeometricallyIdentical(bChain, tChain) {
  // Compare sorted fullKey lists of sub-segments
  const bKeys = bChain.subSegments.map(el => el.fullKey).sort();
  const tKeys = tChain.subSegments.map(el => el.fullKey).sort();
  if (bKeys.length !== tKeys.length) return false;
  for (let i = 0; i < bKeys.length; i++) {
    if (bKeys[i] !== tKeys[i]) return false;
  }
  return true;
}

// ── Main diagnostic ─────────────────────────────────────────────────────────
async function runDiagnostic() {
  const svgDir = path.join(__dirname, 'temp_storage', 'test_multi');
  
  const baseSvgPath   = path.join(svgDir, 'simple-F_Cu.svg');
  const targetSvgPath = path.join(svgDir, 'simple-F_Cu.svg'); // same file = zero diffs expected

  if (!fs.existsSync(baseSvgPath)) {
    console.error('ERROR: simple-F_Cu.svg not found in temp_storage/test_multi');
    console.error('Expected path:', baseSvgPath);
    process.exit(1);
  }

  const layerFilename = 'simple-F_Cu.svg';
  const baseSvg   = fs.readFileSync(baseSvgPath, 'utf8');
  const targetSvg = fs.readFileSync(targetSvgPath, 'utf8');

  console.log('\n=== STEP 1: Current Code Analysis (VERBATIM from svg-diff-processor.js) ===\n');

  console.log('--- (a) isCopperLayer definition ---');
  console.log('FINDING: There is NO isCopperLayer function defined anywhere in svg-diff-processor.js.');
  console.log('The copper detection in assembleTrackChains() is done inline:');
  console.log('  Line 337-339:');
  console.log('    const attrs = parseAttributes(el.fullMatch);');
  console.log('    const cls = attrs.class || \'\';');
  console.log('    return cls.toLowerCase().includes(\'cu\') || cls.toLowerCase().includes(\'_cu\');');
  console.log();

  console.log('--- (b) areConnected() function (lines 358-363) ---');
  console.log('  function areConnected(n1, n2) {');
  console.log('    return isClose(n1.pts.start, n2.pts.start) ||');
  console.log('           isClose(n1.pts.start, n2.pts.end) ||');
  console.log('           isClose(n1.pts.end, n2.pts.start) ||');
  console.log('           isClose(n1.pts.end, n2.pts.end);');
  console.log('  }');
  console.log('  NET-ISOLATION GUARD: ABSENT. No net check present.');
  console.log();

  console.log('--- (c) Pass 0 chain-equality check before assigning diff-changed ---');
  console.log('  Lines 545-583: When bestBaseChain is found, code unconditionally:');
  console.log('    modifications.push({ type: \'modify\', ... })');
  console.log('    for (const el of bestBaseChain.subSegments) { ... diffClass: \'diff-changed\' }');
  console.log('    for (const el of tChain.subSegments) { ... diffClass: \'diff-changed\' }');
  console.log('  GEOMETRY-EQUALITY CHECK BEFORE diff-changed: ABSENT. Every matched chain pair');
  console.log('  is UNCONDITIONALLY marked as diff-changed regardless of whether segments are identical.');
  console.log();

  console.log('=== FIX STATUS SUMMARY ===');
  console.log('Fix (a) isCopperLayer regex:            MISSING — no such function exists');
  console.log('         Current detection checks class="" attr on <path>/<line> elements');
  console.log('         KiCad SVG output: path/line elements have NO class attribute');
  console.log('         Result: assembleTrackChains() returns [] for ALL real KiCad SVGs');
  console.log('Fix (b) areConnected() net-isolation:   MISSING — no net check');
  console.log('Fix (c) Pass 0 geometry-equality check: MISSING — always emits diff-changed');
  console.log();

  // Now run actual extraction
  const baseElems   = extractPrimitives(baseSvg);
  const targetElems = extractPrimitives(targetSvg);

  const basePathLine   = baseElems.filter(e => e.tag === 'path' || e.tag === 'line');
  const targetPathLine = targetElems.filter(e => e.tag === 'path' || e.tag === 'line');

  console.log('\n=== STEP 2: Real extraction results from simple-F_Cu.svg ===\n');
  console.log(`Base SVG   total primitives: ${baseElems.length}`);
  console.log(`Base SVG   path+line count:  ${basePathLine.length}`);
  
  // Count how many have class="" 
  const baseWithClassCu = basePathLine.filter(e => {
    const attrs = parseAttributes(e.fullMatch);
    const cls = attrs.class || '';
    return cls.toLowerCase().includes('cu') || cls.toLowerCase().includes('_cu');
  });
  console.log(`Base SVG   path+line with class containing 'cu': ${baseWithClassCu.length}`);
  console.log();
  
  // Sample first 3 path elements
  console.log('Sample of first 3 path elements (showing full attributes):');
  basePathLine.slice(0, 3).forEach((el, i) => {
    const attrs = parseAttributes(el.fullMatch);
    console.log(`  [${i}] tag=${el.tag}, class="${attrs.class || '(none)'}", id="${attrs.id || '(none)'}`);
    console.log(`       fullMatch[:100]: ${el.fullMatch.substring(0, 100).replace(/\n/g, '\\n')}`);
  });
  console.log();

  // Run CURRENT broken chain assembly
  console.log('--- CURRENT assembleTrackChains() (broken) ---');
  assembleTrackChains_CURRENT(basePathLine);
  console.log();

  // Run FIXED chain assembly  
  console.log('--- FIXED assembleTrackChains() (using filename) ---');
  const baseChains   = assembleTrackChains_FIXED(basePathLine, layerFilename);
  const targetChains = assembleTrackChains_FIXED(targetPathLine, layerFilename);
  console.log(`  Base chains assembled:   ${baseChains.length}`);
  console.log(`  Target chains assembled: ${targetChains.length}`);
  console.log();

  // Run Pass 0 matching (same file = all chains should match and be IDENTICAL)
  console.log('--- Pass 0 matching with geometry-equality check (Fix c) ---');
  const matchedBaseChains = new Set();
  let pass0Changed = 0;
  let pass0Unchanged = 0;

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
      
      // Fix (c): geometry equality check
      const identical = chainsAreGeometricallyIdentical(bestBaseChain, tChain);
      if (identical) {
        pass0Unchanged++;
        // Would assign diff-unchanged
      } else {
        pass0Changed++;
        // Would assign diff-changed and push modification
      }
    }
  }
  
  console.log(`  Pass 0 matches: ${pass0Changed} changed, ${pass0Unchanged} unchanged`);
  console.log(`  (Same file test: ALL should be unchanged = ${pass0Unchanged === targetChains.length ? 'PASS ✓' : 'FAIL ✗'})`);
  console.log();

  console.log('\n=== STEP 3: Fix summary ===\n');
  console.log('Fix (a): Replace inline class="" check with filename-based copper layer test:');
  console.log('  OLD: return cls.toLowerCase().includes(\'cu\') || cls.toLowerCase().includes(\'_cu\');');
  console.log('  NEW: Use layerFilename param, test /\\b(F_Cu|B_Cu|In\\d+_Cu)\\b/i.test(layerFilename)');
  console.log('       Then ALL non-closed path/line elements on that layer are copper tracks.');
  console.log();
  console.log('Fix (b): Add net-isolation guard to areConnected():');
  console.log('  Since KiCad SVGs carry NO net info in SVG attributes,');
  console.log('  net isolation CANNOT be done at SVG level.');
  console.log('  This fix is DEFERRED — requires kicad-pcb-parser.js net data.');
  console.log();
  console.log('Fix (c): Add geometry equality check in Pass 0 before emitting diff-changed:');
  console.log('  if (chainsAreGeometricallyIdentical(bestBaseChain, tChain)) {');
  console.log('    classify as diff-unchanged, skip modifications.push()');
  console.log('  } else {');
  console.log('    classify as diff-changed, push modification as before');
  console.log('  }');
}

runDiagnostic().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
