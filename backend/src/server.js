import express from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from './config.js';
import { extractFileFromCommit } from './git-extractor.js';
import { renderKicadFile } from './kicad-renderer.js';
import { processSvgDiff, cleanNetName, cleanLayerName } from './svg-diff-processor.js';
import { parseKiCadBoard } from './kicad-pcb-parser.js';
import { streamGeminiChat } from './ai-service.js';
import { WorkspaceDB } from './database.js';
import { searchComponentAlternatives } from './component-sourcing-service.js';
import { buildCircuitWithAiAndJev } from './circuit-builder-service.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health-check', (req, res) => {
  const cliPath = config.kicadCliPath;

  execFile(cliPath, ['--version'], (error, stdout, stderr) => {
    if (error) {
      // Provide a descriptive error response
      return res.status(500).json({
        status: "unhealthy",
        error: "KiCad CLI execution failed or executable not found/inaccessible",
        message: error.message,
        cliPath: cliPath,
        code: error.code,
        stderr: stderr ? stderr.trim() : ''
      });
    }

    const version = stdout.trim();
    if (!version) {
      return res.status(500).json({
        status: "unhealthy",
        error: "KiCad CLI did not output any version information",
        cliPath: cliPath,
        stderr: stderr ? stderr.trim() : ''
      });
    }

    res.json({
      status: "healthy",
      kicadVersion: version
    });
  });
});

function getGitBranches(repoPath) {
  return new Promise((resolve) => {
    execFile('git', ['branch', '-a', '--format=%(refname:short)'], { cwd: repoPath }, (error, stdout) => {
      if (error) {
        return resolve(['main', 'master', 'HEAD']);
      }
      const branches = stdout
        .split(/\r?\n/)
        .map(b => b.trim())
        .filter(b => b.length > 0 && !b.startsWith('origin/HEAD'));
      resolve(branches.length > 0 ? branches : ['main', 'master', 'HEAD']);
    });
  });
}

function getGitCommits(repoPath) {
  return new Promise((resolve) => {
    execFile('git', ['log', '-n', '100', '--format=%H|%an|%ad|%s', '--date=short'], { cwd: repoPath }, (error, stdout) => {
      if (error) {
        return resolve([]);
      }
      const commits = stdout
        .split(/\r?\n/)
        .filter(line => line.length > 0)
        .map(line => {
          const parts = line.split('|');
          if (parts.length < 4) return null;
          return {
            hash: parts[0],
            author: parts[1],
            date: parts[2],
            subject: parts[3]
          };
        })
        .filter(Boolean);
      resolve(commits);
    });
  });
}

function getKicadFiles(repoPath) {
  return new Promise((resolve) => {
    execFile('git', ['ls-files'], { cwd: repoPath }, (error, stdout) => {
      if (error) {
        return resolve([]);
      }
      const files = stdout
        .split(/\r?\n/)
        .map(f => f.trim())
        .filter(f => f.endsWith('.kicad_pcb') || f.endsWith('.kicad_sch'));
      resolve(files);
    });
  });
}

app.post('/api/git/init', async (req, res) => {
  let { repoPath } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: "repoPath is required" });
  }

  // If repoPath is not an absolute path or doesn't exist, try to search standard desktop/user folders
  if (!path.isAbsolute(repoPath) || !fs.existsSync(repoPath)) {
    const folderName = path.basename(repoPath);
    const home = os.homedir();
    const platform = os.platform();

    // Build an ordered list of candidate parent directories to search.
    // Covers: Windows (OneDrive-redirected & standard Desktop), macOS (Desktop, Documents, Developer), Linux (common project dirs).
    const candidateParentDirs = [
      // ── Windows ──────────────────────────────────────────────────────────
      path.join(home, 'OneDrive', 'Desktop'),     // OneDrive-redirected Desktop (Windows 10/11)
      path.join(home, 'OneDrive', 'Documents'),   // OneDrive Documents
      path.join(home, 'Desktop'),                  // Standard Desktop (Windows / macOS)
      path.join(home, 'OneDrive'),                 // OneDrive root
      // ── macOS ────────────────────────────────────────────────────────────
      path.join(home, 'Documents'),               // ~/Documents (macOS / Linux)
      path.join(home, 'Developer'),               // ~/Developer (macOS convention)
      path.join(home, 'Projects'),                // ~/Projects
      // ── Linux ────────────────────────────────────────────────────────────
      path.join(home, 'projects'),               // ~/projects
      path.join(home, 'code'),                   // ~/code
      path.join(home, 'repos'),                  // ~/repos
      path.join(home, 'work'),                   // ~/work
      path.join(home, 'src'),                    // ~/src
      // ── Universal fallbacks ──────────────────────────────────────────────
      home,
      process.cwd(),
      path.dirname(process.cwd())
    ].filter(d => {
      try { return fs.existsSync(d); } catch { return false; }
    });

    const searchDirs = [...new Set(candidateParentDirs)]; // deduplicate

    let resolvedPath = null;
    for (const dir of searchDirs) {
      const target = path.join(dir, folderName);
      if (fs.existsSync(target) && fs.existsSync(path.join(target, '.git'))) {
        resolvedPath = target;
        break;
      }
    }

    if (resolvedPath) {
      repoPath = resolvedPath;
    } else {
      return res.status(404).json({
        error: `Could not automatically resolve repository directory for name "${folderName}". Please provide the absolute path.`,
        searchedIn: searchDirs
      });
    }
  }

  try {
    const gitDir = path.join(repoPath, '.git');
    if (!fs.existsSync(gitDir)) {
      return res.status(400).json({ error: "Selected folder is not a Git repository (no .git folder found)" });
    }

    const [branches, commits, kicadFiles] = await Promise.all([
      getGitBranches(repoPath),
      getGitCommits(repoPath),
      getKicadFiles(repoPath)
    ]);

    res.json({
      resolvedPath: repoPath,
      branches,
      commits,
      kicadFiles
    });

  } catch (error) {
    res.status(500).json({
      error: "Failed to initialize Git repository info",
      details: error.message
    });
  }
});

app.post('/api/git/diff-files', async (req, res) => {
  const { repoPath, baseRef, targetRef } = req.body;

  if (!repoPath || !baseRef || !targetRef) {
    return res.status(400).json({ error: "repoPath, baseRef, and targetRef are required" });
  }

  try {
    execFile('git', ['diff', '--name-only', baseRef, targetRef], { cwd: repoPath }, (error, stdout) => {
      if (error) {
        return res.json({ files: [] });
      }
      
      const files = stdout
        .split(/\r?\n/)
        .map(f => f.trim())
        .filter(f => f.endsWith('.kicad_pcb') || f.endsWith('.kicad_sch'));
        
      res.json({ files });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/git/commits
 * 
 * Returns the last 20 commits from a local Git repository as structured JSON.
 * Query parameter: repoPath (absolute path to the repository root)
 * 
 * Response: { commits: [{ hash: "7a12b3c", message: "Initial component layout" }] }
 * Error:    { error: "Not a valid Git repository path" }
 */
app.get('/api/git/commits', (req, res) => {
  const { repoPath, filePath } = req.query;

  // --- Validation: repoPath query param must be present ---
  if (!repoPath || repoPath.trim() === '') {
    return res.status(400).json({
      error: 'Missing required query parameter: repoPath'
    });
  }

  const normalizedPath = repoPath.trim();

  // --- Validation: directory must exist on disk ---
  if (!fs.existsSync(normalizedPath)) {
    return res.status(400).json({
      error: `Path does not exist on disk: "${normalizedPath}"`
    });
  }

  // --- Validation: must contain a .git folder ---
  const gitDir = path.join(normalizedPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return res.status(400).json({
      error: 'Not a valid Git repository path — no .git directory found'
    });
  }

  // Build git log arguments array
  const args = ['log', '--oneline', '-n', '20', '--format=%h|%s'];
  if (filePath && filePath.trim() !== '') {
    args.push('--', filePath.trim());
  }

  // --- Async non-blocking git log execution ---
  execFile(
    'git',
    args,
    { cwd: normalizedPath },
    (error, stdout, stderr) => {
      if (error) {
        return res.status(400).json({
          error: 'Failed to retrieve Git history',
          details: stderr ? stderr.trim() : error.message
        });
      }

      // Parse output lines into structured objects
      const commits = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          const pipeIndex = line.indexOf('|');
          let hash, message;
          if (pipeIndex !== -1) {
            hash = line.substring(0, pipeIndex).trim();
            message = line.substring(pipeIndex + 1).trim();
          } else {
            const spaceIndex = line.indexOf(' ');
            if (spaceIndex === -1) return null;
            hash = line.substring(0, spaceIndex).trim();
            message = line.substring(spaceIndex + 1).trim();
          }
          return {
            hash,
            message,
            subject: message,
            author: 'Git History'
          };
        })
        .filter(Boolean); // remove any null entries from malformed lines

      res.json({ commits });
    }
  );
});

app.post('/api/diff/process', async (req, res) => {
  const { repoPath, baseCommit, targetCommit, relativeFilePath, isPcb } = req.body;

  // Input validation
  if (!repoPath || !baseCommit || !targetCommit || !relativeFilePath) {
    return res.status(400).json({
      error: "Missing required parameters in request body. Required: repoPath, baseCommit, targetCommit, relativeFilePath"
    });
  }

  const tTotalStart = performance.now();
  const cleanBaseCommit = String(baseCommit).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 16);
  const cleanTargetCommit = String(targetCommit).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 16);
  const safeRelPath = relativeFilePath.replace(/[^a-zA-Z0-9_-]/g, '_');

  const baseFolderId = `git_${cleanBaseCommit}_${safeRelPath}`;
  const targetFolderId = `git_${cleanTargetCommit}_${safeRelPath}`;
  const fileBasename = path.basename(relativeFilePath);

  const baseTempName = path.join(baseFolderId, fileBasename);
  const targetTempName = path.join(targetFolderId, fileBasename);

  let basePath = null;
  let targetPath = null;
  let baseRenders = null;
  let targetRenders = null;

  try {
    // 1. Extract files from Git
    const tGitStart = performance.now();
    try {
      basePath = await extractFileFromCommit(repoPath, baseCommit, relativeFilePath, baseTempName);
    } catch (err) {
      return res.status(500).json({
        error: `Failed to extract file at base commit (${baseCommit})`,
        details: err.message
      });
    }

    try {
      targetPath = await extractFileFromCommit(repoPath, targetCommit, relativeFilePath, targetTempName);
    } catch (err) {
      return res.status(500).json({
        error: `Failed to extract file at target commit (${targetCommit})`,
        details: err.message
      });
    }
    const tGit = performance.now() - tGitStart;

    // 2. Render files concurrently using KiCad CLI
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

    // 3. Read generated SVGs into memory
    const readSvgs = (renderResult) => {
      return renderResult.svgFiles.map(filePath => {
        const rawFilename = path.basename(filePath);
        const content = fs.readFileSync(filePath, 'utf8');

        return {
          filename: rawFilename,
          content: content
        };
      });
    };

    const baseSvgs = readSvgs(baseRenders);
    const targetSvgs = readSvgs(targetRenders);

    // 4. Build semantic SVG diff annotation for Side-by-Side mode
    //    Match layers by filename, process each pair through the diff engine.
    const tDiffStart = performance.now();
    const sideBySideBase   = [];
    const sideBySideTarget = [];
    const baseSvgsWithIdx   = [];
    const targetSvgsWithIdx = [];
    const allModifications = [];
    const layerTelemetries = [];

    let pcbMetadata = null;
    const footprintChanges = new Map();
    if (isPcb && fs.existsSync(targetPath)) {
      try {
        const targetBoard = parseKiCadBoard(targetPath);
        let baseBoard = null;
        if (fs.existsSync(basePath)) {
          try {
            baseBoard = parseKiCadBoard(basePath);
          } catch (e) {
            console.warn('[Banana API] Warning: Failed to parse base PCB AST:', e.message);
          }
        }

        if (baseBoard && targetBoard) {
          const baseFps = new Map((baseBoard.footprints || []).map(f => [f.reference?.text, f]));
          const targetFps = new Map((targetBoard.footprints || []).map(f => [f.reference?.text, f]));

          for (const [ref, tFp] of targetFps) {
            if (!ref) continue;
            const bFp = baseFps.get(ref);
            if (!bFp) {
              footprintChanges.set(ref, {
                action: 'ADDED',
                refDes: ref,
                value: tFp.value?.text || '',
                layer: tFp.layer || 'F.Cu',
                targetAt: tFp.at,
                dist: 0
              });
            } else {
              const dx = (tFp.at?.x || 0) - (bFp.at?.x || 0);
              const dy = (tFp.at?.y || 0) - (bFp.at?.y || 0);
              const dist = Math.hypot(dx, dy);
              const dRot = Math.abs((tFp.at?.rotation || 0) - (bFp.at?.rotation || 0));
              const valChanged = tFp.value?.text !== bFp.value?.text;
              if (dist > 0.001 || dRot > 0.01 || valChanged) {
                footprintChanges.set(ref, {
                  action: 'CHANGED',
                  refDes: ref,
                  value: tFp.value?.text || '',
                  layer: tFp.layer || 'F.Cu',
                  baseAt: bFp.at,
                  targetAt: tFp.at,
                  dist,
                  dx,
                  dy,
                  dRot,
                  valChanged
                });
              }
            }
          }

          for (const [ref, bFp] of baseFps) {
            if (ref && !targetFps.has(ref)) {
              footprintChanges.set(ref, {
                action: 'DELETED',
                refDes: ref,
                value: bFp.value?.text || '',
                layer: bFp.layer || 'F.Cu',
                baseAt: bFp.at,
                dist: 0
              });
            }
          }
        }
        
        // Map footprints with reference designators and values
        const footprints = (targetBoard.footprints || []).map(fp => ({
          ref: fp.reference?.text || '',
          value: fp.value?.text || '',
          layer: fp.layer || 'F.Cu',
          x: fp.at?.x || 0,
          y: fp.at?.y || 0
        }));

        // Map pads with absolute coordinates and net assignments
        const pads = [];
        for (const fp of targetBoard.footprints || []) {
          const ref = fp.reference?.text || '';
          for (const pad of fp.pads || []) {
            pads.push({
              refDes: ref,
              pin: pad.number || '',
              netName: pad.net || '',
              x: pad.absAt?.x || 0,
              y: pad.absAt?.y || 0,
              width: pad.size?.w,
              length: pad.size?.h,
              layers: pad.layers || []
            });
          }
        }

        // Supply all 1,100+ native AST tracks with resolved net strings
        pcbMetadata = {
          footprints,
          pads,
          segments: (targetBoard.tracks || []).map(t => ({
            start: t.start,
            end: t.end,
            width: t.width,
            layer: t.layer || 'F.Cu',
            net: t.net || 'unconnected',
            netName: t.net || 'unconnected'
          })),
          nets: Array.from(targetBoard.nets ? targetBoard.nets.values() : []),
          footprintChanges
        };
      } catch (parseErr) {
        console.warn('[Banana API] Warning: Failed to parse PCB AST:', parseErr.message);
      }
    }

    for (const baseSvg of baseSvgs) {
      // Find the matching target layer by filename
      const matchingTarget = targetSvgs.find(t => t.filename === baseSvg.filename);

      if (matchingTarget) {
        try {
          const { baseSvg: annotatedBase, targetSvg: annotatedTarget, cleanBaseSvg, cleanTargetSvg, modifications: layerMods, telemetry: layerTel } =
            processSvgDiff(baseSvg.content, matchingTarget.content, baseSvg.filename, pcbMetadata);

          if (layerTel) {
            layerTelemetries.push({ layer: baseSvg.filename, ...layerTel });
          }

          // Enrich modifications with the layer filename
          const enrichedMods = (layerMods || []).map(m => ({
            ...m,
            layer: baseSvg.filename
          }));
          allModifications.push(...enrichedMods);

          sideBySideBase.push({ filename: baseSvg.filename, content: annotatedBase });
          sideBySideTarget.push({ filename: matchingTarget.filename, content: annotatedTarget });

          baseSvgsWithIdx.push({ filename: baseSvg.filename, content: cleanBaseSvg || baseSvg.content });
          targetSvgsWithIdx.push({ filename: matchingTarget.filename, content: cleanTargetSvg || matchingTarget.content });
        } catch (diffErr) {
          // Fall back to unannotated SVGs if the diff processor fails on a specific layer
          console.warn(`SVG diff annotation failed for layer ${baseSvg.filename}:`, diffErr.message);
          sideBySideBase.push(baseSvg);
          sideBySideTarget.push(matchingTarget);
          baseSvgsWithIdx.push(baseSvg);
          targetSvgsWithIdx.push(matchingTarget);
        }
      } else {
        // Layer only in base — entire SVG is "deleted"
        sideBySideBase.push(baseSvg);
        baseSvgsWithIdx.push(baseSvg);
        allModifications.push({
          type: 'delete_layer',
          layer: baseSvg.filename,
          tag: 'layer',
          id: baseSvg.filename,
          label: baseSvg.filename,
          text: `Entire layer ${baseSvg.filename} removed`
        });
      }
    }

    // Layers only in target (not in base) — entire SVG is "added"
    for (const targetSvg of targetSvgs) {
      const inBase = baseSvgs.some(b => b.filename === targetSvg.filename);
      if (!inBase) {
        sideBySideTarget.push(targetSvg);
        targetSvgsWithIdx.push(targetSvg);
        allModifications.push({
          type: 'add_layer',
          layer: targetSvg.filename,
          tag: 'layer',
          id: targetSvg.filename,
          label: targetSvg.filename,
          text: `Entire layer ${targetSvg.filename} added`
        });
      }
    }
    const tDiff = performance.now() - tDiffStart;
    const tTotal = performance.now() - tTotalStart;

    // Consolidate and deduplicate audit modifications to eliminate spam:
    const consolidatedMods = [];
    const componentMap = new Map();
    const traceMap = new Map();
    const graphicMap = new Map();

    for (const mod of allModifications) {
      if (mod.type === 'COMPONENT' && mod.refDes) {
        // If ground-truth footprint changes exist and this refDes is NOT in them:
        if (footprintChanges.size > 0 && !footprintChanges.has(mod.refDes)) {
          // Stationary component whose attached pad/track changed -> route as trace
          const netName = mod.net || mod.name || 'signal';
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
          continue;
        }

        if (!componentMap.has(mod.refDes)) {
          const fpChange = footprintChanges.get(mod.refDes);
          const master = {
            ...mod,
            action: fpChange ? fpChange.action : mod.action,
            displacement: fpChange ? fpChange.dist : mod.displacement,
            detail: fpChange && fpChange.dist > 0.001
              ? `Relocated by ${fpChange.dist.toFixed(2)} mm on F.Cu • (${fpChange.targetAt.x.toFixed(2)}, ${fpChange.targetAt.y.toFixed(2)})`
              : mod.detail,
            layer: mod.layer
          };
          componentMap.set(mod.refDes, master);
        } else {
          const existing = componentMap.get(mod.refDes);
          // Prefer copper layer for the master component card so canvas focuses properly
          if (mod.layer.includes('F_Cu') && !existing.layer.includes('F_Cu')) {
            existing.layer = mod.layer;
            existing.diffIdx = mod.diffIdx;
            existing.bbox = mod.bbox;
          }
        }
      } else if (mod.type === 'TRACE') {
        const isCopper = (mod.layer || '').includes('Cu');
        if (!isCopper) {
          // Absorb non-copper graphics near a moved component
          let absorbed = false;
          for (const [ref, fpChange] of footprintChanges) {
            if (mod.bbox && fpChange.targetAt) {
              const modCenterX = (mod.bbox.x1 + mod.bbox.x2) / 2;
              const modCenterY = (mod.bbox.y1 + mod.bbox.y2) / 2;
              const distToFp = Math.hypot(modCenterX - fpChange.targetAt.x, modCenterY - fpChange.targetAt.y);
              if (distToFp < 10.0) {
                absorbed = true;
                break;
              }
            }
          }
          if (absorbed) continue;
        }

        const netKey = cleanNetName(mod.name || mod.net);
        const key = `${netKey}@${mod.layer}`;
        if (!traceMap.has(key)) {
          traceMap.set(key, mod);
        }
      } else if (mod.type !== 'add_layer' && mod.type !== 'delete_layer') {
        const isCopper = (mod.layer || '').includes('Cu');
        if (!isCopper) {
          let absorbed = false;
          for (const [ref, fpChange] of footprintChanges) {
            if (mod.bbox && fpChange.targetAt) {
              const modCenterX = (mod.bbox.x1 + mod.bbox.x2) / 2;
              const modCenterY = (mod.bbox.y1 + mod.bbox.y2) / 2;
              const distToFp = Math.hypot(modCenterX - fpChange.targetAt.x, modCenterY - fpChange.targetAt.y);
              if (distToFp < 10.0) {
                absorbed = true;
                break;
              }
            }
          }
          if (absorbed) continue;
        }
        const key = `${mod.title}@${mod.layer}`;
        if (!graphicMap.has(key)) {
          graphicMap.set(key, mod);
        }
      } else {
        consolidatedMods.push(mod);
      }
    }

    consolidatedMods.push(...componentMap.values(), ...traceMap.values(), ...graphicMap.values());

    // 5. Return SVG content in structured response with telemetry
    res.json({
      base: {
        commit: baseCommit,
        svgs: baseSvgsWithIdx
      },
      target: {
        commit: targetCommit,
        svgs: targetSvgsWithIdx
      },
      sideBySide: {
        base: sideBySideBase,
        target: sideBySideTarget
      },
      modifications: consolidatedMods,
      telemetry: {
        tGit: Number(tGit.toFixed(2)),
        tCli: Number(tCli.toFixed(2)),
        tDiff: Number(tDiff.toFixed(2)),
        tTotal: Number(tTotal.toFixed(2)),
        layersProcessed: baseSvgs.length,
        layerTelemetries
      }
    });

  } catch (error) {
    res.status(500).json({
      error: "Unexpected error during diff processing",
      details: error.message
    });
  } finally {
    // 5. Clean up all temporary files and directories
    try {
      const baseDir = path.join(process.cwd(), 'temp_storage', baseFolderId);
      const targetDir = path.join(process.cwd(), 'temp_storage', targetFolderId);
      if (fs.existsSync(baseDir)) {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('Failed to clean up directories:', e.message);
    }

    if (baseRenders && baseRenders.outputDir && fs.existsSync(baseRenders.outputDir)) {
      try { fs.rmSync(baseRenders.outputDir, { recursive: true, force: true }); } catch (_) {}
    }
    if (targetRenders && targetRenders.outputDir && fs.existsSync(targetRenders.outputDir)) {
      try { fs.rmSync(targetRenders.outputDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
});

/**
 * POST /api/board/pads
 *
 * Extracts a .kicad_pcb file from a git commit and returns parsed pad data
 * (absolute coordinates, size, net names, layer membership) for the
 * frontend pad/net label overlay.
 *
 * Request body: { repoPath, commit, relativeFilePath }
 * Response:     { footprints: [{ reference, layer, pads: [{ number, net, absAt, size, layers }] }] }
 */
app.post('/api/board/pads', async (req, res) => {
  const { repoPath, commit, relativeFilePath } = req.body;

  if (!repoPath || !commit || !relativeFilePath) {
    return res.status(400).json({
      error: 'Missing required fields: repoPath, commit, relativeFilePath'
    });
  }

  if (!relativeFilePath.endsWith('.kicad_pcb')) {
    return res.status(400).json({
      error: 'Only .kicad_pcb files are supported by this endpoint'
    });
  }

  const uniqueId = `pads_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const fileBasename = path.basename(relativeFilePath);
  const tempName = path.join(uniqueId, fileBasename);
  let tempFilePath = null;

  try {
    try {
      tempFilePath = await extractFileFromCommit(repoPath, commit, relativeFilePath, tempName);
    } catch (err) {
      return res.status(500).json({
        error: `Failed to extract file at commit (${commit})`,
        details: err.message
      });
    }

    let board;
    try {
      board = parseKiCadBoard(tempFilePath);
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to parse .kicad_pcb file',
        details: err.message
      });
    }

    // Serialize only the fields needed by the label overlay
    const footprints = board.footprints.map(fp => ({
      reference: fp.reference?.text ?? '',
      layer: fp.layer,
      pads: fp.pads.map(pad => ({
        number: pad.number,
        net: pad.net ?? '',
        absAt: { x: pad.absAt.x, y: pad.absAt.y },
        size: { w: pad.size?.w ?? 0.5, h: pad.size?.h ?? 0.5 },
        layers: pad.layers ?? []
      }))
    }));

    res.json({ footprints });

  } catch (error) {
    res.status(500).json({
      error: 'Unexpected error during pad extraction',
      details: error.message
    });
  } finally {
    // Clean up temp directory
    if (tempFilePath) {
      try {
        const tempDir = path.join(process.cwd(), 'temp_storage', uniqueId);
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (_) {}
    }
  }
});

// ---------------------------------------------------------------------------
// AI Hardware Copilot Endpoints (Powered by Gemini 2.0 Flash)
// ---------------------------------------------------------------------------

app.get('/api/ai/status', (req, res) => {
  const serverKeyConfigured = Boolean(config.geminiApiKey || process.env.GEMINI_API_KEY);
  res.json({
    status: 'ok',
    serverKeyConfigured,
    model: config.geminiModel || 'gemini-2.0-flash-preview'
  });
});

app.post('/api/ai/chat', async (req, res) => {
  const { messages, boardContext, model } = req.body;
  const clientApiKey = req.headers['x-gemini-api-key'];

  // Set headers for Server-Sent Events streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const result = await streamGeminiChat({
      messages: messages || [],
      boardContext: boardContext || {},
      apiKey: clientApiKey,
      model,
      onChunk: (chunk) => {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
    });

    res.write(`data: ${JSON.stringify({ done: true, modelUsed: result.modelUsed })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Banana Copilot] Chat error:', err.message);
    res.write(`data: ${JSON.stringify({
      error: err.message,
      isKeyRequired: err.message.includes('GEMINI_API_KEY_REQUIRED')
    })}\n\n`);
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Workspace & Circuit Builder Endpoints (SQLite + Gemini 3 Flash + Jev)
// ---------------------------------------------------------------------------

// GET Workspace State & Projects
app.get('/api/workspace', (req, res) => {
  try {
    const ws = WorkspaceDB.getWorkspace();
    const projects = WorkspaceDB.getAllProjects();
    const circuits = WorkspaceDB.getAllCircuits();
    res.json({ workspace: ws, projects, circuits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET All Saved Circuits
app.get('/api/workspace/circuits', (req, res) => {
  try {
    const { projectId } = req.query;
    const circuits = WorkspaceDB.getAllCircuits(projectId || null);
    res.json({ circuits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Single Circuit by ID
app.get('/api/workspace/circuits/:id', (req, res) => {
  try {
    const circuit = WorkspaceDB.getCircuit(req.params.id);
    if (!circuit) return res.status(404).json({ error: 'Circuit not found' });
    res.json({ circuit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Build Circuit (Autonomous Streaming Pipeline)
app.post('/api/circuit/build', async (req, res) => {
  const { prompt, boardContext, projectId } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Set SSE streaming headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const circuit = await buildCircuitWithAiAndJev({
      prompt: prompt.trim(),
      boardContext: boardContext || {},
      projectId: projectId || 'default',
      onProgress: (progress) => {
        res.write(`data: ${JSON.stringify({ progress })}\n\n`);
      }
    });

    res.write(`data: ${JSON.stringify({ done: true, circuit })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Circuit Builder] Build error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// GET Component Alternatives (Web Sourcing)
app.get('/api/components/alternatives', async (req, res) => {
  try {
    const { part } = req.query;
    if (!part) return res.status(400).json({ error: 'part query param required' });
    const alternatives = await searchComponentAlternatives(part);
    res.json({ part, alternatives });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`KiCad CLI path: ${config.kicadCliPath}`);
});
