import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

/**
 * Renders a KiCad schematic or board file using kicad-cli.
 * Includes content-hash persistent caching to eliminate redundant CLI renders.
 * 
 * @param {string} filePath - Path to the file to render
 * @param {boolean} isPcb - True if PCB file (.kicad_pcb), False if schematic (.kicad_sch)
 * @returns {Promise<{outputDir: string, svgFiles: string[], durationMs: number, cached?: boolean}>} Map containing the temp folder and generated SVG absolute paths
 */
export async function renderKicadFile(filePath, isPcb) {
  const cliPath = config.kicadCliPath;
  const normalizedFilePath = path.resolve(filePath);

  // 1. Check content-hash cache first
  let fileHash = '';
  try {
    const fileBuf = fs.readFileSync(normalizedFilePath);
    fileHash = crypto.createHash('sha256').update(fileBuf).digest('hex').substring(0, 16);
  } catch (_) {}

  const cacheDir = fileHash
    ? path.resolve(process.cwd(), 'temp_storage', 'cache', 'renders', `${fileHash}_${isPcb ? 'pcb' : 'sch'}`)
    : null;

  if (cacheDir && fs.existsSync(cacheDir)) {
    try {
      const files = fs.readdirSync(cacheDir);
      const svgFiles = files
        .filter(file => file.toLowerCase().endsWith('.svg'))
        .map(file => path.join(cacheDir, file));

      if (svgFiles.length > 0) {
        return {
          outputDir: cacheDir,
          svgFiles,
          durationMs: 0.5,
          cached: true
        };
      }
    } catch (_) {}
  }

  // 2. Cache miss: render directly to the cache directory (or fallback uniqueId)
  const outputDir = cacheDir || path.resolve(process.cwd(), 'temp_storage', 'renders', `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const tStart = performance.now();
  return new Promise((resolve, reject) => {
    const args = isPcb
      ? ['pcb', 'export', 'svg', '--mode-multi', '--layers', 'F.Cu,B.Cu,F.SilkS,B.SilkS,F.Courtyard,B.Courtyard,Edge.Cuts', '--output', outputDir, normalizedFilePath]
      : ['sch', 'export', 'svg', '--output', outputDir, normalizedFilePath];

    execFile(cliPath, args, (error, stdout, stderr) => {
      if (error) {
        // Clean up the temp directory if execution failed
        try {
          if (fs.existsSync(outputDir)) {
            fs.rmSync(outputDir, { recursive: true, force: true });
          }
        } catch (_) {}
        return reject(new Error(`KiCad render execution failed: ${error.message}. Stderr: ${stderr.trim()}`));
      }

      try {
        // Read directory and fetch absolute paths of generated SVG files
        const files = fs.readdirSync(outputDir);
        const svgFiles = files
          .filter(file => file.toLowerCase().endsWith('.svg'))
          .map(file => path.join(outputDir, file));

        const durationMs = performance.now() - tStart;
        resolve({
          outputDir,
          svgFiles,
          durationMs
        });
      } catch (err) {
        reject(new Error(`Failed to list rendered KiCad SVG files: ${err.message}`));
      }
    });
  });
}

