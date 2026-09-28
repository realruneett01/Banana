import express from 'express';
import path from 'path';
import { extractFileFromCommit } from '../git-extractor.js';
import { downloadRepoFile } from '../github-service.js';
import { executeDiffPipeline } from '../diff-pipeline.js';

const router = express.Router();

function sanitizeCommit(commit) {
  return String(commit || '').replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 16);
}

function sanitizeFilePath(filePath) {
  return String(filePath || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildTempFolder(prefix, commit, filePath) {
  const folderName = `${prefix}_${sanitizeCommit(commit)}_${sanitizeFilePath(filePath)}`;
  const folderDir = path.join(process.cwd(), 'temp_storage', folderName);
  const targetPath = path.join(folderDir, path.basename(filePath));
  return { folderName, folderDir, targetPath };
}

function validateLocalDiffParams(body) {
  const required = ['repoPath', 'baseCommit', 'targetCommit', 'relativeFilePath'];
  const missing = required.filter(k => !body[k]);
  if (missing.length > 0) {
    return `Missing required parameters in request body. Required: ${required.join(', ')}`;
  }
  return null;
}

function validateGithubDiffParams(token, body) {
  if (!token) return { error: 'GitHub authentication token required', status: 401 };
  const required = ['owner', 'repo', 'baseCommit', 'targetCommit', 'filePath'];
  const missing = required.filter(k => !body[k]);
  if (missing.length > 0) {
    return { error: `Missing required parameters: ${required.join(', ')}`, status: 400 };
  }
  return null;
}

/**
 * POST /api/diff/process
 * Local Git diff processor
 */
router.post('/diff/process', async (req, res) => {
  const { repoPath, baseCommit, targetCommit, relativeFilePath, isPcb } = req.body;
  const validationError = validateLocalDiffParams(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const tTotalStart = performance.now();
  const fileBasename = path.basename(relativeFilePath);
  const baseLoc = buildTempFolder('git', baseCommit, relativeFilePath);
  const targetLoc = buildTempFolder('git', targetCommit, relativeFilePath);

  const tGitStart = performance.now();
  let basePath, targetPath;
  try {
    basePath = await extractFileFromCommit(repoPath, baseCommit, relativeFilePath, path.join(baseLoc.folderName, fileBasename));
  } catch (err) {
    return res.status(500).json({
      error: `Failed to extract file at base commit (${baseCommit})`,
      details: err.message
    });
  }

  try {
    targetPath = await extractFileFromCommit(repoPath, targetCommit, relativeFilePath, path.join(targetLoc.folderName, fileBasename));
  } catch (err) {
    return res.status(500).json({
      error: `Failed to extract file at target commit (${targetCommit})`,
      details: err.message
    });
  }
  const tGit = performance.now() - tGitStart;

  return executeDiffPipeline({
    basePath,
    targetPath,
    baseCommit,
    targetCommit,
    isPcb,
    tExtraction: tGit,
    cleanExtractionFolders: [baseLoc.folderDir, targetLoc.folderDir],
    tTotalStart
  }, res);
});

/**
 * POST /api/github/diff/process
 * Remote GitHub diff processor (directly diffs remote branches, commits, or PRs)
 */
router.post('/github/diff/process', async (req, res) => {
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '') || req.body.token;
  const { owner, repo, baseCommit, targetCommit, filePath, isPcb } = req.body;

  const authOrParamError = validateGithubDiffParams(token, req.body);
  if (authOrParamError) {
    return res.status(authOrParamError.status).json({ error: authOrParamError.error });
  }

  const tTotalStart = performance.now();
  const baseLoc = buildTempFolder('gh', baseCommit, filePath);
  const targetLoc = buildTempFolder('gh', targetCommit, filePath);

  const tGhStart = performance.now();
  try {
    await Promise.all([
      downloadRepoFile(token, owner, repo, filePath, baseCommit, baseLoc.targetPath),
      downloadRepoFile(token, owner, repo, filePath, targetCommit, targetLoc.targetPath)
    ]);
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to download hardware file from GitHub',
      details: err.message
    });
  }
  const tGh = performance.now() - tGhStart;

  return executeDiffPipeline({
    basePath: baseLoc.targetPath,
    targetPath: targetLoc.targetPath,
    baseCommit,
    targetCommit,
    isPcb: isPcb !== undefined ? isPcb : /\.kicad_pcb$/i.test(filePath),
    tExtraction: tGh,
    cleanExtractionFolders: [baseLoc.folderDir, targetLoc.folderDir],
    tTotalStart
  }, res);
});

export default router;
