/**
 * Banana 2.0 — SVG Multi-Pass Vector Diff Processor
 */

import {
	extractElements,
	extractRefDes,
	getDistance,
	getElementCenter,
	getSegmentEndpoints,
	TOLERANCE_EPSILON,
} from "./svg-primitives.js";
import { generatePreciseAuditLog } from "./svg-semantic-resolver.js";
import {
	annotateSvgDataOnly,
	annotateSvgSinglePass,
	cleanLayerName,
	cleanNetName,
	rewriteSchematicBackground,
} from "./svg-styler.js";
import {
	assembleTrackChains,
	isCopperLayerFilename,
	matchTrackChainsPass,
} from "./track-chains.js";

export {
	assembleTrackChains,
	cleanLayerName,
	cleanNetName,
	extractElements,
	isCopperLayerFilename,
};

function recordMatchedPair(tEl, bestMatch, ctx) {
	ctx.matchedBase.add(bestMatch);
	ctx.matchedTarget.add(tEl);
	ctx.matchedTargetToBase.set(tEl, bestMatch);
	ctx.matchedBaseToTarget.set(bestMatch, tEl);

	const dist = getDistance(bestMatch, tEl);
	const stateClass =
		dist > TOLERANCE_EPSILON ? "diff-changed" : "diff-unchanged";
	ctx.baseClassifications.set(bestMatch, {
		diffClass: stateClass,
		displacement: dist,
	});
	ctx.targetClassifications.set(tEl, {
		diffClass: stateClass,
		displacement: dist,
	});
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

function isAvailableRefDesMatch(b, matchedBase, targetRefDes) {
	if (b.isWorksheetFrame || matchedBase.has(b)) return false;
	return Boolean(b.isComponent && b.refDes === targetRefDes);
}

function findRefDesCandidates(tEl, ctx) {
	return ctx.baseElements.filter((b) =>
		isAvailableRefDesMatch(b, ctx.matchedBase, tEl.refDes),
	);
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

function matchExactTargetElement(tEl, baseKeyGroups, ctx) {
	if (tEl.isWorksheetFrame || ctx.matchedTarget.has(tEl)) return;
	const bEls = baseKeyGroups.get(tEl.fullKey);
	if (!bEls || bEls.length === 0) return;

	const bEl = bEls.shift();
	ctx.matchedBase.add(bEl);
	ctx.matchedTarget.add(tEl);
	ctx.baseClassifications.set(bEl, { diffClass: "diff-unchanged" });
	ctx.targetClassifications.set(tEl, { diffClass: "diff-unchanged" });
}

export function matchExactPrimitivesPass(ctx) {
	const baseKeyGroups = buildExactKeyGroups(ctx.baseElements, ctx.matchedBase);
	for (const tEl of ctx.targetElements) {
		matchExactTargetElement(tEl, baseKeyGroups, ctx);
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

function isAvailableBasePrimitive(bEl, matchedBase, tag) {
	if (bEl.isWorksheetFrame || matchedBase.has(bEl)) return false;
	return bEl.tag === tag;
}

function findProximityCandidates(tEl, ctx) {
	return ctx.baseElements.filter((bEl) =>
		isAvailableBasePrimitive(bEl, ctx.matchedBase, tEl.tag),
	);
}

function matchSingleProximityElement(tEl, ctx, threshold) {
	if (tEl.isWorksheetFrame || ctx.matchedTarget.has(tEl)) return;
	const candidates = findProximityCandidates(tEl, ctx);
	if (candidates.length === 0) return;
	const bestMatch = findBestProximityCandidate(tEl, candidates, threshold);
	if (bestMatch) {
		recordMatchedPair(tEl, bestMatch, ctx);
	}
}

export function matchProximityPrimitivesPass(ctx) {
	const PROXIMITY_THRESHOLD = 5.0;
	for (const tEl of ctx.targetElements) {
		matchSingleProximityElement(tEl, ctx, PROXIMITY_THRESHOLD);
	}
}

function buildPointBbox(center) {
	return {
		x1: center.x - 1,
		y1: center.y - 1,
		x2: center.x + 1,
		y2: center.y + 1,
	};
}

function buildElementClassification(el, layer, diffClass, diffIdx) {
	const center = getElementCenter(el);
	const endpts = getSegmentEndpoints(el);
	const coordKey = diffClass === "diff-deleted" ? "baseCoords" : "targetCoords";
	return {
		diffClass,
		diffIdx,
		refDes: el.refDes,
		name: el.text || el.id || el.tag,
		layer,
		center,
		[coordKey]: center,
		startPoint: endpts?.start ?? null,
		endPoint: endpts?.end ?? null,
		bbox: buildPointBbox(center),
	};
}

export function classifyDeletedBaseElements(ctx, startDiffIdx) {
	let diffIdx = startDiffIdx;
	for (const el of ctx.baseElements) {
		if (el.isWorksheetFrame || ctx.baseClassifications.has(el)) continue;
		ctx.baseClassifications.set(
			el,
			buildElementClassification(
				el,
				ctx.layerFilename,
				"diff-deleted",
				diffIdx++,
			),
		);
	}
	return diffIdx;
}

export function classifyAddedTargetElement(el, ctx, addIdx) {
	ctx.targetClassifications.set(
		el,
		buildElementClassification(el, ctx.layerFilename, "diff-added", addIdx),
	);
}

function buildElementBbox(p1, p2) {
	return {
		x1: Math.min(p1.x, p2.x) - 1,
		y1: Math.min(p1.y, p2.y) - 1,
		x2: Math.max(p1.x, p2.x) + 1,
		y2: Math.max(p1.y, p2.y) + 1,
	};
}

function buildChangedPairPatch(elem, center, sharedProps) {
	return {
		diffIdx: sharedProps.sharedIdx,
		refDes: elem.refDes,
		name: elem.text || elem.id || elem.tag,
		layer: sharedProps.layer,
		center,
		targetCoords: sharedProps.tCenter,
		baseCoords: sharedProps.bCenter,
		bbox: sharedProps.bbox,
		displacement: sharedProps.displacement,
	};
}

export function linkChangedElementPair(el, bEl, ctx, sharedIdx) {
	const tClass = ctx.targetClassifications.get(el);
	const bClass = ctx.baseClassifications.get(bEl);
	const tCenter = getElementCenter(el);
	const bCenter = getElementCenter(bEl);
	const bbox = buildElementBbox(bCenter, tCenter);
	const displacement =
		tClass?.displacement ??
		Math.hypot(tCenter.x - bCenter.x, tCenter.y - bCenter.y);
	const shared = {
		sharedIdx,
		layer: ctx.layerFilename,
		tCenter,
		bCenter,
		bbox,
		displacement,
	};

	Object.assign(tClass, buildChangedPairPatch(el, tCenter, shared));
	if (bClass) {
		Object.assign(bClass, buildChangedPairPatch(bEl, bCenter, shared));
	}
}

function linkPendingChangedTarget(el, ctx, diffIdx) {
	const classification = ctx.targetClassifications.get(el);
	if (
		classification?.diffClass !== "diff-changed" ||
		classification.diffIdx !== undefined
	) {
		return diffIdx;
	}
	const bEl = ctx.matchedTargetToBase.get(el);
	if (!bEl) return diffIdx;
	linkChangedElementPair(el, bEl, ctx, diffIdx);
	return diffIdx + 1;
}

function classifyTargetResidual(el, ctx, diffIdx) {
	if (el.isWorksheetFrame) return diffIdx;
	if (!ctx.targetClassifications.has(el)) {
		classifyAddedTargetElement(el, ctx, diffIdx);
		return diffIdx + 1;
	}
	return linkPendingChangedTarget(el, ctx, diffIdx);
}

export function classifyResidualElementsPass(ctx, startDiffIdx) {
	let diffIdx = classifyDeletedBaseElements(ctx, startDiffIdx);
	for (const el of ctx.targetElements) {
		diffIdx = classifyTargetResidual(el, ctx, diffIdx);
	}
	return diffIdx;
}

const DROPPED_TAGS = new Set(["g", "rect", "polygon"]);

function isDroppedCandidate(el, diffClass) {
	const isUnchanged = !diffClass || diffClass === "diff-unchanged";
	return isUnchanged && DROPPED_TAGS.has(el.tag);
}

function hasSameRefDes(elRef, b) {
	return Boolean(elRef && extractRefDes(b) === elRef);
}

function hasSameText(elText, bText) {
	return Boolean(elText && bText === elText);
}

function checkAddedTwin(el, elRef, baseElements) {
	return baseElements.some(
		(b) => hasSameRefDes(elRef, b) || hasSameText(el.text, b.text),
	);
}

function runDiagnosticChecks(
	targetElements,
	baseElements,
	targetClassifications,
) {
	let misclassifiedCount = 0;
	let droppedCount = 0;

	for (const el of targetElements) {
		const classification = targetClassifications.get(el);
		const diffClass = classification?.diffClass;

		if (
			diffClass === "diff-added" &&
			checkAddedTwin(el, extractRefDes(el), baseElements)
		) {
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
		layerFilename,
	};
}

function measureDuration(fn) {
	const start = performance.now();
	const result = fn();
	return { result, duration: performance.now() - start };
}

function resolveDiffOptions(optionsOrLayer, rest) {
	const [pcbMetadata = null, startDiffIdx = 0] = rest;
	const isObj = typeof optionsOrLayer === "object" && optionsOrLayer !== null;
	const opts = isObj
		? optionsOrLayer
		: { layerFilename: optionsOrLayer, pcbMetadata, startDiffIdx };
	return {
		layerFilename: opts.layerFilename,
		metadata: opts.pcbMetadata ?? pcbMetadata,
		initialDiffIdx: opts.startDiffIdx ?? startDiffIdx ?? 0,
	};
}

function runTrackChainsPass(ctx, layerFilename, initialDiffIdx) {
	const baseChains = assembleTrackChains(ctx.baseElements, layerFilename);
	const targetChains = assembleTrackChains(ctx.targetElements, layerFilename);
	return matchTrackChainsPass(
		baseChains,
		targetChains,
		ctx,
		layerFilename,
		initialDiffIdx,
	);
}

function runMatchingPipeline(ctx, layerFilename, initialDiffIdx) {
	// PASS 0: Track Chains
	const { result: p0Idx, duration: tPass0 } = measureDuration(() =>
		runTrackChainsPass(ctx, layerFilename, initialDiffIdx),
	);
	// PASS 1: RefDes
	const { duration: tPass1 } = measureDuration(() =>
		matchRefDesComponentsPass(ctx),
	);
	// PASS 2: Exact Primitives
	const { duration: tPass2 } = measureDuration(() =>
		matchExactPrimitivesPass(ctx),
	);
	// PASS 3: Proximity Primitives
	const { duration: tPass3 } = measureDuration(() =>
		matchProximityPrimitivesPass(ctx),
	);
	// PASS 4: Residual Elements
	const { result: nextDiffIdx, duration: tPass4 } = measureDuration(() =>
		classifyResidualElementsPass(ctx, p0Idx),
	);

	return { nextDiffIdx, passTimes: { tPass0, tPass1, tPass2, tPass3, tPass4 } };
}

function annotateSvgs(baseSvg, targetSvg, ctx) {
	return {
		annotatedBase: annotateSvgSinglePass(
			baseSvg,
			ctx.baseElements,
			ctx.baseClassifications,
		),
		annotatedTarget: annotateSvgSinglePass(
			targetSvg,
			ctx.targetElements,
			ctx.targetClassifications,
		),
		cleanBaseSvg: annotateSvgDataOnly(
			baseSvg,
			ctx.baseElements,
			ctx.baseClassifications,
		),
		cleanTargetSvg: annotateSvgDataOnly(
			targetSvg,
			ctx.targetElements,
			ctx.targetClassifications,
		),
	};
}

function assembleTelemetry(timings, baseCount, targetCount) {
	return {
		tBg: timings.tBg,
		tExtract: timings.tExtract,
		...timings.passTimes,
		tAnnotate: timings.tAnnotate,
		tDiag: timings.tDiag,
		tTotalDiff: timings.tTotalDiff,
		baseCount,
		targetCount,
	};
}

function prepareAndExtractSvgs(baseSvg, targetSvg) {
	const { result: prep, duration: tBg } = measureDuration(() => ({
		bSvg: rewriteSchematicBackground(baseSvg),
		tSvg: rewriteSchematicBackground(targetSvg),
	}));
	const { result: els, duration: tExtract } = measureDuration(() => ({
		bEls: extractElements(prep.bSvg),
		tEls: extractElements(prep.tSvg),
	}));
	return { prep, els, tBg, tExtract };
}

export function processSvgDiff(
	baseSvg,
	targetSvg,
	optionsOrLayer = {},
	...rest
) {
	const tTotalStart = performance.now();
	const { layerFilename, metadata, initialDiffIdx } = resolveDiffOptions(
		optionsOrLayer,
		rest,
	);
	const { prep, els, tBg, tExtract } = prepareAndExtractSvgs(
		baseSvg,
		targetSvg,
	);

	const ctx = createMatchContext(els.bEls, els.tEls, layerFilename);
	const { nextDiffIdx, passTimes } = runMatchingPipeline(
		ctx,
		layerFilename,
		initialDiffIdx,
	);
	const { result: ann, duration: tAnnotate } = measureDuration(() =>
		annotateSvgs(prep.bSvg, prep.tSvg, ctx),
	);
	const modifications = generatePreciseAuditLog(
		ctx.targetClassifications,
		ctx.baseClassifications,
		metadata,
		layerFilename,
	);
	const { duration: tDiag } = measureDuration(() =>
		runDiagnosticChecks(
			ctx.targetElements,
			ctx.baseElements,
			ctx.targetClassifications,
		),
	);

	const timings = {
		tBg,
		tExtract,
		passTimes,
		tAnnotate,
		tDiag,
		tTotalDiff: performance.now() - tTotalStart,
	};
	const telemetry = assembleTelemetry(
		timings,
		ctx.baseElements.length,
		ctx.targetElements.length,
	);

	return {
		baseSvg: ann.annotatedBase,
		targetSvg: ann.annotatedTarget,
		cleanBaseSvg: ann.cleanBaseSvg,
		cleanTargetSvg: ann.cleanTargetSvg,
		modifications,
		telemetry,
		nextDiffIdx,
	};
}
