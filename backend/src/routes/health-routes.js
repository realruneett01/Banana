import { execFile } from "node:child_process";
import { config } from "../config.js";
import { createSafeRouter } from "../safe-router.js";

const router = createSafeRouter();

router.get("/health-check", (_req, res) => {
	const cliPath = config.kicadCliPath;
	if (!cliPath) {
		return res.status(503).json({
			status: "unhealthy",
			error: config.kicadError || "kicad-cli not found",
			cliPath: "",
		});
	}

	execFile(
		cliPath,
		["--version"],
		{ timeout: 15000 },
		(error, stdout, stderr) => {
			if (error) {
				return res.status(500).json({
					status: "unhealthy",
					error:
						"KiCad CLI execution failed or executable not found/inaccessible",
					message: error.message,
					cliPath: cliPath,
					code: error.code,
					stderr: stderr ? stderr.trim() : "",
				});
			}

			const version = stdout.trim();
			if (!version) {
				return res.status(500).json({
					status: "unhealthy",
					error: "KiCad CLI did not output any version information",
					cliPath: cliPath,
					stderr: stderr ? stderr.trim() : "",
				});
			}

			res.json({
				status: "healthy",
				kicadVersion: version,
				app: "banana",
				platform: process.platform,
				arch: process.arch,
			});
		},
	);
});

export default router;
