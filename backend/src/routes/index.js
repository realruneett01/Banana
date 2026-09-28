import express from 'express';
import healthRouter from './health-routes.js';
import gitRouter from './git-routes.js';
import diffRouter from './diff-routes.js';
import boardRouter from './board-routes.js';
import githubRouter from './github-routes.js';
import aiRouter from './ai-routes.js';

export function createApiRouter() {
  const api = express.Router();
  api.use(healthRouter);
  api.use('/git', gitRouter);
  api.use(diffRouter);
  api.use('/board', boardRouter);
  api.use(githubRouter);
  api.use('/ai', aiRouter);
  return api;
}

export default createApiRouter;
