import express from 'express';
import path from 'path';
import fs from 'fs';
import { extractFileFromCommit } from '../git-extractor.js';
import { downloadRepoFile } from '../github-service.js';
import { parseKiCadBoard } from '../kicad-pcb-parser.js';

const router = express.Router();

function hasRepositoryTarget({ repoPath, owner, repo }) {
  return Boolean(repoPath || (owner && repo));
}

function validatePadRequest({ commit, targetFile, repoPath, owner, repo }) {
  if (!commit || !targetFile) {
    return 'Missing required fields: commit, (relativeFilePath OR filePath)';
  }
  if (!hasRepositoryTarget({ repoPath, owner, repo })) {
    return 'Missing required fields: repoPath OR (owner and repo)';
  }
  if (!targetFile.endsWith('.kicad_pcb')) {
    return 'Only .kicad_pcb files are supported by this endpoint';
  }
  return null;
}

async function retrieveBoardFile({ owner, repo, token, repoPath, commit, targetFile, tempFilePath, uniqueId, fileBasename }) {
  if (owner && repo) {
    if (!token) {
      const err = new Error('GitHub token required for remote pads');
      err.statusCode = 401;
      throw err;
    }
    await downloadRepoFile(token, owner, repo, targetFile, commit, tempFilePath);
  } else {
    await extractFileFromCommit(repoPath, commit, targetFile, path.join(uniqueId, fileBasename));
  }
}

function formatFootprints(board) {
  return board.footprints.map(fp => ({
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
}

function cleanupTempDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (_) {}
}

/**
 * POST /api/board/pads
 *
 * Extracts a .kicad_pcb file from a git commit and returns parsed pad data
 * (absolute coordinates, size, net names, layer membership) for the
 * frontend pad/net label overlay.
 */
router.post('/pads', async (req, res) => {
  const { repoPath, commit, relativeFilePath, owner, repo, filePath } = req.body;
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.body.token;
  const targetFile = relativeFilePath || filePath;

  const validationError = validatePadRequest({ commit, targetFile, repoPath, owner, repo });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const uniqueId = `pads_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const fileBasename = path.basename(targetFile);
  const tempDir = path.join(process.cwd(), 'temp_storage', uniqueId);
  const tempFilePath = path.join(tempDir, fileBasename);

  try {
    await retrieveBoardFile({ owner, repo, token, repoPath, commit, targetFile, tempFilePath, uniqueId, fileBasename });

    let board;
    try {
      board = parseKiCadBoard(tempFilePath);
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to parse .kicad_pcb file',
        details: err.message
      });
    }

    res.json({ footprints: formatFootprints(board) });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      error: status === 401 ? error.message : 'Unexpected error during pad extraction',
      details: error.message
    });
  } finally {
    cleanupTempDir(tempDir);
  }
});

export default router;
