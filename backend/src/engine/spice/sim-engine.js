import { createNgspice } from "./ngspice-runner.js";
import { createSharedNgspice, findNgspiceLibrary } from "./ngspice-shared.js";

const SIMULATOR_UNAVAILABLE = Object.freeze({
	ok: false,
	error: "Circuit simulator is not available",
	log: "",
});

async function resolveShared(findLibrary, createShared) {
	try {
		const libraryPath = await findLibrary();
		if (!libraryPath) return null;
		const shared = createShared({ libraryPath });
		if (await shared?.available()) return shared;
	} catch {
		// Ignore library resolution or initialization failure
	}
	return null;
}

async function resolveCli(createCli, cliOptions) {
	try {
		const cli = createCli(cliOptions);
		if (await cli?.available()) return cli;
	} catch {
		// Ignore CLI resolution or execution failure
	}
	return null;
}

async function executeDecision(opts) {
	const shared = await resolveShared(opts.findLibrary, opts.createShared);
	if (shared) return { engine: shared, kind: "kicad-shared" };
	const cli = await resolveCli(opts.createCli, opts.cliOptions);
	if (cli) return { engine: cli, kind: "cli" };
	return { engine: null, kind: "none" };
}

export function createSimEngine(options = {}) {
	const {
		findLibrary = findNgspiceLibrary,
		createShared = createSharedNgspice,
		createCli = createNgspice,
		...cliOptions
	} = options;
	const opts = { findLibrary, createShared, createCli, cliOptions };
	let decisionPromise = null;
	let state = { engine: null, kind: "none" };

	const available = () => {
		decisionPromise ??= executeDecision(opts).then((res) => {
			state = res;
			return Boolean(res.engine);
		});
		return decisionPromise;
	};

	const run = async (netlist) => {
		await available();
		return state.engine
			? state.engine.run(netlist)
			: { ...SIMULATOR_UNAVAILABLE };
	};

	return { available, run, kind: () => state.kind };
}

export default createSimEngine;
