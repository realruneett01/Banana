import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const activityBarUrl = new URL(
	"../../frontend/src/shell/ActivityBar.jsx",
	import.meta.url,
);
const statusBarUrl = new URL(
	"../../frontend/src/shell/StatusBar.jsx",
	import.meta.url,
);
const ideAppUrl = new URL(
	"../../frontend/src/shell/IdeApp.jsx",
	import.meta.url,
);

async function loadHelper(fileUrl, functionName) {
	try {
		const mod = await import(fileUrl.href);
		if (typeof mod[functionName] === "function") {
			return mod[functionName];
		}
	} catch {
		const source = readFileSync(fileUrl, "utf8");
		const functions = [];
		const regex =
			/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g;
		for (const match of source.matchAll(regex)) {
			if (!match[0].includes("<")) {
				functions.push(match[0]);
			}
		}
		const mod = await import(
			`data:text/javascript,${encodeURIComponent(functions.join("\n\n"))}`
		);
		if (typeof mod[functionName] === "function") {
			return mod[functionName];
		}
		throw new Error(`Symbol ${functionName} not found in ${fileUrl.pathname}`);
	}
}

const activityButtonState = await loadHelper(
	activityBarUrl,
	"activityButtonState",
);
const segmentToneColor = await loadHelper(statusBarUrl, "segmentToneColor");
const formatCoordinates = await loadHelper(statusBarUrl, "formatCoordinates");
const formatGrid = await loadHelper(statusBarUrl, "formatGrid");
const formatProblemsStatus = await loadHelper(
	statusBarUrl,
	"formatProblemsStatus",
);
const handleSegmentKeyDown = await loadHelper(
	statusBarUrl,
	"handleSegmentKeyDown",
);
globalThis.formatCoordinates = formatCoordinates;
globalThis.formatGrid = formatGrid;
globalThis.formatProblemsStatus = formatProblemsStatus;
const buildLeftSegments = await loadHelper(ideAppUrl, "buildLeftSegments");
const buildRightSegments = await loadHelper(ideAppUrl, "buildRightSegments");

const activityBarSrc = readFileSync(activityBarUrl, "utf8");
const statusBarSrc = readFileSync(statusBarUrl, "utf8");
const ideAppSrc = readFileSync(ideAppUrl, "utf8");

describe("activityButtonState helper", () => {
	const activeTestCases = [
		{
			desc: "active when sidebarOpen is true and id matches",
			item: { id: "explorer" },
			activeId: "explorer",
			sidebarOpen: true,
			expectedActive: true,
			expectedBorder: "2px solid var(--bn-color-brand, #f5c542)",
			expectedColor: "var(--bn-text-primary, #e6e8ee)",
		},
		{
			desc: "inactive when sidebarOpen is false even if id matches",
			item: { id: "explorer" },
			activeId: "explorer",
			sidebarOpen: false,
			expectedActive: false,
			expectedBorder: "2px solid transparent",
			expectedColor: "var(--bn-text-muted, #5d6476)",
		},
		{
			desc: "inactive when id does not match activeId",
			item: { id: "search" },
			activeId: "explorer",
			sidebarOpen: true,
			expectedActive: false,
			expectedBorder: "2px solid transparent",
			expectedColor: "var(--bn-text-muted, #5d6476)",
		},
		{
			desc: "handles string id as item input",
			item: "scm",
			activeId: "scm",
			sidebarOpen: true,
			expectedActive: true,
			expectedBorder: "2px solid var(--bn-color-brand, #f5c542)",
			expectedColor: "var(--bn-text-primary, #e6e8ee)",
		},
		{
			desc: "handles null or undefined item safely",
			item: null,
			activeId: "explorer",
			sidebarOpen: true,
			expectedActive: false,
			expectedBorder: "2px solid transparent",
			expectedColor: "var(--bn-text-muted, #5d6476)",
		},
	];

	for (const tc of activeTestCases) {
		test(tc.desc, () => {
			const state = activityButtonState(tc.item, tc.activeId, tc.sidebarOpen);
			assert.equal(state.active, tc.expectedActive);
			assert.equal(state.isActive, tc.expectedActive);
			assert.equal(state.borderLeft, tc.expectedBorder);
			assert.equal(state.color, tc.expectedColor);
		});
	}
});

describe("segmentToneColor helper", () => {
	const toneCases = [
		["warning", "var(--bn-color-warning, #faad14)"],
		["WARNING", "var(--bn-color-warning, #faad14)"],
		["error", "var(--bn-color-error, #f0606a)"],
		["ERROR", "var(--bn-color-error, #f0606a)"],
		["success", "var(--bn-color-success, #3dd68c)"],
		["default", "var(--bn-text-secondary, #8a91a3)"],
		[undefined, "var(--bn-text-secondary, #8a91a3)"],
		[null, "var(--bn-text-secondary, #8a91a3)"],
		["unknown", "var(--bn-text-secondary, #8a91a3)"],
	];

	for (const [tone, expectedColor] of toneCases) {
		test(`returns correct color for tone: ${tone}`, () => {
			assert.equal(segmentToneColor(tone), expectedColor);
		});
	}
});

describe("ActivityBar component contract", () => {
	const expectedIcons = [
		"FolderOutlined",
		"SearchOutlined",
		"BranchesOutlined",
		"AppstoreOutlined",
		"ThunderboltOutlined",
		"RobotOutlined",
		"UserOutlined",
		"SettingOutlined",
	];

	test("contains all required Ant Design icons", () => {
		for (const icon of expectedIcons) {
			assert.ok(
				activityBarSrc.includes(icon),
				`Expected ActivityBar to reference ${icon}`,
			);
		}
	});

	test("references 48px activity bar width and styling tokens", () => {
		assert.ok(activityBarSrc.includes("--bn-activity-bar-w"));
		assert.ok(activityBarSrc.includes("48px"));
		assert.ok(activityBarSrc.includes("--bn-color-brand"));
	});

	test("implements Tooltip, aria-label and badge", () => {
		assert.ok(activityBarSrc.includes("Tooltip"));
		assert.ok(activityBarSrc.includes("aria-label"));
		assert.ok(activityBarSrc.includes("badge"));
	});
});

describe("StatusBar component contract", () => {
	test("references 22px height and 11px font tokens", () => {
		assert.ok(statusBarSrc.includes("--bn-status-bar-h"));
		assert.ok(statusBarSrc.includes("22px"));
		assert.ok(statusBarSrc.includes("--bn-type-status"));
		assert.ok(statusBarSrc.includes("11px"));
	});

	test("handles clickable segments as buttons with aria-label", () => {
		assert.ok(statusBarSrc.includes("<button"));
		assert.ok(statusBarSrc.includes("aria-label"));
		assert.ok(statusBarSrc.includes("onClick"));
	});

	test("styles first left segment with brand-tinted background", () => {
		assert.ok(statusBarSrc.includes("--bn-accent-soft"));
	});
});

describe("formatCoordinates helper", () => {
	const coordCases = [
		{
			desc: "formats zero coordinates with mm",
			args: [0, 0, "mm"],
			expected: "X: 0.00mm Y: 0.00mm",
		},
		{
			desc: "formats positive and negative decimals",
			args: [12.345, -6.789, "mm"],
			expected: "X: 12.35mm Y: -6.79mm",
		},
		{
			desc: "formats coordinates with inch units",
			args: [1.25, 2.5, "in"],
			expected: "X: 1.25in Y: 2.50in",
		},
		{
			desc: "handles -0 properly",
			args: [-0, 0, "mm"],
			expected: "X: 0.00mm Y: 0.00mm",
		},
		{
			desc: "handles missing and null arguments with defaults",
			args: [null, undefined],
			expected: "X: 0.00mm Y: 0.00mm",
		},
	];

	for (const tc of coordCases) {
		test(tc.desc, () => {
			assert.equal(formatCoordinates(...tc.args), tc.expected);
		});
	}
});

describe("formatGrid helper", () => {
	const gridCases = [
		{ args: [1.27, "mm"], expected: "Grid: 1.27mm" },
		{ args: [0.25, "mm"], expected: "Grid: 0.25mm" },
		{ args: [0.05, "in"], expected: "Grid: 0.05in" },
		{ args: [], expected: "Grid: 1.27mm" },
	];

	for (const tc of gridCases) {
		test(`formats grid for ${tc.args.join(", ") || "defaults"}`, () => {
			assert.equal(formatGrid(...tc.args), tc.expected);
		});
	}
});

describe("formatProblemsStatus helper", () => {
	const problemCases = [
		{
			desc: "returns default tone and 0 problems for null/empty",
			input: null,
			expected: { text: "0 problems", tone: "default" },
		},
		{
			desc: "returns default tone when counts are 0",
			input: { counts: { error: 0, warning: 0 } },
			expected: { text: "0 problems", tone: "default" },
		},
		{
			desc: "formats single error with error tone",
			input: { counts: { error: 1, warning: 0 } },
			expected: { text: "1 error", tone: "error" },
		},
		{
			desc: "formats multiple errors with error tone",
			input: { counts: { error: 3, warning: 0 } },
			expected: { text: "3 errors", tone: "error" },
		},
		{
			desc: "formats single warning with warning tone",
			input: { counts: { error: 0, warning: 1 } },
			expected: { text: "1 warning", tone: "warning" },
		},
		{
			desc: "formats multiple warnings with warning tone",
			input: { counts: { error: 0, warning: 2 } },
			expected: { text: "2 warnings", tone: "warning" },
		},
		{
			desc: "formats both errors and warnings with error tone precedence",
			input: { counts: { error: 2, warning: 3 } },
			expected: { text: "2 errors, 3 warnings", tone: "error" },
		},
		{
			desc: "counts violations array directly",
			input: [
				{ severity: "error" },
				{ severity: "warning" },
				{ severity: "warning" },
			],
			expected: { text: "1 error, 2 warnings", tone: "error" },
		},
	];

	for (const tc of problemCases) {
		test(tc.desc, () => {
			const res = formatProblemsStatus(tc.input);
			assert.equal(res.text, tc.expected.text);
			assert.equal(res.tone, tc.expected.tone);
			assert.ok(res.tooltip.includes(tc.expected.text));
		});
	}
});

describe("handleSegmentKeyDown keyboard activation", () => {
	test("activates onClick and prevents default on Enter", () => {
		let clicked = false;
		let prevented = false;
		const event = {
			key: "Enter",
			preventDefault: () => {
				prevented = true;
			},
		};
		handleSegmentKeyDown(event, () => {
			clicked = true;
		});
		assert.ok(clicked, "Expected onClick to be called on Enter");
		assert.ok(prevented, "Expected preventDefault to be called on Enter");
	});

	test("activates onClick and prevents default on Space", () => {
		let clicked = false;
		let prevented = false;
		const event = {
			key: " ",
			preventDefault: () => {
				prevented = true;
			},
		};
		handleSegmentKeyDown(event, () => {
			clicked = true;
		});
		assert.ok(clicked, "Expected onClick to be called on Space");
		assert.ok(prevented, "Expected preventDefault to be called on Space");
	});

	test("ignores non-activation keys", () => {
		let clicked = false;
		const event = { key: "Tab", preventDefault: () => {} };
		handleSegmentKeyDown(event, () => {
			clicked = true;
		});
		assert.equal(clicked, false, "Expected onClick not to be called on Tab");
	});

	test("handles null event or non-function handler safely", () => {
		assert.doesNotThrow(() => handleSegmentKeyDown(null, () => {}));
		assert.doesNotThrow(() => handleSegmentKeyDown({ key: "Enter" }, null));
	});
});

describe("buildLeftSegments contract", () => {
	test("produces all four required segments with correct IDs", () => {
		const segments = buildLeftSegments(null);
		const ids = segments.map((s) => s.id);
		assert.deepEqual(ids, [
			"git-branch",
			"problems-status",
			"coordinates",
			"grid",
		]);
	});

	test("formats live coordinates and grid from options status", () => {
		const status = { x: 5.5, y: -10.2, grid: 2.54, units: "mm" };
		const segments = buildLeftSegments(null, { status });
		const coordsSeg = segments.find((s) => s.id === "coordinates");
		const gridSeg = segments.find((s) => s.id === "grid");

		assert.equal(coordsSeg?.text, "X: 5.50mm Y: -10.20mm");
		assert.equal(gridSeg?.text, "Grid: 2.54mm");
	});

	test("reflects problem count, tone, and onClick handler", () => {
		let toggled = false;
		const checksResult = { counts: { error: 2, warning: 1 } };
		const segments = buildLeftSegments(null, {
			checksResult,
			onToggleProblems: () => {
				toggled = true;
			},
		});
		const probSeg = segments.find((s) => s.id === "problems-status");

		assert.equal(probSeg?.text, "2 errors, 1 warning");
		assert.equal(probSeg?.tone, "error");
		assert.equal(typeof probSeg?.onClick, "function");
		probSeg?.onClick();
		assert.ok(toggled, "Expected onToggleProblems to be called");
	});

	test("reflects workspace branch or fallback when missing", () => {
		const wsWithBranch = {
			sidebarProps: {
				localProps: { repoInfo: { currentBranch: "feature-pcb" } },
			},
		};
		const segsWithBranch = buildLeftSegments(wsWithBranch);
		assert.equal(segsWithBranch[0].text, "feature-pcb");

		const segsWithout = buildLeftSegments({});
		assert.equal(segsWithout[0].text, "No repository");
	});
});

describe("buildRightSegments contract", () => {
	test("produces backend-status and units segments", () => {
		const segments = buildRightSegments(null);
		const ids = segments.map((s) => s.id);
		assert.deepEqual(ids, ["backend-status", "units"]);
	});

	test("maps healthy backend connectivity to success tone", () => {
		const wsHealthy = { shellProps: { backendStatus: "healthy" } };
		const segments = buildRightSegments(wsHealthy);
		const backendSeg = segments.find((s) => s.id === "backend-status");

		assert.equal(backendSeg?.text, "Backend OK");
		assert.equal(backendSeg?.tone, "success");
	});

	test("maps offline backend connectivity to error tone", () => {
		const wsOffline = { shellProps: { backendStatus: "offline" } };
		const segments = buildRightSegments(wsOffline);
		const backendSeg = segments.find((s) => s.id === "backend-status");

		assert.equal(backendSeg?.text, "Backend offline");
		assert.equal(backendSeg?.tone, "error");
	});

	test("reflects active units and onClick handler", () => {
		let cycled = false;
		const status = { units: "mil" };
		const segments = buildRightSegments(null, {
			status,
			onCycleUnits: () => {
				cycled = true;
			},
		});
		const unitsSeg = segments.find((s) => s.id === "units");

		assert.equal(unitsSeg?.text, "mil");
		assert.equal(unitsSeg?.tooltip, "Units: mil");
		unitsSeg?.onClick?.();
		assert.ok(cycled, "Expected onCycleUnits to be called");
	});
});

describe("IDE Problems panel and status bar integration contract", () => {
	test("IdeApp imports ChecksPanel and mounts it inside ProblemsPanel", () => {
		assert.ok(
			ideAppSrc.includes('import ChecksPanel from "../editor/ChecksPanel.jsx"'),
			"Expected IdeApp to import ChecksPanel",
		);
		assert.ok(
			ideAppSrc.includes("<ChecksPanel"),
			"Expected IdeApp to mount ChecksPanel",
		);
	});

	test("IdeApp connects editorStatus to StatusBar", () => {
		assert.ok(
			ideAppSrc.includes("editorStatus"),
			"Expected IdeApp to reference editorStatus",
		);
		assert.ok(
			ideAppSrc.includes("buildLeftSegments"),
			"Expected IdeApp to export buildLeftSegments",
		);
		assert.ok(
			ideAppSrc.includes("buildRightSegments"),
			"Expected IdeApp to export buildRightSegments",
		);
	});

	test("StatusBar supports keyboard navigation and aria-label", () => {
		assert.ok(
			statusBarSrc.includes("handleSegmentKeyDown"),
			"Expected StatusBar to include handleSegmentKeyDown",
		);
		assert.ok(
			statusBarSrc.includes("onKeyDown"),
			"Expected StatusBar to wire onKeyDown",
		);
		assert.ok(
			statusBarSrc.includes("aria-label"),
			"Expected StatusBar to set aria-label",
		);
	});
});
