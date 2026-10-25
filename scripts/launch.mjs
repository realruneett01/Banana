#!/usr/bin/env node
/**
 * One-command launcher: preflight/calibrate, start the server, open the browser.
 *   node scripts/launch.mjs [--no-browser] [--skip-selftest]
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ROOT } from "../backend/src/runtime-detect.js";
import { runPreflight, writeCalibration } from "./preflight.mjs";

function openBrowser(url) {
	const [cmd, args] =
		process.platform === "win32"
			? ["cmd", ["/c", "start", "", url]]
			: process.platform === "darwin"
				? ["open", [url]]
				: ["xdg-open", [url]];
	try {
		spawn(cmd, args, { stdio: "ignore", detached: true })
			.on("error", () => {})
			.unref();
	} catch {
		/* headless machine: the URL is printed anyway */
	}
}

async function main() {
	const args = process.argv.slice(2);
	console.log("Banana: checking this computer...");
	const report = await runPreflight({
		skipSelfTest: args.includes("--skip-selftest"),
	});
	const icon = { pass: "[ OK ]", warn: "[WARN]", fail: "[FAIL]" };
	for (const r of report.results)
		console.log(`${icon[r.status]} ${r.id.padEnd(12)} ${r.message}`);
	if (!report.ok) {
		console.error(
			"\nBanana cannot start on this computer yet. Fix the [FAIL] items above and run again.",
		);
		process.exit(1);
	}
	const saved = writeCalibration(report.calibration);
	if (!saved.ok)
		console.warn(`[WARN] could not save calibration: ${saved.error}`);

	const port = report.calibration.port;
	const child = spawn(
		process.execPath,
		[path.join(APP_ROOT, "backend", "src", "server.js")],
		{
			cwd: APP_ROOT,
			stdio: "inherit",
			env: {
				...process.env,
				PORT: String(port),
				HOST: process.env.HOST || report.calibration.host,
				RENDER_TIMEOUT_MS:
					process.env.RENDER_TIMEOUT_MS ||
					String(report.calibration.renderTimeoutMs),
			},
		},
	);
	const url = `http://127.0.0.1:${port}`;
	console.log(`\nBanana is starting at ${url}  (press Ctrl+C to stop)\n`);
	if (!args.includes("--no-browser")) setTimeout(() => openBrowser(url), 1200);

	const stop = () => child.kill("SIGTERM");
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	child.on("exit", (code) => process.exit(code ?? 0));
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch((err) => {
		console.error("Launcher crashed:", err);
		process.exit(1);
	});
}
