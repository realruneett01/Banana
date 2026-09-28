/**
 * Banana 2.0 — PCB AST Metadata & Footprint Delta Engine
 */

import fs from 'fs';
import { parseKiCadBoard } from './kicad-pcb-parser.js';

function computePlacementDelta(tAt, bAt) {
  const dx = (tAt?.x ?? 0) - (bAt?.x ?? 0);
  const dy = (tAt?.y ?? 0) - (bAt?.y ?? 0);
  const dist = Math.hypot(dx, dy);
  const dRot = Math.abs((tAt?.rotation ?? 0) - (bAt?.rotation ?? 0));
  return { dx, dy, dist, dRot };
}

export function checkFootprintDelta(ref, tFp, bFp) {
  if (!bFp) {
    return {
      action: 'ADDED',
      refDes: ref,
      value: tFp.value?.text ?? '',
      layer: tFp.layer ?? 'F.Cu',
      targetAt: tFp.at,
      dist: 0
    };
  }

  const { dx, dy, dist, dRot } = computePlacementDelta(tFp.at, bFp.at);
  const valChanged = tFp.value?.text !== bFp.value?.text;

  if (dist > 0.001 || dRot > 0.01 || valChanged) {
    return {
      action: 'CHANGED',
      refDes: ref,
      value: tFp.value?.text ?? '',
      layer: tFp.layer ?? 'F.Cu',
      baseAt: bFp.at,
      targetAt: tFp.at,
      dist,
      dx,
      dy,
      dRot,
      valChanged
    };
  }
  return null;
}

function findTargetFootprintDeltas(targetFps, baseFps) {
  const deltas = new Map();
  for (const [ref, tFp] of targetFps) {
    if (!ref) continue;
    const delta = checkFootprintDelta(ref, tFp, baseFps.get(ref));
    if (delta) deltas.set(ref, delta);
  }
  return deltas;
}

function findDeletedFootprints(baseFps, targetFps) {
  const deleted = new Map();
  for (const [ref, bFp] of baseFps) {
    if (ref && !targetFps.has(ref)) {
      deleted.set(ref, {
        action: 'DELETED',
        refDes: ref,
        value: bFp.value?.text ?? '',
        layer: bFp.layer ?? 'F.Cu',
        baseAt: bFp.at,
        dist: 0
      });
    }
  }
  return deleted;
}

export function computeFootprintChanges(baseBoard, targetBoard) {
  if (!baseBoard || !targetBoard) return new Map();

  const baseFps = new Map((baseBoard.footprints || []).map(f => [f.reference?.text, f]));
  const targetFps = new Map((targetBoard.footprints || []).map(f => [f.reference?.text, f]));

  const deltas = findTargetFootprintDeltas(targetFps, baseFps);
  const deleted = findDeletedFootprints(baseFps, targetFps);

  return new Map([...deltas, ...deleted]);
}

function extractPad(ref, pad) {
  return {
    refDes: ref,
    pin: pad.number ?? '',
    netName: pad.net ?? '',
    x: pad.absAt?.x ?? 0,
    y: pad.absAt?.y ?? 0,
    width: pad.size?.w,
    length: pad.size?.h,
    layers: pad.layers ?? []
  };
}

export function extractPadsFromFootprints(footprints = []) {
  const pads = [];
  for (const fp of footprints) {
    const ref = fp.reference?.text ?? '';
    for (const pad of fp.pads ?? []) {
      pads.push(extractPad(ref, pad));
    }
  }
  return pads;
}

export function tryParseBoard(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return parseKiCadBoard(filePath);
  } catch (err) {
    console.warn('[Banana API] Warning: Failed to parse PCB AST:', err.message);
    return null;
  }
}

function mapTracks(tracks = []) {
  return tracks.map(t => ({
    start: t.start,
    end: t.end,
    width: t.width,
    layer: t.layer ?? 'F.Cu',
    net: t.net ?? 'unconnected',
    netName: t.net ?? 'unconnected'
  }));
}

function mapFootprintSummaries(footprints = []) {
  return footprints.map(fp => ({
    ref: fp.reference?.text ?? '',
    value: fp.value?.text ?? '',
    layer: fp.layer ?? 'F.Cu',
    x: fp.at?.x ?? 0,
    y: fp.at?.y ?? 0
  }));
}

export function extractPcbMetadata(basePath, targetPath, isPcb) {
  if (!isPcb) return null;
  const targetBoard = tryParseBoard(targetPath);
  if (!targetBoard) return null;

  const baseBoard = tryParseBoard(basePath);
  const footprintChanges = computeFootprintChanges(baseBoard, targetBoard);

  return {
    footprints: mapFootprintSummaries(targetBoard.footprints),
    pads: extractPadsFromFootprints(targetBoard.footprints),
    segments: mapTracks(targetBoard.tracks),
    nets: Array.from(targetBoard.nets ? targetBoard.nets.values() : []),
    footprintChanges
  };
}
