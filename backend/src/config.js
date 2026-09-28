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
    const result = execFileSync(finder, ['kicad-cli'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim().split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) return result;
  } catch {
    // not on PATH, fall through to known install locations
  }

  // 3. OS-specific known install locations (checked dynamically across KiCad 11, 10, 9, 8, 7)
  const candidates = {
    win32: [
      'C:\\Program Files\\KiCad\\11.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\9.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\7.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\bin\\kicad-cli.exe',
    ],
    darwin: [
      '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli',
      '/Applications/KiCad 10.0/KiCad.app/Contents/MacOS/kicad-cli',
      '/Applications/KiCad 9.0/KiCad.app/Contents/MacOS/kicad-cli',
      '/Applications/KiCad 8.0/KiCad.app/Contents/MacOS/kicad-cli',
      '/Applications/KiCad 7.0/KiCad.app/Contents/MacOS/kicad-cli',
    ],
    linux: [
      '/usr/bin/kicad-cli',
      '/usr/local/bin/kicad-cli',
      '/snap/bin/kicad-cli',
      '/usr/lib/kicad-nightly/bin/kicad-cli',
      '/usr/lib/kicad/bin/kicad-cli'
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
export const KICAD_VERSION = (() => {
  try {
    const ver = execFileSync(KICAD_CLI_PATH, ['--version'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    console.log(`[Banana] Initialized KiCad CLI v${ver} at: ${KICAD_CLI_PATH}`);
    return ver;
  } catch (err) {
    console.error(`[Banana] Failed to execute KiCad CLI at ${KICAD_CLI_PATH}:`, err.message);
    throw err;
  }
})();

export const config = {
  port: process.env.PORT || 5000,
  kicadCliPath: KICAD_CLI_PATH,
  kicadVersion: KICAD_VERSION,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
  githubClientId: process.env.GITHUB_CLIENT_ID || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  githubCallbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:5000/api/auth/github/callback',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173'
};


