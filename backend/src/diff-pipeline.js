/**
 * Banana 2.0 — High-Performance KiCad Diff Pipeline
 */

import fs from 'fs';
import path from 'path';
import { renderKicadFile } from './kicad-renderer.js';
import { extractPcbMetadata } from './pcb-metadata.js';
import {
  getLayerSuffix,
  consolidateModifications,
  processLayerPair,
  findAddedLayers
} from './diff-consolidator.js';

function readSvgs(renderResult) {
  if (!renderResult || !renderResult.svgFiles) return [];
  return renderResult.svgFiles.map(filePath => ({
    filename: path.basename(filePath),
    content: fs.readFileSync(filePath, 'utf8')
  }));
}

function cleanupDirectory(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn('Failed to clean up directory:', dirPath, e.message);
  }
}

function cleanupFolders(cleanExtractionFolders, baseRenders, targetRenders) {
  cleanExtractionFolders.forEach(cleanupDirectory);
  cleanupDirectory(baseRenders?.outputDir);
  cleanupDirectory(targetRenders?.outputDir);
}

function buildBaseLayerResult(baseSvg) {
  return {
    sideBySideBase: baseSvg,
    baseSvgWithIdx: baseSvg,
    mod: {
      type: 'delete_layer',
      layer: baseSvg.filename,
      tag: 'layer',
      id: baseSvg.filename,
      label: baseSvg.filename,
      text: `Entire layer ${baseSvg.filename} removed`
    }
  };
}

function processAllLayers({ baseSvgs, targetSvgs, pcbMetadata }) {
  const sideBySideBase = [];
  const sideBySideTarget = [];
  const baseSvgsWithIdx = [];
  const targetSvgsWithIdx = [];
  const allModifications = [];
  const layerTelemetries = [];

  let globalDiffIdx = 0;
  for (const baseSvg of baseSvgs) {
    const bSuffix = getLayerSuffix(baseSvg.filename);
    const matchingTarget = targetSvgs.find(t => t.filename === baseSvg.filename || getLayerSuffix(t.filename) === bSuffix);

    if (matchingTarget) {
      const pair = processLayerPair({ baseSvg, matchingTarget, pcbMetadata, globalDiffIdx });
      globalDiffIdx = pair.nextDiffIdx;
      if (pair.telemetry) layerTelemetries.push(pair.telemetry);
      allModifications.push(...pair.modifications);
      sideBySideBase.push(pair.sideBySideBase);
      sideBySideTarget.push(pair.sideBySideTarget);
      baseSvgsWithIdx.push(pair.baseSvgWithIdx);
      targetSvgsWithIdx.push(pair.targetSvgWithIdx);
    } else {
      const removed = buildBaseLayerResult(baseSvg);
      sideBySideBase.push(removed.sideBySideBase);
      baseSvgsWithIdx.push(removed.baseSvgWithIdx);
      allModifications.push(removed.mod);
    }
  }

  const addedLayers = findAddedLayers(targetSvgs, baseSvgs);
  for (const item of addedLayers) {
    sideBySideTarget.push(item.svg);
    targetSvgsWithIdx.push(item.svg);
    allModifications.push(item.mod);
  }

  return {
    sideBySideBase,
    sideBySideTarget,
    baseSvgsWithIdx,
    targetSvgsWithIdx,
    allModifications,
    layerTelemetries
  };
}

function buildResponsePayload({
  baseCommit,
  targetCommit,
  layersResult,
  pcbMetadata,
  footprintChanges,
  timing
}) {
  const consolidatedMods = consolidateModifications(layersResult.allModifications, footprintChanges);

  return {
    base: { commit: baseCommit, svgs: layersResult.baseSvgsWithIdx },
    target: { commit: targetCommit, svgs: layersResult.targetSvgsWithIdx },
    sideBySide: {
      base: layersResult.sideBySideBase,
      target: layersResult.sideBySideTarget
    },
    modifications: consolidatedMods,
    pcbMetadata: pcbMetadata ? {
      nets: pcbMetadata.nets || [],
      footprintCount: (pcbMetadata.footprints || []).length,
      padCount: (pcbMetadata.pads || []).length,
      segmentCount: (pcbMetadata.segments || []).length,
      footprintChanges: Array.from(footprintChanges.entries()).map(([ref, ch]) => ({ ref, ...ch }))
    } : null,
    telemetry: {
      tGit: Number(timing.tExtraction.toFixed(2)),
      tCli: Number(timing.tCli.toFixed(2)),
      tDiff: Number(timing.tDiff.toFixed(2)),
      tTotal: Number(timing.tTotal.toFixed(2)),
      layersProcessed: layersResult.baseSvgsWithIdx.length,
      layerTelemetries: layersResult.layerTelemetries
    }
  };
}

/**
 * Shared Diff Pipeline: Renders KiCad CAD files, generates SVGs, parses AST metadata,
 * executes 5-pass vector/copper corridor diff, and formats consolidated audit response.
 */
export async function executeDiffPipeline({
  basePath,
  targetPath,
  baseCommit,
  targetCommit,
  isPcb,
  tExtraction = 0,
  cleanExtractionFolders = [],
  tTotalStart = performance.now()
}, res) {
  let baseRenders = null;
  let targetRenders = null;

  try {
    const tCliStart = performance.now();
    try {
      [baseRenders, targetRenders] = await Promise.all([
        renderKicadFile(basePath, isPcb),
        renderKicadFile(targetPath, isPcb)
      ]);
    } catch (err) {
      console.error('[Banana API] Concurrent KiCad rendering error:', err);
      return res.status(500).json({
        error: 'Failed to render KiCad SVG files concurrently',
        details: err.message
      });
    }
    const tCli = performance.now() - tCliStart;

    const baseSvgs = readSvgs(baseRenders);
    const targetSvgs = readSvgs(targetRenders);

    const tDiffStart = performance.now();
    const pcbMetadata = extractPcbMetadata(basePath, targetPath, isPcb);
    const footprintChanges = pcbMetadata?.footprintChanges || new Map();

    const layersResult = processAllLayers({ baseSvgs, targetSvgs, pcbMetadata });
    const tDiff = performance.now() - tDiffStart;
    const tTotal = performance.now() - tTotalStart;

    const payload = buildResponsePayload({
      baseCommit,
      targetCommit,
      layersResult,
      pcbMetadata,
      footprintChanges,
      timing: { tExtraction, tCli, tDiff, tTotal }
    });

    return res.json(payload);
  } catch (error) {
    console.error('[Banana Diff Pipeline] Unexpected error:', error);
    return res.status(500).json({
      error: 'Unexpected error during diff processing',
      details: error.message
    });
  } finally {
    cleanupFolders(cleanExtractionFolders, baseRenders, targetRenders);
  }
}
