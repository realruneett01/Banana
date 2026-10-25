#!/usr/bin/env node
/**
 * Banana preflight + calibration.
 *
 * Verifies this machine can run Banana, proves the diff engine produces the
 * expected result on a built-in ground-truth board pair, measures the machine,
 * and writes .banana/autoconfig.json so the server starts with settings that fit
 * this computer. Exit code 0 = ready, 1 = a blocking check failed.
 *
 *   node scripts/preflight.mjs [--json] [--no-write] [--skip-selftest] [--port N]
 */
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	APP_ROOT,
	autoconfigPath,
	findKicadCli,
	machineFingerprint,
	parsePort,
	probeKicadVersion,
	resolveTempRoot,
} from "../backend/src/runtime-detect.js";
import { sampleBoard, sampleSchematic } from "../samples/gen-sample.mjs";

const MIN_NODE = [20, 11];
const MIN_FREE_BYTES = 256 * 1024 * 1024;

const PASS = "pass";
const WARN = "warn";
const FAIL = "fail";

function check(id, status, message, extra = {}) {
	return { id, status, message, ...extra };
}

export function checkNode(version = process.versions.node) {
	const [maj, min] = version.split(".").map(Number);
	const ok = maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1]);
	return ok
		? check("node", PASS, `Node.js ${version}`)
		: check(
				"node",
				FAIL,
				`Node.js ${version} is too old; need >= ${MIN_NODE.join(".")}`,
			);
}

export function checkPlatform() {
	const m = machineFingerprint();
	const known =
		["win32", "linux", "darwin"].includes(m.platform) &&
		["x64", "arm64"].includes(m.arch);
	return check(
		"platform",
		known ? PASS : WARN,
		`${m.platform}/${m.arch}${known ? "" : " (untested platform)"}`,
		{ machine: m },
	);
}

export function checkGit() {
	try {
		const v = execFileSync("git", ["--version"], {
			encoding: "utf8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return check("git", PASS, v);
	} catch {
		return check(
			"git",
			FAIL,
			"git not found on PATH (needed to read commits from local repositories)",
		);
	}
}

export function checkKicad(opts = {}) {
	const found = findKicadCli(opts);
	if (!found.path) {
		return check(
			"kicad",
			FAIL,
			"kicad-cli not found. Install KiCad 7+ or place it under runtime/kicad*/ (see README).",
			{ tried: found.tried },
		);
	}
	const probe = probeKicadVersion(found.path);
	if (!probe.ok)
		return check(
			"kicad",
			FAIL,
			`kicad-cli at ${found.path} does not run: ${probe.error}`,
		);
	const major = Number.parseInt(probe.version, 10);
	const note = major < 7 ? " (KiCad < 7 is unsupported)" : "";
	return check(
		"kicad",
		major < 7 ? FAIL : PASS,
		`kicad-cli ${probe.version} at ${found.path} [${found.source}]${note}`,
		{
			path: found.path,
			version: probe.version,
			source: found.source,
		},
	);
}

export function checkFrontend(appRoot = APP_ROOT) {
	const index = path.join(appRoot, "frontend", "dist", "index.html");
	return fs.existsSync(index)
		? check("frontend", PASS, "Built UI present (frontend/dist)")
		: check(
				"frontend",
				FAIL,
				"frontend/dist is missing. Run `npm run build` (or use a portable bundle built with `npm run make-portable`).",
			);
}

export function checkDependencies(appRoot = APP_ROOT) {
	const missing = ["express", "cors", "dotenv"].filter((d) => {
		try {
			return (
				!fs.existsSync(path.join(appRoot, "node_modules", d)) &&
				!fs.existsSync(path.join(appRoot, "backend", "node_modules", d))
			);
		} catch {
			return true;
		}
	});
	return missing.length === 0
		? check("dependencies", PASS, "Server dependencies installed")
		: check(
				"dependencies",
				FAIL,
				`Missing npm packages: ${missing.join(", ")}. Run \`npm ci\`.`,
			);
}

export async function checkWritable(dir, id = "tempdir") {
	try {
		fs.mkdirSync(dir, { recursive: true });
		const probe = path.join(
			dir,
			`.write-test-${process.pid}-${crypto.randomBytes(3).toString("hex")}`,
		);
		fs.writeFileSync(probe, "ok");
		fs.rmSync(probe);
		let free = null;
		try {
			const st = await fs.promises.statfs(dir);
			free = Number(st.bavail) * Number(st.bsize);
		} catch {
			/* statfs unsupported */
		}
		if (free !== null && free < MIN_FREE_BYTES) {
			return check(
				id,
				WARN,
				`${dir} writable but only ${(free / 1048576).toFixed(0)} MiB free`,
				{ dir, free },
			);
		}
		return check(
			id,
			PASS,
			`${dir} writable${free === null ? "" : `, ${(free / 1073741824).toFixed(1)} GiB free`}`,
			{ dir, free },
		);
	} catch (err) {
		return check(id, FAIL, `${dir} is not writable: ${err.message}`, { dir });
	}
}

export function isPortFree(port, host = "127.0.0.1") {
	return new Promise((resolve) => {
		const srv = net.createServer();
		srv.once("error", () => resolve(false));
		srv.once("listening", () => srv.close(() => resolve(true)));
		srv.listen(port, host);
	});
}

export async function pickPort(preferred, isFree = isPortFree) {
	for (let p = preferred; p < preferred + 50 && p <= 65535; p++) {
		if (await isFree(p)) return p;
	}
	return null;
}

export function checkIntegrity(appRoot = APP_ROOT) {
	const manifest = path.join(appRoot, "MANIFEST.sha256");
	if (!fs.existsSync(manifest))
		return check(
			"integrity",
			PASS,
			"No manifest (development checkout); skipped",
		);
	const bad = [];
	let count = 0;
	for (const line of fs.readFileSync(manifest, "utf8").split(/\r?\n/)) {
		const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
		if (!m) continue;
		count++;
		const file = path.join(appRoot, m[2]);
		try {
			const h = crypto
				.createHash("sha256")
				.update(fs.readFileSync(file))
				.digest("hex");
			if (h !== m[1]) bad.push(`${m[2]} (modified)`);
		} catch {
			bad.push(`${m[2]} (missing)`);
		}
	}
	return bad.length === 0
		? check("integrity", PASS, `${count} files match MANIFEST.sha256`)
		: check(
				"integrity",
				FAIL,
				`Corrupted or altered files: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ` and ${bad.length - 5} more` : ""}`,
				{ bad },
			);
}

async function waitForHealth(port, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/api/health-check`);
			if (r.ok) return await r.json();
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	throw new Error("server did not become healthy in time");
}

async function postJson(port, route, body) {
	const r = await fetch(`http://127.0.0.1:${port}${route}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return { status: r.status, body: await r.json() };
}

function git(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: os.devNull,
			GIT_CONFIG_SYSTEM: os.devNull,
		},
	});
}

/**
 * Ground-truth self-test. Boots a throw-away server, diffs two boards whose
 * differences are known (R1 moved exactly 2.00 mm; one GND trace added on B.Cu)
 * and one schematic pair, and verifies the engine reports exactly that.
 */
export async function runSelfTest({
	kicadPath,
	port,
	tempRoot,
	appRoot = APP_ROOT,
}) {
	const work = fs.mkdtempSync(path.join(tempRoot, "selftest-"));
	let child;
	try {
		const repo = path.join(work, "repo");
		fs.mkdirSync(repo);
		git(repo, "init", "-q");
		git(repo, "config", "user.email", "preflight@banana.invalid");
		git(repo, "config", "user.name", "preflight");
		git(repo, "config", "commit.gpgsign", "false");
		fs.writeFileSync(path.join(repo, "board.kicad_pcb"), sampleBoard());
		fs.writeFileSync(path.join(repo, "sheet.kicad_sch"), sampleSchematic());
		git(repo, "add", ".");
		git(repo, "commit", "-qm", "base");
		const base = git(repo, "rev-parse", "HEAD").trim();
		fs.writeFileSync(
			path.join(repo, "board.kicad_pcb"),
			sampleBoard({ r1x: 112, trackEndX: 122, extraTrack: true }),
		);
		fs.writeFileSync(
			path.join(repo, "sheet.kicad_sch"),
			sampleSchematic({ value: "22k" }),
		);
		git(repo, "commit", "-qam", "target");
		const target = git(repo, "rev-parse", "HEAD").trim();

		child = spawn(
			process.execPath,
			[path.join(appRoot, "backend", "src", "server.js")],
			{
				cwd: appRoot,
				env: {
					...process.env,
					PORT: String(port),
					HOST: "127.0.0.1",
					KICAD_CLI_PATH: kicadPath,
					BANANA_TEMP_DIR: path.join(work, "tmp"),
					BANANA_AUTOCONFIG: path.join(work, "none.json"),
					// The throw-away self-test server must not inherit the deployment's login/token settings.
					BANANA_AUTH: "off",
					BANANA_ACCESS_TOKEN: "",
					BANANA_ADMIN_USER: "",
					BANANA_ADMIN_PASSWORD: "",
					BANANA_DATA_DIR: path.join(work, "data"),
				},
				stdio: ["ignore", "ignore", "pipe"],
			},
		);
		let stderr = "";
		child.stderr.on("data", (c) => {
			stderr += c;
		});
		await waitForHealth(port, 20000);

		const t0 = performance.now();
		const pcb = await postJson(port, "/api/diff/process", {
			repoPath: repo,
			baseCommit: base,
			targetCommit: target,
			relativeFilePath: "board.kicad_pcb",
		});
		const pcbMs = performance.now() - t0;
		const problems = [];
		if (pcb.status !== 200) {
			problems.push(
				`PCB diff returned HTTP ${pcb.status}: ${pcb.body.error || ""} ${pcb.body.details || ""}`.trim(),
			);
		} else {
			const mods = pcb.body.modifications || [];
			const r1 = mods.find((m) => m.refDes === "R1" && m.type === "COMPONENT");
			if (!r1) problems.push("R1 relocation was not detected");
			else if (Math.abs(r1.displacement - 2) > 0.05)
				problems.push(`R1 displacement ${r1.displacement} mm, expected 2.00`);
			if (!mods.some((m) => m.action === "ADDED" && m.type === "TRACE"))
				problems.push("added trace was not detected");
			if ((pcb.body.pcbMetadata?.footprintCount ?? 0) !== 2)
				problems.push("footprint parse count wrong");
		}
		const sch = await postJson(port, "/api/diff/process", {
			repoPath: repo,
			baseCommit: base,
			targetCommit: target,
			relativeFilePath: "sheet.kicad_sch",
		});
		if (sch.status !== 200)
			problems.push(
				`Schematic diff returned HTTP ${sch.status}: ${sch.body.error || ""} ${sch.body.details || ""}`.trim(),
			);
		else if ((sch.body.modifications || []).length === 0)
			problems.push("schematic value change was not detected");

		return {
			ok: problems.length === 0,
			problems,
			pcbMs,
			stderr: stderr.trim().split("\n").slice(-3).join("\n"),
		};
	} catch (err) {
		return { ok: false, problems: [err.message], pcbMs: 0 };
	} finally {
		if (child && child.exitCode === null) {
			child.kill("SIGTERM");
			await new Promise((r) => setTimeout(r, 200));
			if (child.exitCode === null) child.kill("SIGKILL");
		}
		fs.rmSync(work, { recursive: true, force: true });
	}
}

/** Maps measured sample speed to a render timeout. Heuristic: real boards are far larger than the sample. */
export function calibrateRenderTimeout(sampleMs) {
	const scaled = Math.round(sampleMs * 60);
	return Math.min(300000, Math.max(60000, scaled));
}

export async function runPreflight(opts = {}) {
	const appRoot = opts.appRoot || APP_ROOT;
	const tempRoot = resolveTempRoot();
	const results = [];
	results.push(checkNode(), checkPlatform(), checkGit());
	const kicad = checkKicad();
	results.push(
		kicad,
		checkFrontend(appRoot),
		checkDependencies(appRoot),
		checkIntegrity(appRoot),
	);
	results.push(await checkWritable(tempRoot, "tempdir"));

	const wantPort = opts.port ?? parsePort(process.env.PORT, 5000);
	const port = await pickPort(wantPort);
	results.push(
		port === null
			? check("port", FAIL, `No free port in ${wantPort}-${wantPort + 49}`)
			: check(
					"port",
					PASS,
					port === wantPort
						? `Port ${port} free`
						: `Port ${wantPort} busy; using ${port}`,
					{ port },
				),
	);

	let selfTest = null;
	const prereqsOk = results.every(
		(r) => r.status !== FAIL || r.id === "frontend",
	);
	if (
		!opts.skipSelfTest &&
		prereqsOk &&
		kicad.status === PASS &&
		port !== null
	) {
		const testPort = (await pickPort(port + 1)) ?? port;
		selfTest = await runSelfTest({
			kicadPath: kicad.path,
			port: testPort,
			tempRoot,
			appRoot,
		});
		results.push(
			selfTest.ok
				? check(
						"selftest",
						PASS,
						`Diff engine verified on ground-truth boards (${selfTest.pcbMs.toFixed(0)} ms)`,
					)
				: check(
						"selftest",
						FAIL,
						`Self-test failed: ${selfTest.problems.join("; ")}`,
					),
		);
	} else if (!opts.skipSelfTest) {
		results.push(
			check("selftest", WARN, "Skipped because a prerequisite failed"),
		);
	}

	const failed = results.filter((r) => r.status === FAIL);
	const calibration = {
		version: 1,
		createdAt: new Date().toISOString(),
		machine: machineFingerprint(),
		kicadCliPath: kicad.path || "",
		kicadVersion: kicad.version || "",
		port: port ?? wantPort,
		host: process.env.HOST || "127.0.0.1",
		renderTimeoutMs: selfTest?.ok
			? calibrateRenderTimeout(selfTest.pcbMs)
			: 120000,
		cacheMaxEntries: 200,
		cpus: os.cpus().length,
		memoryGiB: Number((os.totalmem() / 1073741824).toFixed(1)),
	};
	return { ok: failed.length === 0, results, calibration };
}

export function writeCalibration(calibration, appRoot = APP_ROOT) {
	const target = autoconfigPath(appRoot);
	try {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, `${JSON.stringify(calibration, null, 2)}\n`);
		return { ok: true, path: target };
	} catch (err) {
		return { ok: false, path: target, error: err.message };
	}
}

const ICON = { pass: "[ OK ]", warn: "[WARN]", fail: "[FAIL]" };

async function main() {
	const args = process.argv.slice(2);
	const flag = (n) => args.includes(n);
	const portIdx = args.indexOf("--port");
	const report = await runPreflight({
		skipSelfTest: flag("--skip-selftest"),
		port: portIdx > -1 ? parsePort(args[portIdx + 1], undefined) : undefined,
	});

	let written = null;
	if (!flag("--no-write") && report.ok)
		written = writeCalibration(report.calibration);

	if (flag("--json")) {
		console.log(JSON.stringify({ ...report, written }, null, 2));
	} else {
		console.log("\nBanana preflight\n----------------");
		for (const r of report.results)
			console.log(`${ICON[r.status]} ${r.id.padEnd(12)} ${r.message}`);
		if (written?.ok) console.log(`\nCalibration saved to ${written.path}`);
		else if (written)
			console.log(
				`\nWARNING: could not save calibration (${written.error}). Set BANANA_AUTOCONFIG to a writable path.`,
			);
		console.log(
			report.ok
				? "\nRESULT: READY\n"
				: "\nRESULT: NOT READY - fix the [FAIL] items above.\n",
		);
	}
	process.exit(report.ok ? 0 : 1);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch((err) => {
		console.error("Preflight crashed:", err);
		process.exit(1);
	});
}
