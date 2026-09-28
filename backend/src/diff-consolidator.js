/**
 * Banana 2.0 — Diff Consolidator & Layer Pair Processor
 */

import { processSvgDiff, cleanNetName, cleanLayerName } from './svg-diff-processor.js';

export function isCopperLayerFilename(layerFilename) {
  return /\b(F_Cu|B_Cu|In\d+_Cu)\b/i.test(layerFilename || '');
}

export function getLayerSuffix(fn) {
  if (!fn) return '';
  const baseName = fn.split(/[/\\]/).pop();
  const lastHyphen = baseName.lastIndexOf('-');
  return (lastHyphen !== -1 ? baseName.slice(lastHyphen + 1) : baseName).toLowerCase();
}

export function isAbsorbedByFootprint(mod, footprintChanges) {
  if (!mod.bbox) return false;
  const modCenterX = (mod.bbox.x1 + mod.bbox.x2) / 2;
  const modCenterY = (mod.bbox.y1 + mod.bbox.y2) / 2;

  for (const [, fpChange] of footprintChanges) {
    if (fpChange.targetAt) {
      const distToFp = Math.hypot(modCenterX - fpChange.targetAt.x, modCenterY - fpChange.targetAt.y);
      if (distToFp < 10.0) return true;
    }
  }
  return false;
}

function updateExistingComponentMod(existing, mod, fpChange) {
  if (mod.layer.includes('F_Cu') && !existing.layer.includes('F_Cu')) {
    existing.layer = mod.layer;
    existing.diffIdx = mod.diffIdx;
    existing.bbox = mod.bbox;
    if (fpChange?.baseAt) existing.baseCoords = { x: fpChange.baseAt.x, y: fpChange.baseAt.y };
    if (fpChange?.targetAt) existing.targetCoords = { x: fpChange.targetAt.x, y: fpChange.targetAt.y };
  }
}

function registerNewComponentMod(mod, fpChange, componentMap) {
  const detail = fpChange && fpChange.dist > 0.001
    ? `Relocated by ${fpChange.dist.toFixed(2)} mm on F.Cu • (${fpChange.targetAt.x.toFixed(2)}, ${fpChange.targetAt.y.toFixed(2)})`
    : mod.detail;

  componentMap.set(mod.refDes, {
    ...mod,
    action: fpChange ? fpChange.action : mod.action,
    displacement: fpChange ? fpChange.dist : mod.displacement,
    detail,
    layer: mod.layer,
    baseCoords: fpChange?.baseAt ? { x: fpChange.baseAt.x, y: fpChange.baseAt.y } : mod.baseCoords,
    targetCoords: fpChange?.targetAt ? { x: fpChange.targetAt.x, y: fpChange.targetAt.y } : mod.targetCoords
  });
}

function registerTraceFromUnmatchedFootprint(mod, traceMap) {
  const netName = mod.net ?? mod.name ?? 'signal';
  const layerClean = cleanLayerName(mod.layer);
  const key = `${cleanNetName(netName)}@${mod.layer}`;
  if (!traceMap.has(key)) {
    traceMap.set(key, {
      ...mod,
      type: 'TRACE',
      name: netName,
      title: `changed ${cleanNetName(netName)} trace`,
      detail: `Connected to ${mod.refDes} • Layer ${layerClean}`
    });
  }
}

export function processComponentMod(mod, footprintChanges, componentMap, traceMap) {
  if (footprintChanges.size > 0 && !footprintChanges.has(mod.refDes)) {
    registerTraceFromUnmatchedFootprint(mod, traceMap);
    return;
  }

  const existing = componentMap.get(mod.refDes);
  const fpChange = footprintChanges.get(mod.refDes);
  if (!existing) {
    registerNewComponentMod(mod, fpChange, componentMap);
    return;
  }
  updateExistingComponentMod(existing, mod, fpChange);
}

export function processTraceMod(mod, footprintChanges, traceMap) {
  const isCopper = (mod.layer || '').includes('Cu');
  if (!isCopper && isAbsorbedByFootprint(mod, footprintChanges)) return;
  const netKey = cleanNetName(mod.name || mod.net);
  const key = `${netKey}@${mod.layer}`;
  if (!traceMap.has(key)) {
    traceMap.set(key, mod);
  }
}

export function processGraphicMod(mod, footprintChanges, graphicMap) {
  const isCopper = (mod.layer || '').includes('Cu');
  if (!isCopper && isAbsorbedByFootprint(mod, footprintChanges)) return;
  const key = `${mod.title}@${mod.layer}`;
  if (!graphicMap.has(key)) {
    graphicMap.set(key, mod);
  }
}

export function consolidateModifications(allModifications, footprintChanges = new Map()) {
  const consolidatedMods = [];
  const componentMap = new Map();
  const traceMap = new Map();
  const graphicMap = new Map();

  for (const mod of allModifications) {
    if (mod.type === 'COMPONENT' && mod.refDes) {
      processComponentMod(mod, footprintChanges, componentMap, traceMap);
    } else if (mod.type === 'TRACE') {
      processTraceMod(mod, footprintChanges, traceMap);
    } else if (mod.type !== 'add_layer' && mod.type !== 'delete_layer') {
      processGraphicMod(mod, footprintChanges, graphicMap);
    } else {
      consolidatedMods.push(mod);
    }
  }

  consolidatedMods.push(...componentMap.values(), ...traceMap.values(), ...graphicMap.values());
  return consolidatedMods;
}

function buildFallbackLayerPair(baseSvg, matchingTarget, globalDiffIdx) {
  return {
    sideBySideBase: baseSvg,
    sideBySideTarget: matchingTarget,
    baseSvgWithIdx: baseSvg,
    targetSvgWithIdx: matchingTarget,
    modifications: [],
    telemetry: null,
    nextDiffIdx: globalDiffIdx
  };
}

export function processLayerPair({ baseSvg, matchingTarget, pcbMetadata, globalDiffIdx }) {
  try {
    const diff = processSvgDiff(baseSvg.content, matchingTarget.content, baseSvg.filename, pcbMetadata, globalDiffIdx);
    const count = diff.modifications?.length ?? 0;
    const updatedDiffIdx = diff.nextDiffIdx ?? (globalDiffIdx + count + 1);
    const enrichedMods = (diff.modifications ?? []).map(m => ({ ...m, layer: baseSvg.filename }));

    return {
      sideBySideBase: { filename: baseSvg.filename, content: diff.baseSvg },
      sideBySideTarget: { filename: matchingTarget.filename, content: diff.targetSvg },
      baseSvgWithIdx: { filename: baseSvg.filename, content: diff.cleanBaseSvg ?? baseSvg.content },
      targetSvgWithIdx: { filename: matchingTarget.filename, content: diff.cleanTargetSvg ?? matchingTarget.content },
      modifications: enrichedMods,
      telemetry: diff.telemetry ? { layer: baseSvg.filename, ...diff.telemetry } : null,
      nextDiffIdx: updatedDiffIdx
    };
  } catch (diffErr) {
    console.warn(`[Banana Diff] SVG diff annotation failed for layer ${baseSvg.filename}:`, diffErr.message);
    return buildFallbackLayerPair(baseSvg, matchingTarget, globalDiffIdx);
  }
}

export function findAddedLayers(targetSvgs, baseSvgs) {
  const added = [];
  for (const targetSvg of targetSvgs) {
    const tSuffix = getLayerSuffix(targetSvg.filename);
    const inBase = baseSvgs.some(b => b.filename === targetSvg.filename || getLayerSuffix(b.filename) === tSuffix);
    if (!inBase) {
      added.push({
        svg: targetSvg,
        mod: {
          type: 'add_layer',
          layer: targetSvg.filename,
          tag: 'layer',
          id: targetSvg.filename,
          label: targetSvg.filename,
          text: `Entire layer ${targetSvg.filename} added`
        }
      });
    }
  }
  return added;
}
