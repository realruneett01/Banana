// Worker entry: runs one target's cases and streams progress so the parent can kill a hung case.
import { parentPort, workerData } from "node:worker_threads";
import { caseSeed, createRng, loadSeeds } from "./fuzz-lib.mjs";
import { TARGETS } from "./fuzz-targets.mjs";

function loadCorpus() {
	const sch = loadSeeds(".kicad_sch");
	const pcb = loadSeeds(".kicad_pcb");
	return { sch, pcb, all: [...sch, ...pcb] };
}

function describeInput(input) {
	const text = typeof input === "string" ? input : JSON.stringify(input);
	return String(text).slice(0, 400);
}

function shortError(err) {
	const frames = String(err?.stack ?? "")
		.split("\n")
		.filter((l) => l.trim().startsWith("at "));
	return [String(err?.message ?? err), ...frames.slice(0, 2)].join("\n");
}

function runCase(target, seeds, index, sink) {
	const rng = createRng(caseSeed(workerData.seed, index));
	const started = performance.now();
	const deep = target(rng, seeds, sink);
	const ms = performance.now() - started;
	if (ms > workerData.caseLimitMs) {
		throw new Error(
			`case took ${Math.round(ms)} ms (limit ${workerData.caseLimitMs} ms)`,
		);
	}
	return deep;
}

function caseIndexes() {
	if (workerData.onlyCase !== null) return [workerData.onlyCase];
	return Array.from({ length: workerData.iterations }, (_, i) => i);
}

function main() {
	const target = TARGETS[workerData.target];
	const seeds = loadCorpus();
	let deep = 0;
	for (const index of caseIndexes()) {
		parentPort.postMessage({ type: "start", index });
		const sink = { input: null };
		try {
			if (runCase(target, seeds, index, sink)) deep++;
		} catch (err) {
			const error = shortError(err);
			parentPort.postMessage({
				type: "fail",
				index,
				error,
				input: describeInput(sink.input),
			});
		}
	}
	parentPort.postMessage({ type: "done", deep });
}

main();
