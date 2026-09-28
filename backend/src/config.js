import dotenv from 'dotenv';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

dotenv.config();

const CANDIDATES = {
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

function findKicadOnPath() {
  const finder = os.platform() === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(finder, ['kicad-cli'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim().split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) return result;
  } catch (err) {
    if (process.env.DEBUG_KICAD) {
      console.warn('[Banana] kicad-cli not on PATH:', err.message);
    }
  }
  return null;
}

function findKicadInStandardDirs() {
  const list = CANDIDATES[os.platform()] || [];
  return list.find(candidate => fs.existsSync(candidate)) || null;
}

function resolveKicadCliPath() {
  if (process.env.KICAD_CLI_PATH && fs.existsSync(process.env.KICAD_CLI_PATH)) {
    return process.env.KICAD_CLI_PATH;
  }
  return findKicadOnPath() || findKicadInStandardDirs() || (function() {
    throw new Error(
      'kicad-cli not found. Set KICAD_CLI_PATH env var, or ensure kicad-cli is on your system PATH.'
    );
  })();
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


