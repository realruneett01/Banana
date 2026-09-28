import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

/**
 * Resolves the cache directory path based on the file content hash.
 * @param {string} filePath
 * @param {boolean} isPcb
 * @returns {string|null}
 */
function resolveCacheDir(filePath, isPcb) {
  try {
    const fileBuf = fs.readFileSync(filePath);
    const fileHash = crypto.createHash('sha256').update(fileBuf).digest('hex').substring(0, 16);
    return path.resolve(process.cwd(), 'temp_storage', 'cache', 'renders', `${fileHash}_${isPcb ? 'pcb' : 'sch'}`);
  } catch (err) {
    if (process.env.DEBUG_RENDER) console.warn('[Renderer] Cache hash failed:', err.message);
    return null;
  }
}

/**
 * Returns absolute paths to all SVG files inside a directory.
 * @param {string} dirPath
 * @returns {string[]}
 */
function getSvgFilesFromDir(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    return files
      .filter(file => file.toLowerCase().endsWith('.svg'))
      .map(file => path.join(dirPath, file));
  } catch (err) {
    if (process.env.DEBUG_RENDER) console.warn('[Renderer] Dir read failed:', err.message);
    return [];
  }
}

function safeCleanup(outputDir) {
  try {
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  } catch (err) {
    if (process.env.DEBUG_RENDER) console.warn('[Renderer] Cleanup warning:', err.message);
  }
}

function executeCliRender(cliPath, args, outputDir, tStart) {
  return new Promise((resolve, reject) => {
    execFile(cliPath, args, (error, stdout, stderr) => {
      if (error) {
        safeCleanup(outputDir);
        return reject(new Error(`KiCad render execution failed: ${error.message}. Stderr: ${stderr.trim()}`));
      }

      try {
        const svgFiles = getSvgFilesFromDir(outputDir);
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
  const cacheDir = resolveCacheDir(normalizedFilePath, isPcb);
  if (cacheDir && fs.existsSync(cacheDir)) {
    const cachedSvgs = getSvgFilesFromDir(cacheDir);
    if (cachedSvgs.length > 0) {
      return { outputDir: cacheDir, svgFiles: cachedSvgs, durationMs: 0.5, cached: true };
    }
  }

  // 2. Cache miss: render directly to the cache directory (or fallback uniqueId)
  const outputDir = cacheDir || path.resolve(process.cwd(), 'temp_storage', 'renders', `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const tStart = performance.now();
  const args = isPcb
    ? ['pcb', 'export', 'svg', '--mode-multi', '--layers', 'F.Cu,B.Cu,F.SilkS,B.SilkS,F.Courtyard,B.Courtyard,Edge.Cuts', '--output', outputDir, normalizedFilePath]
    : ['sch', 'export', 'svg', '--output', outputDir, normalizedFilePath];

  return executeCliRender(cliPath, args, outputDir, tStart);
}

