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

async function loadHelper(fileUrl, functionName) {
	try {
		const mod = await import(fileUrl.href);
		if (typeof mod[functionName] === "function") {
			return mod[functionName];
		}
	} catch {
		const source = readFileSync(fileUrl, "utf8");
		const regex = new RegExp(
			`export function ${functionName}\\s*\\([\\s\\S]*?\\n\\}`,
			"m",
		);
		const match = source.match(regex);
		if (!match) {
			throw new Error(
				`Symbol ${functionName} not found in ${fileUrl.pathname}`,
			);
		}
		const mod = await import(
			`data:text/javascript,${encodeURIComponent(match[0])}`
		);
		return mod[functionName];
	}
}

const activityButtonState = await loadHelper(
	activityBarUrl,
	"activityButtonState",
);
const segmentToneColor = await loadHelper(statusBarUrl, "segmentToneColor");

const activityBarSrc = readFileSync(activityBarUrl, "utf8");
const statusBarSrc = readFileSync(statusBarUrl, "utf8");

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
