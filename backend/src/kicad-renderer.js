import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

/**
 * Renders a KiCad schematic or board file using kicad-cli.
 * 
 * @param {string} filePath - Path to the file to render
 * @param {boolean} isPcb - True if PCB file (.kicad_pcb), False if schematic (.kicad_sch)
 * @returns {Promise<{outputDir: string, svgFiles: string[]}>} Map containing the temp folder and generated SVG absolute paths
 */
export async function renderKicadFile(filePath, isPcb) {
  const cliPath = config.kicadCliPath;
  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const outputDir = path.resolve(process.cwd(), 'temp_storage', 'renders', uniqueId);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const normalizedFilePath = path.resolve(filePath);
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

        resolve({
          outputDir,
          svgFiles
        });
      } catch (err) {
        reject(new Error(`Failed to list rendered KiCad SVG files: ${err.message}`));
      }
    });
  });
}

