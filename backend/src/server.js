import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { createApiRouter } from './routes/index.js';

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api', createApiRouter());

function setupStaticServing(expressApp) {
  const candidateDirs = [
    process.env.STATIC_DIR,
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd(), 'public')
  ];
  const staticDir = candidateDirs.find(d => Boolean(d && fs.existsSync(d)));

  if (staticDir) {
    console.log(`[Banana] Serving static frontend from: ${staticDir}`);
    expressApp.use(express.static(staticDir));
    expressApp.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }
}

setupStaticServing(app);

const PORT = config.port;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`KiCad CLI path: ${config.kicadCliPath}`);
});

export default app;
