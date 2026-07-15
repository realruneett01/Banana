import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

function getKiCadCliPath() {
  const envPath = process.env.KICAD_CLI_PATH;
  if (envPath && envPath.trim() !== '') {
    return envPath.trim();
  }

  // Define default paths based on OS
  const platform = process.platform;
  const possiblePaths = [];

  if (platform === 'win32') {
    possiblePaths.push(
      'C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\7.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\9.0\\bin\\kicad-cli.exe',
      'C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe'
    );
  } else if (platform === 'darwin') {
    possiblePaths.push(
      '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
    );
  } else {
    // Linux and other Unix-like systems
    possiblePaths.push(
      '/usr/bin/kicad-cli',
      '/usr/local/bin/kicad-cli',
      'kicad-cli' // Fallback to running directly if in PATH
    );
  }

  // Search for the first path that actually exists
  for (const p of possiblePaths) {
    if (p === 'kicad-cli') {
      return p;
    }
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch (e) {
      // Ignore checks that fail
    }
  }

  // If none exists, default to OS specific primary default
  return platform === 'win32'
    ? 'C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe'
    : platform === 'darwin'
      ? '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
      : 'kicad-cli';
}

export const config = {
  port: process.env.PORT || 5000,
  kicadCliPath: getKiCadCliPath()
};
