import express from 'express';
import { execFile } from 'child_process';
import { config } from '../config.js';

const router = express.Router();

router.get('/health-check', (req, res) => {
  const cliPath = config.kicadCliPath;

  execFile(cliPath, ['--version'], (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        status: "unhealthy",
        error: "KiCad CLI execution failed or executable not found/inaccessible",
        message: error.message,
        cliPath: cliPath,
        code: error.code,
        stderr: stderr ? stderr.trim() : ''
      });
    }

    const version = stdout.trim();
    if (!version) {
      return res.status(500).json({
        status: "unhealthy",
        error: "KiCad CLI did not output any version information",
        cliPath: cliPath,
        stderr: stderr ? stderr.trim() : ''
      });
    }

    res.json({
      status: "healthy",
      kicadVersion: version
    });
  });
});

export default router;
