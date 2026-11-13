// Fuzz suite (npm run test:fuzz; not in npm test). Env: FUZZ_SEED, FUZZ_ITERATIONS, FUZZ_CASE_MS, FUZZ_TARGET, FUZZ_CASE.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Worker } from "node:worker_threads";
import { TARGETS } from "./fuzz-targets.mjs";

const MAX_SHOWN = 3;
const MIN_RUN = 100;
const WORKER_URL = new URL("./fuzz-worker.mjs", import.meta.url);

function envInt(name, fallback) {
	const n = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(n) ? n : fallback;
}

const SETTINGS = {
	seed: envInt("FUZZ_SEED", Date.now() % 2 ** 31),
	iterations: envInt("FUZZ_ITERATIONS", 300),
	caseLimitMs: envInt("FUZZ_CASE_MS", 2000),
	onlyCase: process.env.FUZZ_CASE ? envInt("FUZZ_CASE", 0) : null,
};

function reproLine(target, index) {
	return `repro: FUZZ_TARGET=${target} FUZZ_SEED=${SETTINGS.seed} FUZZ_CASE=${index} npm run test:fuzz`;
}

function formatFailure(target, f) {
	return `${reproLine(target, f.index)}\n${f.error}\ninput: ${f.input}`;
}

// A case that never posts again within the limit is a hang: the worker is killed and the case reported.
function watch(worker, state, finish) {
	const hangMs = SETTINGS.caseLimitMs * 2;
	const kick = () => {
		clearTimeout(state.timer);
		state.timer = setTimeout(() => {
			state.failures.push({
				index: state.index,
				error: `hang: no result within ${hangMs} ms`,
				input: "",
			});
			worker.terminate().then(finish);
		}, hangMs);
	};
	worker.on("message", (msg) => {
		if (msg.type === "start") state.index = msg.index;
		if (msg.type === "fail") state.failures.push(msg);
		if (msg.type !== "done") return kick();
		state.deep = msg.deep;
		clearTimeout(state.timer);
	});
	kick();
}

function runTarget(target) {
	return new Promise((resolve, reject) => {
		const state = { index: -1, failures: [], timer: null, deep: 0 };
		const worker = new Worker(WORKER_URL, {
			workerData: { ...SETTINGS, target },
		});
		const failures = () => state.failures.map((f) => formatFailure(target, f));
		const finish = () => resolve({ failures: failures(), deep: state.deep });
		watch(worker, state, finish);
		worker.on("error", reject);
		worker.on("exit", () => {
			clearTimeout(state.timer);
			finish();
		});
	});
}

function selectedTargets() {
	const only = process.env.FUZZ_TARGET;
	const names = Object.keys(TARGETS);
	return only ? names.filter((t) => t === only) : names;
}

describe(`engine fuzz (FUZZ_SEED=${SETTINGS.seed})`, () => {
	for (const target of selectedTargets()) {
		test(target, async () => {
			const { failures, deep } = await runTarget(target);
			const shown = failures.slice(0, MAX_SHOWN).join("\n\n");
			assert.equal(
				failures.length,
				0,
				`${failures.length} failing case(s)\n${shown}`,
			);
			// Guard against a vacuous run where every input is rejected before the code under test.
			if (SETTINGS.onlyCase === null && SETTINGS.iterations >= MIN_RUN) {
				assert.ok(deep > 0, `no ${target} case got past input validation`);
			}
		});
	}
});
