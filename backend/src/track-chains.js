/**
 * Banana 2.0 — Copper Track Chain Assembly & Topological Matching
 */

import { getSegmentEndpoints } from './svg-primitives.js';
import { isCopperLayerFilename } from './diff-consolidator.js';

export { isCopperLayerFilename };

export function findConnectedComponent(startNode, getNeighbors) {
  const component = [];
  const queue = [startNode];
  startNode.visited = true;

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
  return component;
}

export function isPointConnectedToOther(pt, currentNode, component, isClose) {
  for (const otherNode of component) {
    if (otherNode === currentNode) continue;
    if (isClose(pt, otherNode.pts.start) || isClose(pt, otherNode.pts.end)) {
      return true;
    }
  }
  return false;
}

export function findTerminalAnchors(component, isClose) {
  const terminalAnchors = [];
  for (const node of component) {
    for (const pt of [node.pts.start, node.pts.end]) {
      if (!isPointConnectedToOther(pt, node, component, isClose) && !terminalAnchors.some(t => isClose(t, pt))) {
        terminalAnchors.push(pt);
      }
    }
  }
  return terminalAnchors;
}

export function computeChainMetrics(component) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let totalLength = 0;
  for (const node of component) {
    if (node.pts?.start && node.pts?.end) {
      minX = Math.min(minX, node.pts.start.x, node.pts.end.x);
      minY = Math.min(minY, node.pts.start.y, node.pts.end.y);
      maxX = Math.max(maxX, node.pts.start.x, node.pts.end.x);
      maxY = Math.max(maxY, node.pts.start.y, node.pts.end.y);
      totalLength += Math.hypot(node.pts.end.x - node.pts.start.x, node.pts.end.y - node.pts.start.y);
    }
  }
  return { bbox: { minX, minY, maxX, maxY }, totalLength };
}

function buildNeighborLookup(nodes, isClose) {
  const GRID_SIZE = 0.2;
  const grid = new Map();

  function gridKey(x, y) {
    return `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;
  }

  for (const node of nodes) {
    for (const pt of [node.pts.start, node.pts.end]) {
      const key = gridKey(pt.x, pt.y);
      let arr = grid.get(key);
      if (!arr) {
        arr = [];
        grid.set(key, arr);
      }
      arr.push({ pt, node });
    }
  }

  return function getNeighbors(curr) {
    const neighbors = [];
    for (const pt of [curr.pts.start, curr.pts.end]) {
      const gx = Math.floor(pt.x / GRID_SIZE);
      const gy = Math.floor(pt.y / GRID_SIZE);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`);
          if (cell) {
            for (const item of cell) {
              if (!item.node.visited && item.node !== curr && isClose(pt, item.pt)) {
                neighbors.push(item.node);
              }
            }
          }
        }
      }
    }
    return neighbors;
  };
}

function filterCopperTracks(elements) {
  return elements.filter(el => {
    if (el.isComponent) return false;
    if (el.tag !== 'path' && el.tag !== 'line') return false;
    return !el.isClosedPath;
  });
}

function buildNodes(tracks) {
  return tracks.map((el, index) => ({
    el,
    index,
    pts: getSegmentEndpoints(el),
    visited: false
  })).filter(node => node.pts !== null);
}

export function assembleTrackChains(elements, layerFilename) {
  if (!isCopperLayerFilename(layerFilename)) return [];

  const nodes = buildNodes(filterCopperTracks(elements));
  const isClose = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y) <= 0.02;
  const getNeighbors = buildNeighborLookup(nodes, isClose);
  const chains = [];

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].visited) continue;

    const component = findConnectedComponent(nodes[i], getNeighbors);
    const terminalAnchors = findTerminalAnchors(component, isClose);
    const startAnchor = terminalAnchors[0] || component[0].pts.start;
    const endAnchor = terminalAnchors[1] || component[component.length - 1].pts.end;
    const { bbox, totalLength } = computeChainMetrics(component);

    chains.push({
      startAnchor,
      endAnchor,
      bbox,
      totalLength,
      subSegments: component.map(node => node.el)
    });
  }

  return chains;
}

export function findBestMatchingBaseChain(tChain, baseChains, matchedBaseChains) {
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
  return { bestBaseChain, minD };
}

function areGeoKeysEqual(bSegments, tSegments) {
  const bKeys = bSegments.map(el => el.geoKey).sort();
  const tKeys = tSegments.map(el => el.geoKey).sort();
  return bKeys.length === tKeys.length && bKeys.every((k, i) => k === tKeys[i]);
}

function areBboxesEqual(bBox, tBox, bLen, tLen, minD) {
  if (!bBox || !tBox) return false;
  const dLen = Math.abs((bLen || 0) - (tLen || 0));
  const dBox = Math.max(
    Math.abs(bBox.minX - tBox.minX),
    Math.abs(bBox.minY - tBox.minY),
    Math.abs(bBox.maxX - tBox.maxX),
    Math.abs(bBox.maxY - tBox.maxY)
  );
  return minD <= 0.25 && dBox <= 0.15 && dLen <= 0.25;
}

export function areChainsIdentical(bestBaseChain, tChain, minD) {
  if (areGeoKeysEqual(bestBaseChain.subSegments, tChain.subSegments)) {
    return true;
  }
  return areBboxesEqual(bestBaseChain.bbox, tChain.bbox, bestBaseChain.totalLength, tChain.totalLength, minD);
}

function assignSegmentsMeta(segments, meta, matchedSet, classifications) {
  for (const el of segments) {
    matchedSet.add(el);
    classifications.set(el, meta);
  }
}

function createChainMetadata(bChain, tChain, sharedIdx, layerFilename) {
  const baseCenter = {
    x: (bChain.startAnchor.x + bChain.endAnchor.x) / 2,
    y: (bChain.startAnchor.y + bChain.endAnchor.y) / 2
  };
  const targetCenter = {
    x: (tChain.startAnchor.x + tChain.endAnchor.x) / 2,
    y: (tChain.startAnchor.y + tChain.endAnchor.y) / 2
  };
  const bbox = {
    x1: Math.min(tChain.startAnchor.x, tChain.endAnchor.x),
    y1: Math.min(tChain.startAnchor.y, tChain.endAnchor.y),
    x2: Math.max(tChain.startAnchor.x, tChain.endAnchor.x),
    y2: Math.max(tChain.startAnchor.y, tChain.endAnchor.y)
  };
  const chainDisp = Math.hypot(targetCenter.x - baseCenter.x, targetCenter.y - baseCenter.y);

  const baseMeta = {
    diffClass: 'diff-changed',
    diffIdx: sharedIdx,
    startPoint: bChain.startAnchor,
    endPoint: bChain.endAnchor,
    segmentCount: bChain.subSegments.length,
    layer: layerFilename,
    center: baseCenter,
    baseCoords: baseCenter,
    targetCoords: targetCenter,
    bbox,
    displacement: chainDisp
  };

  const targetMeta = {
    ...baseMeta,
    startPoint: tChain.startAnchor,
    endPoint: tChain.endAnchor,
    segmentCount: tChain.subSegments.length,
    center: targetCenter
  };

  return { baseMeta, targetMeta };
}

export function applyChainClassifications(bChain, tChain, matchInfo, context) {
  // Support both context object and legacy unpacked arguments
  let identical = matchInfo;
  let sharedIdx = null;
  let layerFilename = '';
  let mBase, mTarget, bClasses, tClasses;

  if (typeof matchInfo === 'object' && matchInfo !== null && !('has' in matchInfo)) {
    identical = matchInfo.chainsIdentical;
    sharedIdx = matchInfo.sharedIdx;
    layerFilename = matchInfo.layerFilename;
    mBase = context.matchedBase;
    mTarget = context.matchedTarget;
    bClasses = context.baseClassifications;
    tClasses = context.targetClassifications;
  } else {
    // Unpack arguments if called via legacy signature
    sharedIdx = arguments[3];
    layerFilename = arguments[4];
    mBase = arguments[5];
    mTarget = arguments[6];
    bClasses = arguments[7];
    tClasses = arguments[8];
  }

  if (identical) {
    assignSegmentsMeta(bChain.subSegments, { diffClass: 'diff-unchanged' }, mBase, bClasses);
    assignSegmentsMeta(tChain.subSegments, { diffClass: 'diff-unchanged' }, mTarget, tClasses);
    return;
  }

  const { baseMeta, targetMeta } = createChainMetadata(bChain, tChain, sharedIdx, layerFilename);
  assignSegmentsMeta(bChain.subSegments, baseMeta, mBase, bClasses);
  assignSegmentsMeta(tChain.subSegments, targetMeta, mTarget, tClasses);
}

export function matchTrackChainsPass(baseChains, targetChains, ctxOrMatchedBase, ...legacyArgs) {
  let ctx;
  let layerFilename;
  let diffIdx;

  if (ctxOrMatchedBase && ctxOrMatchedBase.matchedBase) {
    ctx = ctxOrMatchedBase;
    layerFilename = legacyArgs[0];
    diffIdx = legacyArgs[1] || 0;
  } else {
    ctx = {
      matchedBase: ctxOrMatchedBase,
      matchedTarget: legacyArgs[0],
      baseClassifications: legacyArgs[1],
      targetClassifications: legacyArgs[2]
    };
    layerFilename = legacyArgs[3];
    diffIdx = legacyArgs[4] || 0;
  }

  const matchedBaseChains = new Set();
  for (const tChain of targetChains) {
    const { bestBaseChain, minD } = findBestMatchingBaseChain(tChain, baseChains, matchedBaseChains);
    if (!bestBaseChain) continue;

    matchedBaseChains.add(bestBaseChain);
    const chainsIdentical = areChainsIdentical(bestBaseChain, tChain, minD);
    const sharedIdx = chainsIdentical ? null : diffIdx++;

    applyChainClassifications(bestBaseChain, tChain, {
      chainsIdentical,
      sharedIdx,
      layerFilename
    }, ctx);
  }

  return diffIdx;
}
