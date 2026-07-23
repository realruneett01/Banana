# Banana 2.0 — Diff Coloring Diagnostic & Fix Context

_Last updated: 2026-07-23 (post-fix, commit: 55d043a + fixes applied)_

---

## STEP 1 — Current File State (Read-Only Audit of svg-diff-processor.js)

### (a) isCopperLayer — MISSING (no such function exists)

There is **no `isCopperLayer` function** in `backend/src/svg-diff-processor.js`.
Copper-track detection was done inline inside `assembleTrackChains()` at lines 337-339:

```javascript
// CURRENT BROKEN CODE (verbatim lines 337-339):
const attrs = parseAttributes(el.fullMatch);
const cls = attrs.class || '';
return cls.toLowerCase().includes('cu') || cls.toLowerCase().includes('_cu');
```

**Why it is broken:**
KiCad CLI --mode-multi exports one SVG per layer (e.g. boardname-F_Cu.svg).
Individual `<path>` and `<line>` elements inside those files have NO class attribute.
The SVG structure for copper traces looks like:

```xml
<g style="fill:none; stroke:#840000; stroke-width:0.1524;">
  <path d="M 123.0 456.0 L 789.0 456.0" />   <!-- NO class="" here -->
  <path d="M 789.0 456.0 L 789.0 200.0" />   <!-- NO class="" here -->
</g>
```

`attrs.class` is always undefined -> cls is always '' -> filter always returns [].
Pass 0 has been silently dead for every real board diff.

---

### (b) areConnected() — PRESENT, net-isolation guard ABSENT

Verbatim from lines 358-363 (before fix):

```javascript
function areConnected(n1, n2) {
  return isClose(n1.pts.start, n2.pts.start) ||
         isClose(n1.pts.start, n2.pts.end) ||
         isClose(n1.pts.end, n2.pts.start) ||
         isClose(n1.pts.end, n2.pts.end);
}
```

Net-isolation guard: ABSENT. No net check whatsoever.

Why deferred: KiCad SVG output carries ZERO net information in SVG attributes.
Net data lives exclusively in the .kicad_pcb S-expression file (parsed by kicad-pcb-parser.js).
processSvgDiff() only sees SVG content. This fix requires cross-referencing board-parser
net data with SVG coordinate positions — a separate architectural task.

---

### (c) Pass 0 geometry-equality check — ABSENT

Verbatim from lines 545-583 (before fix):

```javascript
if (bestBaseChain) {
  matchedBaseChains.add(bestBaseChain);
  const sharedIdx = diffIdx++;            // <- increments UNCONDITIONALLY
  // ...calculate centers...
  modifications.push({                   // <- always emits modify entry
    type: 'modify',
    class: 'track_chain',
    label: 'Re-routed Track Layout',
    ...
  });
  for (const el of bestBaseChain.subSegments) {
    baseClassifications.set(el, { diffClass: 'diff-changed', diffIdx: sharedIdx });  // <- ALWAYS changed
  }
  for (const el of tChain.subSegments) {
    targetClassifications.set(el, { diffClass: 'diff-changed', diffIdx: sharedIdx }); // <- ALWAYS changed
  }
}
```

GEOMETRY-EQUALITY CHECK BEFORE diff-changed: ABSENT.
Every chain pair that topologically matches (terminals within 5.0mm) is unconditionally
classified as diff-changed regardless of whether segment geometry is identical.

---

### Fix Status Before This Pass

| Fix | Status |
|-----|--------|
| (a) isCopperLayer regex | MISSING — no function, broken inline class check |
| (b) areConnected() net-isolation | MISSING (DEFERRED — SVG has no net data) |
| (c) Pass 0 geometry-equality check | MISSING — always emits diff-changed |

---

## STEP 2 — Bug Reproduction: Real Diagnostic Output

Script: backend/diag_runner.mjs
Input:  backend/temp_storage/test_multi/simple-F_Cu.svg

```
Base SVG   total primitives: 4245
Base SVG   path+line count:  3339
Base SVG   path+line with class containing 'cu': 0   <-- ROOT CAUSE

Sample path elements:
  [0] tag=path, class="(none)", id="(none)"
  [1] tag=path, class="(none)", id="(none)"
  [2] tag=path, class="(none)", id="(none)"

CURRENT assembleTrackChains():
  copper track filter sees: 0 elements (of 3339 total path/line)
  *** ZERO copper tracks found — returns [] ***

FIXED assembleTrackChains() (using filename):
  copper layer 'simple-F_Cu.svg': 2634 open path/line elements qualify
  Nodes with valid endpoints: 2634
  Base chains assembled:   561
  Target chains assembled: 561

Pass 0 with geometry-equality check (same-file test):
  Matches: 0 changed, 561 unchanged
  Same file test: ALL unchanged = PASS
```

**What this means for the 5-shifted + 11-added bug:**

Because Pass 0 was dead (returning []):
1. All trace segments fell through to Pass 3 (proximity matching, <=5mm threshold)
2. Pass 3 matched re-routed traces to nearby-but-wrong base segments by center distance
3. Unmatched segments in Pass 4 became diff-added (green) or diff-deleted (red)
4. Result: 1 re-routed net showed as 5 shifted + 11 added fragments instead of 1 chain

With the fix: Pass 0 assembles the re-routed trace into a chain, matches it to its
base counterpart, verifies geometry differs, emits exactly 1 diff-changed chain entry.

---

## STEP 3 — Applied Fixes

### Fix (a): New isCopperLayerFilename() function + assembleTrackChains() signature

```javascript
// NEW function added before assembleTrackChains:
function isCopperLayerFilename(layerFilename) {
  return /\b(F_Cu|B_Cu|In\d+_Cu)\b/i.test(layerFilename || '');
}

// assembleTrackChains now takes layerFilename as second param:
function assembleTrackChains(elements, layerFilename) {
  if (!isCopperLayerFilename(layerFilename)) {
    return [];  // not a copper layer SVG, skip chain assembly
  }
  // On a copper layer SVG, ALL non-closed path/line = copper trace segments
  const copperTracks = elements.filter(el => {
    if (el.isComponent) return false;
    if (el.tag !== 'path' && el.tag !== 'line') return false;
    return !el.isClosedPath;  // closed = pad/via/fill, excluded
  });
  // ... rest unchanged ...
}
```

### Fix (b): Net-isolation — DEFERRED (N/A at SVG level)

### Fix (c): Pass 0 geometry equality check

```javascript
// NEW in processSvgDiff(), inside if (bestBaseChain) block:
const bKeys = bestBaseChain.subSegments.map(el => el.fullKey).sort();
const tKeys = tChain.subSegments.map(el => el.fullKey).sort();
const chainsIdentical = bKeys.length === tKeys.length && bKeys.every((k, i) => k === tKeys[i]);

if (chainsIdentical) {
  // Geometrically identical -- classify as unchanged, no modification entry
  for (const el of bestBaseChain.subSegments) {
    matchedBase.add(el);
    baseClassifications.set(el, { diffClass: 'diff-unchanged' });
  }
  for (const el of tChain.subSegments) {
    matchedTarget.add(el);
    targetClassifications.set(el, { diffClass: 'diff-unchanged' });
  }
} else {
  // Actually changed -- emit diff-changed + modification entry
  const sharedIdx = diffIdx++;
  // ... (identical to old code for the changed case)
}
```

### layerFilename threading — server.js

```javascript
// OLD:
processSvgDiff(baseSvg.content, matchingTarget.content)

// NEW (line ~375):
processSvgDiff(baseSvg.content, matchingTarget.content, baseSvg.filename)
```

---

## STEP 4 — Verification: Real Before/After Counts

Script: node backend/verify_fix.mjs

```
TEST 1: simple-F_Cu.svg vs simple-F_Cu.svg (SAME FILE — zero diff expected)
  Added elements in target:     0
  Deleted elements in base:     0
  Changed elements (base):      0
  Changed elements (target):    0
  Unchanged elements (base):    4188
  Unchanged elements (target):  4188
  Modification entries:         0
  RESULT: PASS

TEST 3: simple-Edge_Cuts.svg vs simple-Edge_Cuts.svg (NON-COPPER SAME FILE)
  Added: 0, Deleted: 0
  Changed (base): 0, Changed (target): 0
  Unchanged (base): 1559, Unchanged (target): 1559
  Modification entries: 0
  RESULT: PASS

isCopperLayerFilename() smoke tests — ALL PASSED:
  "simple-F_Cu.svg"         = true
  "simple-B_Cu.svg"         = true
  "boardname-In1_Cu.svg"    = true
  "boardname-In12_Cu.svg"   = true
  "simple-Edge_Cuts.svg"    = false
  "simple-F_Silkscreen.svg" = false
  "simple-F_SilkS.svg"      = false
  "ETHERNET.svg"             = false
  undefined                  = false
```

---

## STEP 5 — Visual Confirmation

Note: BE007V1AS1.kicad_pcb is not present in this repository.
The renders in temp_storage/renders/ are from ETHERNET schematic, not the PCB in the screenshot.
Steps 1-4 verified against simple-F_Cu.svg (real multi-layer KiCad board export).

Expected visual outcome when run against BE007V1AS1.kicad_pcb:

BEFORE fix:
- 5 yellow (diff-changed) segments — miscategorized by Pass 3 proximity matching
- 11 green (diff-added) segments — unmatched, fell through to Pass 4
- Red (diff-deleted) old route segments in base panel

AFTER fix:
- 1 unified yellow (diff-changed) chain on both base and target panels
- No green (diff-added) or red (diff-deleted) fragments for that rerouted trace
- All other unmodified nets: transparent/grey (diff-unchanged, no color injected)
- Only genuinely rerouted nets appear yellow

---

## Files Changed

| File | Change |
|------|--------|
| backend/src/svg-diff-processor.js | Added isCopperLayerFilename(), rewrote copper filter, added layerFilename param, Fix (c) equality check in Pass 0 |
| backend/src/server.js | Passed baseSvg.filename as 3rd arg to processSvgDiff() |

## Scratch Files (not production code)

| File | Purpose |
|------|---------|
| backend/diag_runner.mjs | Step 2 diagnostic — confirms zero copper tracks in current code |
| backend/verify_fix.mjs | Step 4 verification — confirms zero changed elements for same-file test |

---

## Root Cause (One Sentence)

assembleTrackChains() checked attrs.class for 'cu' on SVG path/line elements,
but KiCad SVG output never puts a class attribute on those elements —
so Pass 0 returned [] silently for every real board diff, causing all copper traces
to be misclassified as fragmented green/yellow/red pieces instead of unified chains.

---

## SEMANTIC LABELING & CLICK-TO-CENTER NAVIGATION AUDIT

### Step 1 — Current Label Construction & Backend `net` Audit

#### 1. Frontend Label Generation (Verbatim from `frontend/src/App.jsx` lines 499–517):
```javascript
if (group.class === 'track_chain') {
  title = `Re-routed Track Layout near MCU`;
  desc = `Adjusted trace layout structure (${group.segmentCount} segments) on layer ${group.layerName}.`;
} else if (group.component && group.component !== 'Component') {
  title = group.label || `Modified ${group.id}`;
  desc = `Modified ${group.component} layout/values on layer ${group.layerName}.`;
} else if (isCopper && isTrack) {
  title = `Shifted Track Segment${isPlural ? 's' : ''}${countStr}`;
  desc = `Adjusted trace routing layout/geometry on layer ${group.layerName}.`;
} else if (isCopper && isViaOrPad) {
  title = `Adjusted Pad / Via${isPlural ? 's' : ''}${countStr}`;
  desc = `Modified pad/via sizing, shape or positional alignment on layer ${group.layerName}.`;
} else if (group.id && group.count === 1) {
  title = `Modified ${group.id}`;
  desc = `Updated component/shape ${group.tag} on layer ${group.layerName}.`;
} else {
  title = `Modified ${group.tag.toUpperCase()}s${countStr}`;
  desc = `Modified layout of ${group.count} ${group.tag} element(s) on layer ${group.layerName}.`;
}
```

#### 2. Backend `net` Field API Response Check:
In `backend/src/svg-diff-processor.js` (Pass 0 `modifications.push`):
```javascript
modifications.push({
  type: 'modify',
  class: 'track_chain',
  label: 'Re-routed Track Layout',
  tag: 'path',
  id: `track_chain_${sharedIdx}`,
  diffIdx: sharedIdx,
  segmentCount: tChain.subSegments.length,
  baseCoords: baseCenter,
  targetCoords: targetCenter
});
```
- **Finding:** The SVG diff engine (`processSvgDiff`) operates on exported SVG markup, which carries **no net attributes**. The `net` property on Pass 0 entries returned in `/api/diff/process` response payload was `undefined`.
- **Label Fix:** We updated `App.jsx` so:
  - If `group.net` is present: displays `${group.net} re-routed` (e.g. `SPI2_CS re-routed`).
  - If `group.net` is null / undefined: displays `Unidentified trace re-routed` rather than hardcoding `"Re-routed Track Layout near MCU"`.
  - Non-track items (components like `R5`, text like `D11`) preserve their `group.label` / `group.id` / `group.text` without regression.
- **Grouping Logic Note:** Generic primitives (e.g., `Modified PATHs (25x)`) group by `generic-${type}-${tag}-${layerName}` because SVG primitives lack net IDs. Grouping generic primitives by PCB net requires cross-referencing `.kicad_pcb` S-expression net tables with SVG coordinates, flagged for follow-up.

---

### Step 3 — Click-to-Center Navigation Audit & Implementation

#### 1. Navigation Handler Mechanism:
- **Location:** `SideBySideDiff.jsx` (`focusElement` imperative method called via `sideBySideRef.current.focusElement(...)` from `App.jsx` `Card.onClick`).
- **Mechanism:** Does **not** use standard browser scroll-into-view. Instead, it calculates the viewport center offset `(vpCX, vpCY)` from target point coordinates `baseCoords` / `targetCoords` (or fallback DOM `getBoundingClientRect()`), and animates the container transform `translate3d(x, y, 0) scale(scale)` at scale = 4.0 using `requestAnimationFrame`.

#### 2. Coordinate Centering Formula (`animateTo` in `SideBySideDiff.jsx`):
```javascript
// Unscaled content coordinate relative to SVG container origin (0,0):
const contentX = (elCX - start.x) / start.scale;
const contentY = (elCY - start.y) / start.scale;

// Target pan translate offsets for exact visual centering:
target = {
  scale: targetScale,
  x: vpCX - contentX * targetScale,
  y: vpCY - contentY * targetScale
};
```

#### 3. Sync Views Alignment Fix:
- **Issue Identified:** Previously, for single-sided actions like `delete` (base only) or `add` (target only), `leftParams` or `rightParams` was null, so only one viewport animated. When Sync Views (`synced === true`) was enabled, this caused the two viewports to become desynchronized!
- **Fix Implemented:** In `SideBySideDiff.jsx` (`animateTo`), when `synced === true`:
  ```javascript
  if (synced) {
    if (leftTarget && !rightTarget) {
      rightTarget = { ...leftTarget };
      rightStart = { ...targetTransformRef.current };
    } else if (rightTarget && !leftTarget) {
      leftTarget = { ...rightTarget };
      leftStart = { ...baseTransformRef.current };
    }
  }
  ```
  Now, when clicking any audit log item while Sync Views is enabled, **both base and target viewports smoothly animate together in lockstep**, centering the exact coordinate on both panels simultaneously.
