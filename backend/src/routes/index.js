import express from "express";
import { apiErrorHandler } from "../safe-router.js";
import aiRouter from "./ai-routes.js";
import boardRouter from "./board-routes.js";
import diffRouter from "./diff-routes.js";
import gitRouter from "./git-routes.js";
import githubRouter from "./github-routes.js";
import healthRouter from "./health-routes.js";

export function createApiRouter() {
	const api = express.Router();
	api.use(healthRouter);
	api.use("/git", gitRouter);
	api.use(diffRouter);
	api.use("/board", boardRouter);
	api.use(githubRouter);
	api.use("/ai", aiRouter);
	api.use((_req, res) => res.status(404).json({ error: "Not found" }));
	api.use(apiErrorHandler);
	return api;
}

export default createApiRouter;
