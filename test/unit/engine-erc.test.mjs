import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runErc } from "../../backend/src/engine/erc.js";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";

const DEFAULT_COMMIT = "1a2b3c4d5e6f";

function createPart(overrides = {}) {
	return {
		id: newId("part"),
		ref: "R1",
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		...overrides,
	};
}

function createNet(name, pins, overrides = {}) {
	return {
		id: newId("net"),
		name,
		pins,
		...overrides,
	};
}

function createConstraint(kind, target, overrides = {}) {
	return {
		id: "c_rail_1",
		kind,
		target,
		value: 3.3,
		unit: "V",
		...overrides,
	};
}

function createCleanIR() {
	const part1 = createPart({ ref: "R1" });
	const part2 = createPart({ ref: "R2" });
	const netVcc = createNet("VCC", [
		{ partId: part1.id, pin: "1" },
		{ partId: part2.id, pin: "1" },
	]);
	const netGnd = createNet("GND", [
		{ partId: part1.id, pin: "2" },
		{ partId: part2.id, pin: "2" },
	]);
	const railConstraint = createConstraint("rail", "VCC");
	return {
		schemaVersion: 1,
		name: "CleanBoard",
		parts: [part1, part2],
		nets: [netVcc, netGnd],
		constraints: [railConstraint],
	};
}

function assertValidIssues(issues) {
	for (const issue of issues) {
		const res = validateIssue(issue);
		assert.equal(
			res.ok,
			true,
			`Issue failed validateIssue: ${res.errors.join(", ")}`,
		);
		assert.equal(issue.source, "erc");
		assert.equal(issue.status, "open");
	}
}

describe("engine-erc", () => {
	test("clean IR returns zero issues", () => {
		const ir = createCleanIR();
		const issues = runErc(ir, { commit: DEFAULT_COMMIT });
		assert.deepEqual(issues, []);
	});

	test("flags net with fewer than 2 pins as error", () => {
		const part = createPart({ ref: "R1" });
		const netSingle = createNet("SENSE", [{ partId: part.id, pin: "1" }]);
		const netEmpty = createNet("UNUSED", []);
		const ir = {
			schemaVersion: 1,
			name: "FewPinsBoard",
			parts: [part],
			nets: [netSingle, netEmpty],
			constraints: [],
		};

		const issues = runErc(ir, { commit: DEFAULT_COMMIT });
		assert.equal(issues.length, 2);
		assertValidIssues(issues);

		const issueSingle = issues.find((i) => i.itemIds.includes(netSingle.id));
		assert.ok(issueSingle);
		assert.equal(issueSingle.severity, "error");
		assert.equal(issueSingle.message, "net SENSE has only 1 pin(s)");
		assert.equal(issueSingle.suggestion, "connect it or delete the net");
		assert.equal(issueSingle.commit, DEFAULT_COMMIT);

		const issueEmpty = issues.find((i) => i.itemIds.includes(netEmpty.id));
		assert.ok(issueEmpty);
		assert.equal(issueEmpty.severity, "error");
		assert.equal(issueEmpty.message, "net UNUSED has only 0 pin(s)");
		assert.equal(issueEmpty.suggestion, "connect it or delete the net");
	});

	test("flags part not connected to any net as warning", () => {
		const partConnected1 = createPart({ ref: "R1" });
		const partConnected2 = createPart({ ref: "R2" });
		const partFloating = createPart({ ref: "U1" });
		const net = createNet("NET1", [
			{ partId: partConnected1.id, pin: "1" },
			{ partId: partConnected2.id, pin: "1" },
		]);
		const ir = {
			schemaVersion: 1,
			name: "FloatingPartBoard",
			parts: [partConnected1, partConnected2, partFloating],
			nets: [net],
			constraints: [],
		};

		const issues = runErc(ir, { commit: DEFAULT_COMMIT });
		assert.equal(issues.length, 1);
		assertValidIssues(issues);

		const issue = issues[0];
		assert.equal(issue.severity, "warning");
		assert.deepEqual(issue.itemIds, [partFloating.id]);
		assert.equal(issue.message, "U1 is not connected to any net");
		assert.equal(issue.commit, DEFAULT_COMMIT);
	});

	test("flags same part pin on two different nets as error", () => {
		const part1 = createPart({ ref: "U1" });
		const part2 = createPart({ ref: "U2" });
		const netA = createNet("NET_A", [
			{ partId: part1.id, pin: "4" },
			{ partId: part2.id, pin: "1" },
		]);
		const netB = createNet("NET_B", [
			{ partId: part1.id, pin: "4" },
			{ partId: part2.id, pin: "2" },
		]);
		const ir = {
			schemaVersion: 1,
			name: "ShortBoard",
			parts: [part1, part2],
			nets: [netA, netB],
			constraints: [],
		};

		const issues = runErc(ir, { commit: DEFAULT_COMMIT });
		assert.equal(issues.length, 1);
		assertValidIssues(issues);

		const issue = issues[0];
		assert.equal(issue.severity, "error");
		assert.deepEqual(issue.itemIds, [part1.id, netA.id, netB.id]);
		assert.equal(issue.message, "U1 pin 4 is on nets NET_A and NET_B");
	});

	test("flags power rail net without rail constraint as info", () => {
		const part1 = createPart({ ref: "R1" });
		const part2 = createPart({ ref: "R2" });
		const netVdd = createNet("VDD", [
			{ partId: part1.id, pin: "1" },
			{ partId: part2.id, pin: "1" },
		]);
		const ir = {
			schemaVersion: 1,
			name: "PowerNoConstraintBoard",
			parts: [part1, part2],
			nets: [netVdd],
			constraints: [],
		};

		const issues = runErc(ir, { commit: DEFAULT_COMMIT });
		assert.equal(issues.length, 1);
		assertValidIssues(issues);

		const issue = issues[0];
		assert.equal(issue.severity, "info");
		assert.deepEqual(issue.itemIds, [netVdd.id]);
		assert.equal(issue.message, "power net VDD has no rail constraint");
		assert.equal(
			issue.suggestion,
			"add a rail constraint so the simulator can check IR drop",
		);
	});

	test("accepts power rail constraint by net name or net id", () => {
		const part1 = createPart({ ref: "R1" });
		const part2 = createPart({ ref: "R2" });
		const net3v3 = createNet("3V3", [
			{ partId: part1.id, pin: "1" },
			{ partId: part2.id, pin: "1" },
		]);
		const net5v = createNet("5V", [
			{ partId: part1.id, pin: "2" },
			{ partId: part2.id, pin: "2" },
		]);
		const ir = {
			schemaVersion: 1,
			name: "PowerWithConstraintBoard",
			parts: [part1, part2],
			nets: [net3v3, net5v],
			constraints: [
				createConstraint("rail", "3V3"),
				createConstraint("rail", net5v.id),
			],
		};

		const issues = runErc(ir, { commit: DEFAULT_COMMIT });
		assert.deepEqual(issues, []);
	});

	test("flags part without footprint as error", () => {
		const partNoFp1 = createPart({ ref: "U1", footprint: "" });
		const partNoFp2 = createPart({ ref: "U2", footprint: undefined });
		const net = createNet("NET1", [
			{ partId: partNoFp1.id, pin: "1" },
			{ partId: partNoFp2.id, pin: "1" },
		]);
		const ir = {
			schemaVersion: 1,
			name: "MissingFootprintBoard",
			parts: [partNoFp1, partNoFp2],
			nets: [net],
			constraints: [],
		};

		const issues = runErc(ir, { commit: DEFAULT_COMMIT });
		assert.equal(issues.length, 2);
		assertValidIssues(issues);

		const issueU1 = issues.find((i) => i.itemIds.includes(partNoFp1.id));
		assert.ok(issueU1);
		assert.equal(issueU1.severity, "error");
		assert.equal(issueU1.message, "U1 has no footprint");

		const issueU2 = issues.find((i) => i.itemIds.includes(partNoFp2.id));
		assert.ok(issueU2);
		assert.equal(issueU2.severity, "error");
		assert.equal(issueU2.message, "U2 has no footprint");
	});

	test("sorts issues stably: severity (error, warning, info) then message", () => {
		const partFloating = createPart({ ref: "C1" }); // warning: C1 is not connected to any net
		const partNoFp = createPart({ ref: "U9", footprint: "" }); // error: U9 has no footprint
		const netSingle = createNet("A_NET", [{ partId: partNoFp.id, pin: "1" }]); // error: net A_NET has only 1 pin(s)
		const netPower = createNet("VIN", [
			{ partId: partNoFp.id, pin: "2" },
			{ partId: partNoFp.id, pin: "3" },
		]); // info: power net VIN has no rail constraint

		const ir = {
			schemaVersion: 1,
			name: "MultiIssueBoard",
			parts: [partFloating, partNoFp],
			nets: [netSingle, netPower],
			constraints: [],
		};

		const issues = runErc(ir, { commit: DEFAULT_COMMIT });
		assert.equal(issues.length, 4);
		assertValidIssues(issues);

		// Order: error, warning, info
		// Errors: "U9 has no footprint" vs "net A_NET has only 1 pin(s)"
		// Alphabetically ("U" < "n"): "U9 has no footprint" comes before "net A_NET has only 1 pin(s)"
		assert.equal(issues[0].severity, "error");
		assert.equal(issues[0].message, "U9 has no footprint");

		assert.equal(issues[1].severity, "error");
		assert.equal(issues[1].message, "net A_NET has only 1 pin(s)");

		assert.equal(issues[2].severity, "warning");
		assert.equal(issues[2].message, "C1 is not connected to any net");

		assert.equal(issues[3].severity, "info");
		assert.equal(issues[3].message, "power net VIN has no rail constraint");
	});
});
