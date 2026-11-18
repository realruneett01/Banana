import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ideAppUrl = new URL(
	"../../frontend/src/shell/IdeApp.jsx",
	import.meta.url,
);
const ideTabContentUrl = new URL(
	"../../frontend/src/shell/IdeTabContent.jsx",
	import.meta.url,
);

async function readHelperChunk(url, marker) {
	const raw = readFileSync(url, "utf8");
	const pattern = `// --- Pure ${marker} helpers ---`;
	const endPattern = `// --- End pure ${marker} helpers ---`;
	const code = raw.slice(raw.indexOf(pattern), raw.indexOf(endPattern));
	return import(`data:text/javascript,${encodeURIComponent(code)}`);
}

async function loadHelperModule(url, marker) {
	return import(url.href).catch(() => readHelperChunk(url, marker));
}

const { buildIdeCommands, handleGlobalKeyDown } = await loadHelperModule(
	ideAppUrl,
	"ide-app",
);
const { tabForKind, buildEditorRepo } = await loadHelperModule(
	ideTabContentUrl,
	"ide-tab-content",
);

describe("tabForKind mapping helper", () => {
	const EXPECTED_SPECS = [
		["welcome", "welcome", "Welcome"],
		["schematic", "schematic", "Schematic"],
		["pcb", "pcb", "PCB"],
		["3d", "3d", "3D Studio"],
		["diff", "diff", "Diff"],
		["holo", "holo", "Holo"],
		["fields", "fields", "Fields"],
		["footprints", "footprints", "Footprints"],
		["settings", "settings", "Settings"],
	];

	for (const [kind, expId, expTitle] of EXPECTED_SPECS) {
		it(`maps known kind "${kind}" to correct tab spec`, () => {
			const tab = tabForKind(kind);
			assert.deepEqual(tab, { id: expId, kind, title: expTitle });
		});
	}

	it("handles case-insensitive kinds", () => {
		assert.equal(tabForKind("SCHEMATIC")?.id, "schematic");
		assert.equal(tabForKind("Pcb")?.title, "PCB");
		assert.equal(tabForKind("3D")?.kind, "3d");
	});

	it("returns fallback spec for unknown kind", () => {
		assert.deepEqual(tabForKind("custom-viewer"), {
			id: "custom-viewer",
			kind: "custom-viewer",
			title: "custom-viewer",
		});
	});

	const INVALID_KINDS = [null, undefined, "", 123, false, {}];
	for (const invalid of INVALID_KINDS) {
		it(`returns null for invalid kind input: ${invalid}`, () => {
			assert.equal(tabForKind(invalid), null);
		});
	}
});

describe("buildEditorRepo helper", () => {
	it("resolves schematic and repo path", () => {
		const ws = {
			sidebarProps: {
				localProps: { repoPath: "/repo", relativeFilePath: "board.kicad_sch" },
			},
		};
		assert.deepEqual(buildEditorRepo(ws), {
			repoPath: "/repo",
			schPath: "board.kicad_sch",
			pcbPath: undefined,
		});
	});

	it("resolves pcb path from viewportProps", () => {
		const ws = {
			sidebarProps: { localProps: { repoPath: "/repo" } },
			viewportProps: { relativeFilePath: "board.kicad_pcb" },
		};
		assert.deepEqual(buildEditorRepo(ws), {
			repoPath: "/repo",
			schPath: undefined,
			pcbPath: "board.kicad_pcb",
		});
	});

	it("handles empty or missing ws safely", () => {
		assert.deepEqual(buildEditorRepo(null), {
			repoPath: undefined,
			schPath: undefined,
			pcbPath: undefined,
		});
	});
});

describe("buildIdeCommands", () => {
	const EXPECTED_IDS = [
		"open-editor-schematic",
		"open-editor-pcb",
		"open-3d-studio",
		"open-diff",
		"toggle-sidebar",
		"toggle-ai-panel",
		"toggle-bottom-panel",
		"show-explorer",
		"show-source-control",
		"show-simulation",
		"connect-github",
	];

	function createMocks() {
		const dispatched = [];
		const editorCalls = [];
		const studioCalls = [];
		const githubCalls = [];
		return {
			dispatched,
			dispatch: (action) => dispatched.push(action),
			loop: {
				openEditor: () => editorCalls.push(true),
				openStudio: () => studioCalls.push(true),
			},
			ws: {
				shellProps: {
					onOpenGithubModal: () => githubCalls.push(true),
				},
			},
			editorCalls,
			studioCalls,
			githubCalls,
		};
	}

	it("returns exactly 11 commands with expected IDs", () => {
		const mocks = createMocks();
		const commands = buildIdeCommands(mocks);
		assert.equal(commands.length, EXPECTED_IDS.length);
		const ids = commands.map((c) => c.id);
		assert.deepEqual(ids, EXPECTED_IDS);
	});

	const tabAction = (id, kind, title) => ({
		type: "openTab",
		tab: { id, kind, title },
	});
	const actAction = (id) => ({ type: "setActivity", id });

	const ACTION_TEST_CASES = [
		{
			id: "open-editor-schematic",
			expAction: tabAction("schematic", "schematic", "Schematic"),
			checkExtra: (m) => assert.equal(m.editorCalls.length, 1),
		},
		{
			id: "open-editor-pcb",
			expAction: tabAction("pcb", "pcb", "PCB"),
			checkExtra: (m) => assert.equal(m.editorCalls.length, 1),
		},
		{
			id: "open-3d-studio",
			expAction: tabAction("3d", "3d", "3D Studio"),
			checkExtra: (m) => assert.equal(m.studioCalls.length, 1),
		},
		{
			id: "open-diff",
			expAction: tabAction("diff", "diff", "Diff"),
		},
		{ id: "toggle-sidebar", expAction: { type: "toggleSidebar" } },
		{ id: "toggle-ai-panel", expAction: { type: "toggleAux" } },
		{ id: "toggle-bottom-panel", expAction: { type: "toggleBottom" } },
		{ id: "show-explorer", expAction: actAction("explorer") },
		{ id: "show-source-control", expAction: actAction("scm") },
		{ id: "show-simulation", expAction: actAction("simulation") },
		{
			id: "connect-github",
			checkExtra: (m) => assert.equal(m.githubCalls.length, 1),
		},
	];

	for (const tc of ACTION_TEST_CASES) {
		it(`executes command "${tc.id}" correctly`, () => {
			const mocks = createMocks();
			const commands = buildIdeCommands(mocks);
			const cmd = commands.find((c) => c.id === tc.id);
			assert.ok(cmd, `Command ${tc.id} must exist`);
			assert.equal(typeof cmd.run, "function");
			cmd.run();
			if (tc.expAction) {
				assert.equal(mocks.dispatched.length, 1);
				assert.deepEqual(mocks.dispatched[0], tc.expAction);
			}
			tc.checkExtra?.(mocks);
		});
	}
});

describe("handleGlobalKeyDown", () => {
	function makeKeyEvent(
		key,
		{ ctrl = true, meta = false, shift = false } = {},
	) {
		let prevented = false;
		return {
			event: {
				key,
				ctrlKey: ctrl,
				metaKey: meta,
				shiftKey: shift,
				preventDefault: () => {
					prevented = true;
				},
			},
			isPrevented: () => prevented,
		};
	}

	const PALETTE_SHORTCUT_TESTS = [
		{ name: "Ctrl+K", key: "k", opts: {} },
		{ name: "Ctrl+Shift+P", key: "p", opts: { shift: true } },
	];

	for (const tc of PALETTE_SHORTCUT_TESTS) {
		it(`opens palette on ${tc.name}`, () => {
			const { event, isPrevented } = makeKeyEvent(tc.key, tc.opts);
			let opened = false;
			handleGlobalKeyDown(event, {
				setPaletteOpen: () => {
					opened = true;
				},
			});
			assert.equal(opened, true);
			assert.equal(isPrevented(), true);
		});
	}

	const SHORTCUT_CASES = [
		["e", { type: "setActivity", id: "explorer" }],
		["f", { type: "setActivity", id: "search" }],
		["g", { type: "setActivity", id: "scm" }],
		["l", { type: "setActivity", id: "library" }],
		["s", { type: "setActivity", id: "simulation" }],
		["a", { type: "toggleAux" }],
	];

	for (const [key, expAction] of SHORTCUT_CASES) {
		it(`handles Ctrl+Shift+${key.toUpperCase()} shortcut`, () => {
			const { event, isPrevented } = makeKeyEvent(key, { shift: true });
			const dispatched = [];
			handleGlobalKeyDown(event, { dispatch: (a) => dispatched.push(a) });
			assert.equal(dispatched.length, 1);
			assert.deepEqual(dispatched[0], expAction);
			assert.equal(isPrevented(), true);
		});
	}

	it("ignores unmapped keys or events without ctrl/meta", () => {
		const { event, isPrevented } = makeKeyEvent("z", { ctrl: false });
		const dispatched = [];
		handleGlobalKeyDown(event, { dispatch: (a) => dispatched.push(a) });
		assert.equal(dispatched.length, 0);
		assert.equal(isPrevented(), false);
	});
});
