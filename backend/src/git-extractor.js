import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Prepares and returns the destination output path within temp_storage.
 * @param {string} targetFilename
 * @returns {string}
 */
function prepareOutputPath(targetFilename) {
  const outputPath = path.join(process.cwd(), 'temp_storage', targetFilename);
  const parentDir = path.dirname(outputPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  return outputPath;
}

/**
 * Checks whether the destination file already exists with content.
 * @param {string} filePath
 * @returns {boolean}
 */
function isCachedFileValid(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    return fs.statSync(filePath).size > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Extracts a specific file version from a Git commit hash and saves it to temp_storage.
 * 
 * @param {string} repoPath - Path to the local git repository
 * @param {string} commitHash - Git commit hash or reference (e.g. HEAD, HEAD~1, a5f23c)
 * @param {string} relativeFilePath - Project-relative file path in the repository
 * @param {string} targetFilename - Name of the output file inside temp_storage
 * @returns {Promise<string>} Path to the written file
 */
export async function extractFileFromCommit(repoPath, commitHash, relativeFilePath, targetFilename) {
  const outputPath = prepareOutputPath(targetFilename);

  // If file for this exact commit already exists with non-zero size, return immediately
  if (isCachedFileValid(outputPath)) {
    return outputPath;
  }

  const tStart = performance.now();

  return new Promise((resolve, reject) => {
    // Standardize path separators for git (uses forward slashes)
    const gitFilePath = relativeFilePath.split(/[/\\]/).join('/');
    const gitIdentifier = `${commitHash}:${gitFilePath}`;

    const child = spawn('git', ['show', gitIdentifier], { cwd: repoPath });
    const writeStream = fs.createWriteStream(outputPath);

    // Pipe stdout straight to the file stream to handle arbitrarily large files
    child.stdout.pipe(writeStream);

    let stderrData = '';
    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('error', (err) => {
      writeStream.end();
      reject(new Error(`Failed to spawn git process: ${err.message}`));
    });

    child.on('close', (code) => {
      // Ensure write stream is finished
      writeStream.end();

      if (code !== 0) {
        // Clean up partial output file if command failed
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (_) {}
        
        const cleanStderr = stderrData.trim();
        reject(new Error(`Git show failed with exit code ${code}. Stderr: ${cleanStderr || 'No stderr output'}`));
      } else {
        const durationMs = performance.now() - tStart;
        resolve(outputPath);
      }
    });
  });
}
