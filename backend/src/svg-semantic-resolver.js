/**
 * Banana 2.0 — SVG Semantic Resolver & Audit Log Engine
 */

import { cleanNetName, cleanLayerName, formatSemanticTitle } from './svg-styler.js';
import { isCopperLayerFilename } from './diff-consolidator.js';
import { TOLERANCE_EPSILON } from './svg-primitives.js';

function findClosestItem(center, items, maxDist) {
  if (!center || !items?.length) return null;
  let minDistance = maxDist;
  let closest = null;
  for (const item of items) {
    const d = Math.hypot(item.x - center.x, item.y - center.y);
    if (d < minDistance) {
      minDistance = d;
      closest = item;
    }
  }
  return closest;
}

export function findClosestPad(center, pads, maxDist = 1.5) {
  return findClosestItem(center, pads, maxDist);
}

function distanceToSegment(center, seg) {
  if (!seg.start || !seg.end) return Infinity;
  const dStart = Math.hypot(seg.start.x - center.x, seg.start.y - center.y);
  const dEnd = Math.hypot(seg.end.x - center.x, seg.end.y - center.y);
  const dMid = Math.hypot((seg.start.x + seg.end.x) / 2 - center.x, (seg.start.y + seg.end.y) / 2 - center.y);
  return Math.min(dStart, dEnd, dMid);
}

function isValidNet(net) {
  return Boolean(net && net !== 'unconnected');
}

export function findClosestSegmentNet(center, segments, maxDistance = 3.0) {
  if (!center || !segments?.length) return null;
  let closestNet = null;
  let minDistance = maxDistance;
  for (const seg of segments) {
    const dist = distanceToSegment(center, seg);
    if (dist < minDistance) {
      minDistance = dist;
      closestNet = seg.net || seg.netName;
    }
  }
  return isValidNet(closestNet) ? closestNet : null;
}

export function findClosestFootprint(center, footprints, maxDist = 8.0) {
  return findClosestItem(center, footprints, maxDist);
}

export function resolveCopperPadIdentity(closestPad, footprints, footprintChanges, defaultLayer) {
  const fp = footprints.find(f => f.ref === closestPad.refDes);
  const valStr = fp?.value ? ` (${fp.value})` : '';
  const pinLabel = closestPad.pin ? `Pin ${closestPad.pin}` : 'Pad';
  const netLabel = closestPad.netName && closestPad.netName !== 'unconnected' ? ` • ${closestPad.netName}` : '';

  const fpChanged = footprintChanges ? footprintChanges.has(closestPad.refDes) : true;
  if (fpChanged) {
    return {
      name: `${closestPad.refDes}${valStr}`,
      refDes: closestPad.refDes,
      pin: closestPad.pin,
      net: closestPad.netName,
      type: 'COMPONENT',
      layer: defaultLayer,
      connection: `${pinLabel}${netLabel}`
    };
  }
  return {
    name: closestPad.netName || 'signal',
    refDes: closestPad.refDes,
    type: 'TRACE',
    layer: defaultLayer,
    connection: `Pad ${closestPad.pin} of ${closestPad.refDes}`
  };
}

export function resolveCopperTraceIdentity({ diffItem, center, closestPad, segments, defaultLayer }) {
  if (closestPad) {
    const netName = closestPad.netName && closestPad.netName !== 'unconnected' ? closestPad.netName : 'signal';
    return {
      name: netName,
      refDes: closestPad.refDes,
      type: 'TRACE',
      layer: defaultLayer,
      connection: `Connected to ${closestPad.refDes} Pin ${closestPad.pin}`
    };
  }
  const closestNet = findClosestSegmentNet(center, segments, 3.0);
  if (closestNet) {
    return { name: closestNet, type: 'TRACE', layer: defaultLayer };
  }
  return {
    name: diffItem.netName || diffItem.net || 'signal',
    type: 'TRACE',
    layer: defaultLayer
  };
}

export function resolveCopperIdentity({ diffItem, center, isChainOrOpenTrace, pcbMetadata, defaultLayer }) {
  const { footprints = [], pads = [], segments = [], footprintChanges } = pcbMetadata;
  const closestPad = findClosestPad(center, pads, 1.5);

  if (isChainOrOpenTrace) {
    return resolveCopperTraceIdentity({ diffItem, center, closestPad, segments, defaultLayer });
  }

  if (closestPad) {
    return resolveCopperPadIdentity(closestPad, footprints, footprintChanges, defaultLayer);
  }

  return null;
}

export function resolveNonCopperIdentity(center, footprints, defaultLayer) {
  if (!center || footprints.length === 0) return null;
  const closestFp = findClosestFootprint(center, footprints, 8.0);
  if (!closestFp) return null;

  const valStr = closestFp.value ? ` (${closestFp.value})` : '';
  return {
    name: `${closestFp.ref}${valStr}`,
    refDes: closestFp.ref,
    type: 'COMPONENT',
    layer: closestFp.layer || defaultLayer
  };
}

function resolveFootprintRefDes(diffItem, pcbMetadata, defaultLayer) {
  if (!diffItem.refDes) return null;
  const fp = (pcbMetadata?.footprints || []).find(f => f.ref === diffItem.refDes);
  const valStr = fp?.value ? ` (${fp.value})` : '';
  return {
    name: `${diffItem.refDes}${valStr}`,
    refDes: diffItem.refDes,
    type: 'COMPONENT',
    layer: fp?.layer || defaultLayer
  };
}

function resolveDiffItemCenter(diffItem) {
  if (diffItem.center) return diffItem.center;
  if (!diffItem.bbox) return null;
  return {
    x: (diffItem.bbox.x1 + diffItem.bbox.x2) / 2,
    y: (diffItem.bbox.y1 + diffItem.bbox.y2) / 2
  };
}

function isOpenTraceItem(diffItem) {
  return diffItem.segmentCount !== undefined || diffItem.startPoint !== undefined || diffItem.isClosedPath === false;
}

function resolveLayerIdentity(params) {
  const { diffItem, center, pcbMetadata, defaultLayer, isCopper } = params;
  if (isCopper) {
    const isChainOrOpenTrace = isOpenTraceItem(diffItem);
    return resolveCopperIdentity({ diffItem, center, isChainOrOpenTrace, pcbMetadata, defaultLayer });
  }
  return resolveNonCopperIdentity(center, pcbMetadata.footprints || [], defaultLayer);
}

export function resolveSemanticIdentity(diffItem, pcbMetadata, isCopper = true) {
  const defaultLayer = cleanLayerName(diffItem.layer);

  if (!pcbMetadata) {
    return { name: diffItem.refDes || 'signal', type: isCopper ? 'TRACE' : 'GRAPHIC', layer: defaultLayer };
  }

  const fpIdentity = resolveFootprintRefDes(diffItem, pcbMetadata, defaultLayer);
  if (fpIdentity) return fpIdentity;

  const center = resolveDiffItemCenter(diffItem);
  const result = resolveLayerIdentity({ diffItem, center, pcbMetadata, defaultLayer, isCopper });
  if (result) return result;

  return {
    name: diffItem.name || 'graphic',
    type: isCopper ? 'TRACE' : 'GRAPHIC',
    layer: defaultLayer
  };
}

function hasDisplacement(meta) {
  return Boolean(meta.displacement && meta.displacement > TOLERANCE_EPSILON);
}

function buildModificationDetail(identity, action, meta) {
  if (identity.type === 'TRACE') {
    return identity.connection ? `${identity.connection} • Layer ${identity.layer}` : `Layer ${identity.layer}`;
  }
  if (identity.type === 'COMPONENT') {
    const connInfo = identity.connection ? ` • ${identity.connection}` : '';
    if (action === 'CHANGED' && hasDisplacement(meta)) {
      return `Relocated by ${meta.displacement.toFixed(2)} mm on ${identity.layer}${connInfo}`;
    }
    return `${identity.layer} • (${meta.center?.x?.toFixed(1) ?? 0}, ${meta.center?.y?.toFixed(1) ?? 0})${connInfo}`;
  }
  return `Layer ${identity.layer}`;
}

function resolveActionFromDiffClass(diffClass) {
  if (diffClass === 'diff-added') return 'ADDED';
  if (diffClass === 'diff-deleted') return 'DELETED';
  return 'CHANGED';
}

function pickVal(a, b) {
  return a || b || null;
}

function resolveIdentifiers(identity, meta, defaultSide, defaultLayer) {
  return {
    refDes: pickVal(identity.refDes, meta.refDes),
    pin: pickVal(identity.pin, meta.pin),
    net: pickVal(identity.net, meta.net),
    layer: identity.layer || defaultLayer,
    side: meta.side || defaultSide
  };
}

function buildModificationRecord(meta, identity, defaultSide, defaultLayer) {
  const action = resolveActionFromDiffClass(meta.diffClass);
  const title = formatSemanticTitle(action, identity.type, identity.name);
  const detail = buildModificationDetail(identity, action, meta);
  const ids = resolveIdentifiers(identity, meta, defaultSide, defaultLayer);

  return {
    id: `mod-${meta.diffIdx}`,
    diffIdx: meta.diffIdx,
    action,
    title,
    type: identity.type,
    name: identity.name,
    detail,
    displacement: meta.displacement,
    bbox: meta.bbox,
    baseCoords: meta.baseCoords,
    targetCoords: meta.targetCoords,
    ...ids
  };
}

function collectClassMapModifications(classMap, ctx) {
  if (!classMap) return;
  const { defaultSide, defaultLayer, isCopper, pcbMetadata, seenDiffIndices, out } = ctx;
  classMap.forEach((meta, el) => {
    if (!meta || meta.diffClass === 'diff-unchanged') return;
    if (el?.isWorksheetFrame) return;
    if (meta.diffIdx !== undefined && seenDiffIndices.has(meta.diffIdx)) return;
    if (meta.diffIdx !== undefined) seenDiffIndices.add(meta.diffIdx);

    const identity = resolveSemanticIdentity(meta, pcbMetadata, isCopper);
    out.push(buildModificationRecord(meta, identity, defaultSide, defaultLayer));
  });
}

export function generatePreciseAuditLog(targetClassifications, baseClassifications, pcbMetadata, layerFilename) {
  const modifications = [];
  const seenDiffIndices = new Set();
  const defaultLayer = cleanLayerName(layerFilename);
  const isCopper = isCopperLayerFilename(layerFilename);

  const baseCtx = { defaultLayer, isCopper, pcbMetadata, seenDiffIndices, out: modifications };
  collectClassMapModifications(targetClassifications, { ...baseCtx, defaultSide: 'target' });
  collectClassMapModifications(baseClassifications, { ...baseCtx, defaultSide: 'base' });

  return modifications;
}
