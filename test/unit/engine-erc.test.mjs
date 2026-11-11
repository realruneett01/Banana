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

function createIR({
	name = "Board",
	parts = [],
	nets = [],
	constraints = [],
} = {}) {
	return {
		schemaVersion: 1,
		name,
		parts,
		nets,
		constraints,
	};
}

function connectPins(name, [partA, pinA], [partB, pinB]) {
	return createNet(name, [
		{ partId: partA.id, pin: pinA },
		{ partId: partB.id, pin: pinB },
	]);
}

function createCleanIR() {
	const [part1, part2] = [createPart({ ref: "R1" }), createPart({ ref: "R2" })];
	return createIR({
		name: "CleanBoard",
		parts: [part1, part2],
		nets: [
			connectPins("VCC", [part1, "1"], [part2, "1"]),
			connectPins("GND", [part1, "2"], [part2, "2"]),
		],
		constraints: [createConstraint("rail", "VCC")],
	});
}

function assertValidIssues(issues) {
	for (const issue of issues) {
		const validation = validateIssue(issue);
		assert.ok(
			validation.ok,
			`Issue failed validateIssue: ${validation.errors.join(", ")}`,
		);
		assert.deepEqual([issue.source, issue.status], ["erc", "open"]);
	}
}

function assertIssue(issue, expected) {
	assert.ok(issue, "expected issue to exist");
	for (const [key, value] of Object.entries(expected)) {
		assert.deepEqual(issue[key], value);
	}
}

function runAndCheckIssues(ir, expectedCount) {
	const issues = runErc(ir, { commit: DEFAULT_COMMIT });
	assert.equal(issues.length, expectedCount);
	assertValidIssues(issues);
	return issues;
}

const CASES = [
	{
		name: "clean IR returns zero issues",
		run() {
			const ir = createCleanIR();
			const issues = runErc(ir, { commit: DEFAULT_COMMIT });
			assert.deepEqual(issues, []);
		},
	},
	{
		name: "flags net with fewer than 2 pins as error",
		run() {
			const part = createPart({ ref: "R1" });
			const netSingle = createNet("SENSE", [{ partId: part.id, pin: "1" }]);
			const netEmpty = createNet("UNUSED", []);
			const ir = createIR({
				name: "FewPinsBoard",
				parts: [part],
				nets: [netSingle, netEmpty],
			});

			const issues = runAndCheckIssues(ir, 2);
			const expectedList = [
				{
					itemId: netSingle.id,
					severity: "error",
					message: "net SENSE has only 1 pin(s)",
					suggestion: "connect it or delete the net",
					commit: DEFAULT_COMMIT,
				},
				{
					itemId: netEmpty.id,
					severity: "error",
					message: "net UNUSED has only 0 pin(s)",
					suggestion: "connect it or delete the net",
				},
			];
			for (const { itemId, ...expected } of expectedList) {
				const issue = issues.find((i) => i.itemIds.includes(itemId));
				assertIssue(issue, expected);
			}
		},
	},
	{
		name: "flags part not connected to any net as warning",
		run() {
			const [r1, r2] = [createPart({ ref: "R1" }), createPart({ ref: "R2" })];
			const u1 = createPart({ ref: "U1" });
			const ir = createIR({
				name: "FloatingPartBoard",
				parts: [r1, r2, u1],
				nets: [connectPins("NET1", [r1, "1"], [r2, "1"])],
			});

			const issues = runAndCheckIssues(ir, 1);
			assertIssue(issues[0], {
				severity: "warning",
				itemIds: [u1.id],
				message: "U1 is not connected to any net",
				commit: DEFAULT_COMMIT,
			});
		},
	},
	{
		name: "flags same part pin on two different nets as error",
		run() {
			const [u1, u2] = [createPart({ ref: "U1" }), createPart({ ref: "U2" })];
			const netA = connectPins("NET_A", [u1, "4"], [u2, "1"]);
			const netB = connectPins("NET_B", [u1, "4"], [u2, "2"]);
			const ir = createIR({
				name: "ShortBoard",
				parts: [u1, u2],
				nets: [netA, netB],
			});

			const issues = runAndCheckIssues(ir, 1);
			assertIssue(issues[0], {
				severity: "error",
				itemIds: [u1.id, netA.id, netB.id],
				message: "U1 pin 4 is on nets NET_A and NET_B",
			});
		},
	},
	{
		name: "flags power rail net without rail constraint as info",
		run() {
			const [r1, r2] = [createPart({ ref: "R1" }), createPart({ ref: "R2" })];
			const netVdd = connectPins("VDD", [r1, "1"], [r2, "1"]);
			const ir = createIR({
				name: "PowerNoConstraintBoard",
				parts: [r1, r2],
				nets: [netVdd],
			});

			const issues = runAndCheckIssues(ir, 1);
			assertIssue(issues[0], {
				severity: "info",
				itemIds: [netVdd.id],
				message: "power net VDD has no rail constraint",
				suggestion: "add a rail constraint so the simulator can check IR drop",
			});
		},
	},
	{
		name: "accepts power rail constraint by net name or net id",
		run() {
			const [r1, r2] = [createPart({ ref: "R1" }), createPart({ ref: "R2" })];
			const net3v3 = connectPins("3V3", [r1, "1"], [r2, "1"]);
			const net5v = connectPins("5V", [r1, "2"], [r2, "2"]);
			const ir = createIR({
				name: "PowerWithConstraintBoard",
				parts: [r1, r2],
				nets: [net3v3, net5v],
				constraints: [
					createConstraint("rail", "3V3"),
					createConstraint("rail", net5v.id),
				],
			});

			const issues = runErc(ir, { commit: DEFAULT_COMMIT });
			assert.deepEqual(issues, []);
		},
	},
	{
		name: "flags part without footprint as error",
		run() {
			const [u1, u2] = [
				createPart({ ref: "U1", footprint: "" }),
				createPart({ ref: "U2", footprint: undefined }),
			];
			const ir = createIR({
				name: "MissingFootprintBoard",
				parts: [u1, u2],
				nets: [connectPins("NET1", [u1, "1"], [u2, "1"])],
			});

			const issues = runAndCheckIssues(ir, 2);
			const expectedList = [
				{ itemId: u1.id, message: "U1 has no footprint" },
				{ itemId: u2.id, message: "U2 has no footprint" },
			];
			for (const { itemId, message } of expectedList) {
				const issue = issues.find((i) => i.itemIds.includes(itemId));
				assertIssue(issue, { severity: "error", message });
			}
		},
	},
	{
		name: "sorts issues stably: severity (error, warning, info) then message",
		run() {
			const partFloating = createPart({ ref: "C1" });
			const partNoFp = createPart({ ref: "U9", footprint: "" });
			const netSingle = createNet("A_NET", [{ partId: partNoFp.id, pin: "1" }]);
			const netPower = createNet("VIN", [
				{ partId: partNoFp.id, pin: "2" },
				{ partId: partNoFp.id, pin: "3" },
			]);
			const ir = createIR({
				name: "MultiIssueBoard",
				parts: [partFloating, partNoFp],
				nets: [netSingle, netPower],
			});

			const issues = runAndCheckIssues(ir, 4);

			// Order: error, warning, info
			// Errors: "U9 has no footprint" vs "net A_NET has only 1 pin(s)"
			// Alphabetically ("U" < "n"): "U9 has no footprint" comes before "net A_NET has only 1 pin(s)"
			const expectedSequence = [
				{ severity: "error", message: "U9 has no footprint" },
				{ severity: "error", message: "net A_NET has only 1 pin(s)" },
				{ severity: "warning", message: "C1 is not connected to any net" },
				{ severity: "info", message: "power net VIN has no rail constraint" },
			];
			for (const [i, expected] of expectedSequence.entries()) {
				assertIssue(issues[i], expected);
			}
		},
	},
];

describe("engine-erc", () => {
	for (const { name, run } of CASES) {
		test(name, run);
	}
});
