import dotenv from 'dotenv';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

dotenv.config();

function resolveKicadCliPath() {
  // 1. Explicit override always wins
  if (process.env.KICAD_CLI_PATH && fs.existsSync(process.env.KICAD_CLI_PATH)) {
    return process.env.KICAD_CLI_PATH;
  }

  // 2. Try PATH resolution first (works if user installed via package manager)
  const finder = os.platform() === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(finder, ['kicad-cli'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) return result;
  } catch {
    // not on PATH, fall through to known install locations
  }

  // 3. OS-specific known install locations (still checked dynamically, not assumed)
  const candidates = {
    win32: [
      'C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\9.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\7.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\bin\\kicad-cli.exe',
    ],
    darwin: [
      '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli',
    ],
    linux: [
      '/usr/bin/kicad-cli',
      '/usr/local/bin/kicad-cli',
      '/snap/bin/kicad-cli',
    ],
  };
  const platformCandidates = candidates[os.platform()] || [];
  for (const candidate of platformCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'kicad-cli not found. Set KICAD_CLI_PATH env var, or ensure kicad-cli ' +
    'is on your system PATH.'
  );
}

export const KICAD_CLI_PATH = resolveKicadCliPath();

// Fail-fast verification at startup: throw immediately if KiCad CLI cannot execute
execFileSync(KICAD_CLI_PATH, ['--version'], { encoding: 'utf8' });

export const config = {
  port: process.env.PORT || 5000,
  kicadCliPath: KICAD_CLI_PATH,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
};


