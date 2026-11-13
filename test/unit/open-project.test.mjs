import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createdProjectTarget,
	pickDiffCommits,
	planProjectOpen,
	shouldShowProjectHome,
	toRelativeFilePath,
} from "../../frontend/src/projects/openProject.js";

describe("toRelativeFilePath", () => {
	test("strips a Windows project root and uses forward slashes", () => {
		const rel = toRelativeFilePath(
			"C:\\work\\amp",
			"C:\\work\\amp\\sub\\amp.kicad_pcb",
		);
		assert.equal(rel, "sub/amp.kicad_pcb");
	});

	test("strips a POSIX root with a trailing slash", () => {
		assert.equal(
			toRelativeFilePath("/w/amp/", "/w/amp/amp.kicad_sch"),
			"amp.kicad_sch",
		);
	});

	test("returns empty for a file outside the root", () => {
		assert.equal(toRelativeFilePath("/w/amp", "/w/ampx/a.kicad_sch"), "");
		assert.equal(toRelativeFilePath("/w/amp", "/other/a.kicad_sch"), "");
	});

	test("returns empty for missing inputs", () => {
		assert.equal(toRelativeFilePath("", "/w/a.kicad_sch"), "");
		assert.equal(toRelativeFilePath("/w", undefined), "");
	});
});

describe("planProjectOpen", () => {
	test("plans a schematic open", () => {
		const plan = planProjectOpen({
			projectRoot: "/w/amp",
			filePath: "/w/amp/amp.kicad_sch",
			kind: "schematic",
		});
		assert.deepEqual(plan, {
			repoPath: "/w/amp",
			relativeFilePath: "amp.kicad_sch",
			editorRepo: {
				repoPath: "/w/amp",
				schPath: "amp.kicad_sch",
				pcbPath: undefined,
			},
		});
	});

	test("plans a pcb open", () => {
		const plan = planProjectOpen({
			projectRoot: "/w/amp",
			filePath: "/w/amp/amp.kicad_pcb",
			kind: "pcb",
		});
		assert.equal(plan.editorRepo.pcbPath, "amp.kicad_pcb");
		assert.equal(plan.editorRepo.schPath, undefined);
	});

	test("rejects a non-design file, a foreign path and a missing target", () => {
		assert.equal(
			planProjectOpen({ projectRoot: "/w", filePath: "/w/a.kicad_pro" }),
			null,
		);
		assert.equal(
			planProjectOpen({ projectRoot: "/w", filePath: "/x/a.kicad_sch" }),
			null,
		);
		assert.equal(planProjectOpen(null), null);
	});
});

describe("pickDiffCommits", () => {
	test("uses the newest commit as target and the previous as base", () => {
		const pair = pickDiffCommits([{ hash: "c2" }, { hash: "c1" }]);
		assert.deepEqual(pair, { baseCommit: "c1", targetCommit: "c2" });
	});

	test("compares a single commit with itself", () => {
		assert.deepEqual(pickDiffCommits([{ hash: "c1" }]), {
			baseCommit: "c1",
			targetCommit: "c1",
		});
	});

	test("returns null without commits", () => {
		assert.equal(pickDiffCommits([]), null);
		assert.equal(pickDiffCommits(undefined), null);
	});
});

describe("createdProjectTarget", () => {
	test("prefers the schematic of a new project", () => {
		const target = createdProjectTarget({
			projectRoot: "/w/amp",
			files: ["amp.kicad_pro", "amp.kicad_pcb", "amp.kicad_sch"],
		});
		assert.deepEqual(target, {
			projectRoot: "/w/amp",
			filePath: "/w/amp/amp.kicad_sch",
			kind: "schematic",
		});
	});

	test("falls back to the pcb", () => {
		const target = createdProjectTarget({
			projectRoot: "/w/amp",
			files: ["amp.kicad_pcb"],
		});
		assert.equal(target.kind, "pcb");
		assert.equal(target.filePath, "/w/amp/amp.kicad_pcb");
	});

	test("returns null when nothing is openable", () => {
		assert.equal(
			createdProjectTarget({ projectRoot: "/w", files: ["a.kicad_pro"] }),
			null,
		);
		assert.equal(createdProjectTarget(null), null);
	});
});

describe("shouldShowProjectHome", () => {
	test("shows home when no repo is open", () => {
		assert.equal(
			shouldShowProjectHome({ homeRequested: false, repoPath: "" }),
			true,
		);
	});

	test("hides home once a repo is open", () => {
		assert.equal(
			shouldShowProjectHome({ homeRequested: false, repoPath: "/w" }),
			false,
		);
	});

	test("shows home when the user asks for it", () => {
		assert.equal(
			shouldShowProjectHome({ homeRequested: true, repoPath: "/w" }),
			true,
		);
	});
});
