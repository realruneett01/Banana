import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

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
  const tempDir = path.join(process.cwd(), 'temp_storage');
  
  // Ensure temp_storage directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const outputPath = path.join(tempDir, targetFilename);
  const parentDir = path.dirname(outputPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    // Standardize path separators for git (uses forward slashes)
    const gitFilePath = relativeFilePath.replace(/\\/g, '/');
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
        resolve(outputPath);
      }
    });
  });
}
