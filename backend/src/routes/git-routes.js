import express from 'express';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = express.Router();

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

function resolveRepoCandidate(repoPath) {
  if (path.isAbsolute(repoPath) && fs.existsSync(repoPath)) {
    return repoPath;
  }
  const folderName = path.basename(repoPath);
  const home = os.homedir();
  const candidateParentDirs = [
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'OneDrive', 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive'),
    path.join(home, 'Documents'),
    path.join(home, 'Developer'),
    path.join(home, 'Projects'),
    path.join(home, 'projects'),
    path.join(home, 'code'),
    path.join(home, 'repos'),
    path.join(home, 'work'),
    path.join(home, 'src'),
    home,
    process.cwd(),
    path.dirname(process.cwd())
  ].filter(d => {
    try { return fs.existsSync(d); } catch { return false; }
  });

  const searchDirs = [...new Set(candidateParentDirs)];
  for (const dir of searchDirs) {
    const target = path.join(dir, folderName);
    if (fs.existsSync(target) && fs.existsSync(path.join(target, '.git'))) {
      return target;
    }
  }
  return null;
}

router.post('/init', async (req, res) => {
  let { repoPath } = req.body;
  if (!repoPath) {
    return res.status(400).json({ error: "repoPath is required" });
  }

  const resolved = resolveRepoCandidate(repoPath);
  if (!resolved) {
    return res.status(404).json({
      error: `Could not automatically resolve repository directory for name "${path.basename(repoPath)}". Please provide the absolute path.`
    });
  }
  repoPath = resolved;

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

router.post('/diff-files', async (req, res) => {
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

function validateRepoPath(repoPath) {
  if (!repoPath || repoPath.trim() === '') {
    return { error: 'Missing required query parameter: repoPath' };
  }
  const normalizedPath = repoPath.trim();
  if (!fs.existsSync(normalizedPath)) {
    return { error: `Path does not exist on disk: "${normalizedPath}"` };
  }
  const gitDir = path.join(normalizedPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return { error: 'Not a valid Git repository path — no .git directory found' };
  }
  return { normalizedPath };
}

function parseOneLineCommits(stdout) {
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const pipeIndex = line.indexOf('|');
      const hash = pipeIndex !== -1 ? line.substring(0, pipeIndex).trim() : line.substring(0, line.indexOf(' ')).trim();
      const message = pipeIndex !== -1 ? line.substring(pipeIndex + 1).trim() : line.substring(line.indexOf(' ') + 1).trim();
      return hash ? { hash, message, subject: message, author: 'Git History' } : null;
    })
    .filter(Boolean);
}

function parseCommitLine(line) {
  const parts = line.split('|');
  if (parts.length < 5) return null;
  return {
    hash: parts[0].trim(),
    shortHash: parts[1].trim(),
    author: parts[2].trim(),
    date: parts[3].trim(),
    message: parts.slice(4).join('|').trim()
  };
}

async function isAncestor(execGit, a, b) {
  try {
    await execGit(['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommitDirection(execGit, baseCommit, targetCommit) {
  if (await isAncestor(execGit, baseCommit, targetCommit)) {
    return { fromCommit: baseCommit, toCommit: targetCommit, isReversed: false };
  }
  if (await isAncestor(execGit, targetCommit, baseCommit)) {
    return { fromCommit: targetCommit, toCommit: baseCommit, isReversed: true };
  }
  return { fromCommit: baseCommit, toCommit: targetCommit, isReversed: false };
}

async function fetchBaseCommitObj(execGit, fromCommit) {
  try {
    const baseInfoRaw = await execGit(['log', '-1', '--format=%H|%h|%an|%ad|%s', fromCommit]);
    const parsed = parseCommitLine(baseInfoRaw);
    if (parsed) return parsed;
  } catch (_) {}

  return {
    hash: fromCommit,
    shortHash: fromCommit.substring(0, 7),
    author: 'Git Author',
    date: '',
    message: 'Initial state'
  };
}

async function fetchRangeCommits(execGit, fromCommit, toCommit, filePath) {
  const logArgs = ['log', '--reverse', '--format=%H|%h|%an|%ad|%s', `${fromCommit}..${toCommit}`];
  if (filePath && filePath.trim() !== '') {
    logArgs.push('--', filePath.trim());
  }

  try {
    const rangeOutput = await execGit(logArgs);
    return rangeOutput
      ? rangeOutput.split(/\r?\n/).map(line => parseCommitLine(line.trim())).filter(Boolean)
      : [];
  } catch (e) {
    console.warn('[Banana API] Evolution range fetch fallback:', e.message);
    return [];
  }
}

router.get('/commits', (req, res) => {
  const { repoPath, filePath } = req.query;
  const pathCheck = validateRepoPath(repoPath);
  if (pathCheck.error) {
    return res.status(400).json({ error: pathCheck.error });
  }

  const args = ['log', '--oneline', '-n', '20', '--format=%h|%s'];
  if (filePath && filePath.trim() !== '') {
    args.push('--', filePath.trim());
  }

  execFile('git', args, { cwd: pathCheck.normalizedPath }, (error, stdout, stderr) => {
    if (error) {
      return res.status(400).json({
        error: 'Failed to retrieve Git history',
        details: stderr ? stderr.trim() : error.message
      });
    }

    res.json({ commits: parseOneLineCommits(stdout) });
  });
});

function makeGitExecutor(cwd) {
  return (cmdArgs) => {
    return new Promise((resolve, reject) => {
      execFile('git', cmdArgs, { cwd }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.trim() || err.message));
        resolve(stdout.trim());
      });
    });
  };
}

async function buildEvolutionTimeline({ normalizedPath, baseCommit, targetCommit, filePath }) {
  const execGit = makeGitExecutor(normalizedPath);
  const { fromCommit, toCommit, isReversed } = await resolveCommitDirection(execGit, baseCommit, targetCommit);
  const baseCommitObj = await fetchBaseCommitObj(execGit, fromCommit);
  const rangeCommits = await fetchRangeCommits(execGit, fromCommit, toCommit, filePath);

  let allCommits = [baseCommitObj, ...rangeCommits].map((c, idx) => ({ ...c, index: idx }));
  if (isReversed) {
    allCommits.reverse();
    allCommits.forEach((c, idx) => { c.index = idx; });
  }

  return {
    baseCommit,
    targetCommit,
    isReversed,
    commits: allCommits,
    totalSteps: Math.max(0, allCommits.length - 1),
    hasIntermediate: allCommits.length > 2
  };
}

router.get('/evolution', async (req, res) => {
  const { repoPath, baseCommit, targetCommit, filePath } = req.query;
  if (!repoPath || !baseCommit || !targetCommit) {
    return res.status(400).json({ error: 'Missing required query parameters: repoPath, baseCommit, targetCommit' });
  }

  const normalizedPath = repoPath.trim();
  if (!fs.existsSync(normalizedPath)) {
    return res.status(400).json({ error: `Path does not exist: "${normalizedPath}"` });
  }

  try {
    const timeline = await buildEvolutionTimeline({ normalizedPath, baseCommit, targetCommit, filePath });
    res.json(timeline);
  } catch (err) {
    console.error('[Banana API] Evolution path error:', err);
    res.status(500).json({ error: 'Failed to retrieve commit evolution path', details: err.message });
  }
});

export default router;
