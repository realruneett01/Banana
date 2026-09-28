/**
 * Banana 2.0 — SVG Multi-Pass Vector Diff Processor
 */

import {
  extractElements,
  getElementCenter,
  getSegmentEndpoints,
  getDistance,
  extractRefDes,
  TOLERANCE_EPSILON
} from './svg-primitives.js';

import {
  cleanNetName,
  cleanLayerName,
  annotateSvgSinglePass,
  annotateSvgDataOnly,
  rewriteSchematicBackground
} from './svg-styler.js';

import { generatePreciseAuditLog } from './svg-semantic-resolver.js';
import { assembleTrackChains, matchTrackChainsPass, isCopperLayerFilename } from './track-chains.js';

export { cleanNetName, cleanLayerName, extractElements, isCopperLayerFilename, assembleTrackChains };

function recordMatchedPair(tEl, bestMatch, ctx) {
  ctx.matchedBase.add(bestMatch);
  ctx.matchedTarget.add(tEl);
  ctx.matchedTargetToBase.set(tEl, bestMatch);
  ctx.matchedBaseToTarget.set(bestMatch, tEl);

  const dist = getDistance(bestMatch, tEl);
  const stateClass = dist > TOLERANCE_EPSILON ? 'diff-changed' : 'diff-unchanged';
  ctx.baseClassifications.set(bestMatch, { diffClass: stateClass, displacement: dist });
  ctx.targetClassifications.set(tEl, { diffClass: stateClass, displacement: dist });
}

function findClosestCandidate(target, candidates) {
  let best = candidates[0];
  let minD = getDistance(best, target);
  for (let i = 1; i < candidates.length; i++) {
    const d = getDistance(candidates[i], target);
    if (d < minD) {
      minD = d;
      best = candidates[i];
    }
  }
  return best;
}

function isEligibleRefDesTarget(tEl, ctx) {
  if (tEl.isWorksheetFrame) return false;
  if (ctx.matchedTarget.has(tEl)) return false;
  return Boolean(tEl.isComponent && tEl.refDes);
}

function findRefDesCandidates(tEl, ctx) {
  return ctx.baseElements.filter(b => (
    !b.isWorksheetFrame && !ctx.matchedBase.has(b) && b.isComponent && b.refDes === tEl.refDes
  ));
}

export function matchRefDesComponentsPass(ctx) {
  for (const tEl of ctx.targetElements) {
    if (!isEligibleRefDesTarget(tEl, ctx)) continue;
    const candidates = findRefDesCandidates(tEl, ctx);
    if (candidates.length === 0) continue;
    const bestMatch = findClosestCandidate(tEl, candidates);
    recordMatchedPair(tEl, bestMatch, ctx);
  }
}

function buildExactKeyGroups(baseElements, matchedBase) {
  const groups = new Map();
  for (const el of baseElements) {
    if (el.isWorksheetFrame || matchedBase.has(el)) continue;
    let list = groups.get(el.fullKey);
    if (!list) {
      list = [];
      groups.set(el.fullKey, list);
    }
    list.push(el);
  }
  return groups;
}

export function matchExactPrimitivesPass(ctx) {
  const baseKeyGroups = buildExactKeyGroups(ctx.baseElements, ctx.matchedBase);

  for (const tEl of ctx.targetElements) {
    if (tEl.isWorksheetFrame || ctx.matchedTarget.has(tEl)) continue;
    const bEls = baseKeyGroups.get(tEl.fullKey);
    if (!bEls || bEls.length === 0) continue;

    const bEl = bEls.shift();
    ctx.matchedBase.add(bEl);
    ctx.matchedTarget.add(tEl);
    ctx.baseClassifications.set(bEl, { diffClass: 'diff-unchanged' });
    ctx.targetClassifications.set(tEl, { diffClass: 'diff-unchanged' });
  }
}

function findBestProximityCandidate(tEl, candidates, threshold) {
  let bestMatch = null;
  let minDistance = threshold;
  for (const bEl of candidates) {
    const dist = getDistance(tEl, bEl);
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = bEl;
    }
  }
  return bestMatch;
}

export function matchProximityPrimitivesPass(ctx) {
  const PROXIMITY_THRESHOLD = 5.0;

  for (const tEl of ctx.targetElements) {
    if (tEl.isWorksheetFrame || ctx.matchedTarget.has(tEl)) continue;

    const candidates = ctx.baseElements.filter(bEl => (
      !bEl.isWorksheetFrame && !ctx.matchedBase.has(bEl) && bEl.tag === tEl.tag
    ));
    if (candidates.length === 0) continue;

    const bestMatch = findBestProximityCandidate(tEl, candidates, PROXIMITY_THRESHOLD);
    if (bestMatch) {
      recordMatchedPair(tEl, bestMatch, ctx);
    }
  }
}

function buildPointBbox(center) {
  return {
    x1: center.x - 1,
    y1: center.y - 1,
    x2: center.x + 1,
    y2: center.y + 1
  };
}

export function classifyDeletedBaseElements(ctx, startDiffIdx) {
  let diffIdx = startDiffIdx;
  for (const el of ctx.baseElements) {
    if (el.isWorksheetFrame || ctx.baseClassifications.has(el)) continue;
    const center = getElementCenter(el);
    const endpts = getSegmentEndpoints(el);
    ctx.baseClassifications.set(el, {
      diffClass: 'diff-deleted',
      diffIdx: diffIdx++,
      refDes: el.refDes,
      name: el.text || el.id || el.tag,
      layer: ctx.layerFilename,
      center,
      baseCoords: center,
      startPoint: endpts?.start ?? null,
      endPoint: endpts?.end ?? null,
      bbox: buildPointBbox(center)
    });
  }
  return diffIdx;
}

export function classifyAddedTargetElement(el, ctx, addIdx) {
  const center = getElementCenter(el);
  const endpts = getSegmentEndpoints(el);
  ctx.targetClassifications.set(el, {
    diffClass: 'diff-added',
    diffIdx: addIdx,
    refDes: el.refDes,
    name: el.text || el.id || el.tag,
    layer: ctx.layerFilename,
    center,
    targetCoords: center,
    startPoint: endpts?.start ?? null,
    endPoint: endpts?.end ?? null,
    bbox: buildPointBbox(center)
  });
}

function buildElementBbox(p1, p2) {
  return {
    x1: Math.min(p1.x, p2.x) - 1,
    y1: Math.min(p1.y, p2.y) - 1,
    x2: Math.max(p1.x, p2.x) + 1,
    y2: Math.max(p1.y, p2.y) + 1
  };
}

export function linkChangedElementPair(el, bEl, ctx, sharedIdx) {
  const tClass = ctx.targetClassifications.get(el);
  const bClass = ctx.baseClassifications.get(bEl);
  const tCenter = getElementCenter(el);
  const bCenter = getElementCenter(bEl);
  const bbox = buildElementBbox(bCenter, tCenter);
  const displacement = tClass.displacement ?? Math.hypot(tCenter.x - bCenter.x, tCenter.y - bCenter.y);

  Object.assign(tClass, {
    diffIdx: sharedIdx,
    refDes: el.refDes,
    name: el.text || el.id || el.tag,
    layer: ctx.layerFilename,
    center: tCenter,
    targetCoords: tCenter,
    baseCoords: bCenter,
    bbox,
    displacement
  });

  if (bClass) {
    Object.assign(bClass, {
      diffIdx: sharedIdx,
      refDes: bEl.refDes,
      name: bEl.text || bEl.id || bEl.tag,
      layer: ctx.layerFilename,
      center: bCenter,
      baseCoords: bCenter,
      targetCoords: tCenter,
      bbox,
      displacement
    });
  }
}

export function classifyResidualElementsPass(ctx, startDiffIdx) {
  let diffIdx = classifyDeletedBaseElements(ctx, startDiffIdx);

  for (const el of ctx.targetElements) {
    if (el.isWorksheetFrame) continue;
    if (!ctx.targetClassifications.has(el)) {
      classifyAddedTargetElement(el, ctx, diffIdx++);
    } else if (ctx.targetClassifications.get(el).diffClass === 'diff-changed') {
      const classification = ctx.targetClassifications.get(el);
      if (classification.diffIdx === undefined && ctx.matchedTargetToBase.has(el)) {
        const bEl = ctx.matchedTargetToBase.get(el);
        linkChangedElementPair(el, bEl, ctx, diffIdx++);
      }
    }
  }

  return diffIdx;
}

const DROPPED_TAGS = new Set(['g', 'rect', 'polygon']);

function isDroppedCandidate(el, diffClass) {
  const isUnchanged = !diffClass || diffClass === 'diff-unchanged';
  return isUnchanged && DROPPED_TAGS.has(el.tag);
}

function checkAddedTwin(el, elRef, baseElements) {
  return baseElements.some(b => {
    const bRef = extractRefDes(b);
    return (elRef && bRef && bRef === elRef) || (b.text && b.text === el.text);
  });
}

function runDiagnosticChecks(targetElements, baseElements, targetClassifications) {
  let misclassifiedCount = 0;
  let droppedCount = 0;

  for (const el of targetElements) {
    const classification = targetClassifications.get(el);
    const diffClass = classification?.diffClass;

    if (diffClass === 'diff-added' && checkAddedTwin(el, extractRefDes(el), baseElements)) {
      misclassifiedCount++;
    }

    if (isDroppedCandidate(el, diffClass)) {
      droppedCount++;
    }
  }

  return { misclassifiedCount, droppedCount };
}

function createMatchContext(baseElements, targetElements, layerFilename) {
  return {
    baseElements,
    targetElements,
    matchedBase: new Set(),
    matchedTarget: new Set(),
    matchedTargetToBase: new Map(),
    matchedBaseToTarget: new Map(),
    baseClassifications: new Map(),
    targetClassifications: new Map(),
    layerFilename
  };
}

export function processSvgDiff(baseSvg, targetSvg, optionsOrLayer = {}, pcbMetadata = null, startDiffIdx = 0) {
  const tTotalStart = performance.now();
  const opts = typeof optionsOrLayer === 'object' && optionsOrLayer !== null
    ? optionsOrLayer
    : { layerFilename: optionsOrLayer, pcbMetadata, startDiffIdx };

  const layerFilename = opts.layerFilename;
  const metadata = opts.pcbMetadata ?? pcbMetadata;
  const initialDiffIdx = opts.startDiffIdx ?? startDiffIdx ?? 0;

  const tBgStart = performance.now();
  baseSvg = rewriteSchematicBackground(baseSvg);
  targetSvg = rewriteSchematicBackground(targetSvg);
  const tBg = performance.now() - tBgStart;

  const tExtractStart = performance.now();
  const baseElements = extractElements(baseSvg);
  const targetElements = extractElements(targetSvg);
  const tExtract = performance.now() - tExtractStart;

  const ctx = createMatchContext(baseElements, targetElements, layerFilename);

  // PASS 0: Track Chains
  const tPass0Start = performance.now();
  const baseChains = assembleTrackChains(baseElements, layerFilename);
  const targetChains = assembleTrackChains(targetElements, layerFilename);
  let diffIdx = matchTrackChainsPass(baseChains, targetChains, ctx, layerFilename, initialDiffIdx);
  const tPass0 = performance.now() - tPass0Start;

  // PASS 1: RefDes
  const tPass1Start = performance.now();
  matchRefDesComponentsPass(ctx);
  const tPass1 = performance.now() - tPass1Start;

  // PASS 2: Exact Primitives
  const tPass2Start = performance.now();
  matchExactPrimitivesPass(ctx);
  const tPass2 = performance.now() - tPass2Start;

  // PASS 3: Proximity Primitives
  const tPass3Start = performance.now();
  matchProximityPrimitivesPass(ctx);
  const tPass3 = performance.now() - tPass3Start;

  // PASS 4: Residual Elements
  const tPass4Start = performance.now();
  diffIdx = classifyResidualElementsPass(ctx, diffIdx);
  const tPass4 = performance.now() - tPass4Start;

  // Annotate
  const tAnnotateStart = performance.now();
  const annotatedBase = annotateSvgSinglePass(baseSvg, baseElements, ctx.baseClassifications);
  const annotatedTarget = annotateSvgSinglePass(targetSvg, targetElements, ctx.targetClassifications);
  const cleanBaseSvg = annotateSvgDataOnly(baseSvg, baseElements, ctx.baseClassifications);
  const cleanTargetSvg = annotateSvgDataOnly(targetSvg, targetElements, ctx.targetClassifications);
  const tAnnotate = performance.now() - tAnnotateStart;

  // Audit Log
  const modifications = generatePreciseAuditLog(ctx.targetClassifications, ctx.baseClassifications, metadata, layerFilename);

  // Diagnostic
  const tDiagStart = performance.now();
  runDiagnosticChecks(targetElements, baseElements, ctx.targetClassifications);
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

  return { baseSvg: annotatedBase, targetSvg: annotatedTarget, cleanBaseSvg, cleanTargetSvg, modifications, telemetry, nextDiffIdx: diffIdx };
}
