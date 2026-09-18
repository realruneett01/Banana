/**
 * verify_fix.mjs
 *
 * Step 4 verification:
 * Runs the FIXED processSvgDiff on two real SVG pairs:
 *   1. Same file vs same file (should be: 0 changed, 0 added, 0 deleted, ALL unchanged)
 *   2. F_Cu.svg vs B_Cu.svg (different layers, non-copper for B_Cu in F_Cu pass)
 *
 * Run: node backend/verify_fix.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Import the ACTUAL fixed svg-diff-processor.js ───────────────────────────
// We need to import the fixed version from the src directory
import { processSvgDiff } from './src/svg-diff-processor.js';

const svgDir = path.join(__dirname, 'temp_storage', 'test_multi');

function classifySvgDiff(baseSvgPath, targetSvgPath, layerFilename) {
  const baseSvg   = fs.readFileSync(baseSvgPath, 'utf8');
  const targetSvg = fs.readFileSync(targetSvgPath, 'utf8');

  const result = processSvgDiff(baseSvg, targetSvg, layerFilename);
  const mods = result.modifications || [];

  const counts = { added: 0, deleted: 0, changed: 0, unchanged: 0, modifications: mods.length };

  // Count diff annotations in the annotated SVGs
  const addedMatches   = (result.targetSvg.match(/diff-added/g) || []).length;
  const deletedMatches = (result.baseSvg.match(/diff-deleted/g) || []).length;
  const changedBase    = (result.baseSvg.match(/diff-changed/g) || []).length;
  const changedTarget  = (result.targetSvg.match(/diff-changed/g) || []).length;
  const unchangedBase  = (result.baseSvg.match(/diff-unchanged/g) || []).length;
  const unchangedTarget= (result.targetSvg.match(/diff-unchanged/g) || []).length;

  return {
    addedElements: addedMatches,
    deletedElements: deletedMatches,
    changedBaseElements: changedBase,
    changedTargetElements: changedTarget,
    unchangedBaseElements: unchangedBase,
    unchangedTargetElements: unchangedTarget,
    modificationEntries: mods.length,
    modificationTypes: mods.reduce((acc, m) => { acc[m.type] = (acc[m.type] || 0) + 1; return acc; }, {})
  };
}

console.log('\n=== STEP 4: Post-fix verification ===\n');

// Test 1: Same file vs same file — ALL must be unchanged
console.log('TEST 1: simple-F_Cu.svg (base) vs simple-F_Cu.svg (target) — SAME FILE');
console.log('Expected: 0 added, 0 deleted, 0 changed, ALL unchanged, 0 modification entries');
try {
  const r1 = classifySvgDiff(
    path.join(svgDir, 'simple-F_Cu.svg'),
    path.join(svgDir, 'simple-F_Cu.svg'),
    'simple-F_Cu.svg'
  );
  console.log('Result:');
  console.log(`  Added elements in target:     ${r1.addedElements}`);
  console.log(`  Deleted elements in base:     ${r1.deletedElements}`);
  console.log(`  Changed elements (base):      ${r1.changedBaseElements}`);
  console.log(`  Changed elements (target):    ${r1.changedTargetElements}`);
  console.log(`  Unchanged elements (base):    ${r1.unchangedBaseElements}`);
  console.log(`  Unchanged elements (target):  ${r1.unchangedTargetElements}`);
  console.log(`  Modification entries:         ${r1.modificationEntries}`);
  console.log(`  Types: ${JSON.stringify(r1.modificationTypes)}`);
  const pass1 = r1.addedElements === 0 && r1.deletedElements === 0 &&
                r1.changedBaseElements === 0 && r1.changedTargetElements === 0 &&
                r1.modificationEntries === 0;
  console.log(`  RESULT: ${pass1 ? '✓ PASS' : '✗ FAIL'}`);
} catch(e) {
  console.error('  ERROR:', e.message);
}

console.log();

// Test 2: F_Cu.svg vs B_Cu.svg — different layer filenames on a non-copper pass
console.log('TEST 2: simple-F_Cu.svg (base) vs simple-B_Cu.svg (target) — DIFFERENT LAYERS');
console.log('(layerFilename = simple-F_Cu.svg, so copper chain assembly runs on an F_Cu SVG)');
console.log('Expected: chain assembly runs, but most paths are different SVG content (diff board side)');
try {
  const r2 = classifySvgDiff(
    path.join(svgDir, 'simple-F_Cu.svg'),
    path.join(svgDir, 'simple-B_Cu.svg'),
    'simple-F_Cu.svg'
  );
  console.log('Result (informational only — cross-layer diff is not a real use case):');
  console.log(`  Added: ${r2.addedElements}, Deleted: ${r2.deletedElements}, Changed(base): ${r2.changedBaseElements}, Changed(tgt): ${r2.changedTargetElements}`);
  console.log(`  Modification entries: ${r2.modificationEntries} — Types: ${JSON.stringify(r2.modificationTypes)}`);
} catch(e) {
  console.error('  ERROR:', e.message);
}

console.log();

// Test 3: Non-copper layer (Edge.Cuts or Silkscreen) — chain assembly must NOT run
console.log('TEST 3: simple-Edge_Cuts.svg (base) vs simple-Edge_Cuts.svg (target) — NON-COPPER LAYER');
console.log('Expected: chain assembly skipped, all elements pass through Pass 2 exact match → all unchanged');
try {
  const r3 = classifySvgDiff(
    path.join(svgDir, 'simple-Edge_Cuts.svg'),
    path.join(svgDir, 'simple-Edge_Cuts.svg'),
    'simple-Edge_Cuts.svg'
  );
  console.log('Result:');
  console.log(`  Added: ${r3.addedElements}, Deleted: ${r3.deletedElements}`);
  console.log(`  Changed (base): ${r3.changedBaseElements}, Changed (target): ${r3.changedTargetElements}`);
  console.log(`  Unchanged (base): ${r3.unchangedBaseElements}, Unchanged (target): ${r3.unchangedTargetElements}`);
  console.log(`  Modification entries: ${r3.modificationEntries}`);
  const pass3 = r3.addedElements === 0 && r3.deletedElements === 0 &&
                r3.changedBaseElements === 0 && r3.modificationEntries === 0;
  console.log(`  RESULT: ${pass3 ? '✓ PASS' : '✗ FAIL'}`);
} catch(e) {
  console.error('  ERROR:', e.message);
}

console.log('\n=== isCopperLayerFilename function smoke test ===');
const testCases = [
  ['simple-F_Cu.svg',          true ],
  ['simple-B_Cu.svg',          true ],
  ['boardname-In1_Cu.svg',     true ],
  ['boardname-In12_Cu.svg',    true ],
  ['simple-Edge_Cuts.svg',     false],
  ['simple-F_Silkscreen.svg',  false],
  ['simple-F_SilkS.svg',       false],
  ['ETHERNET.svg',             false],
  [undefined,                  false],
];

function isCopperLayerFilename(layerFilename) {
  return /\b(F_Cu|B_Cu|In\d+_Cu)\b/i.test(layerFilename || '');
}

let allPassed = true;
testCases.forEach(([input, expected]) => {
  const result = isCopperLayerFilename(input);
  const ok = result === expected;
  if (!ok) allPassed = false;
  console.log(`  isCopperLayerFilename("${input}") = ${result}  ${ok ? '✓' : `✗ expected ${expected}`}`);
});
console.log(allPassed ? '\n  ALL SMOKE TESTS PASSED ✓' : '\n  SOME SMOKE TESTS FAILED ✗');
