import { theme } from "antd";

const GOLD = "#f5c542";
const DARK_BG = "#0e1117";
const SURFACE_BG = "#161922";
const ELEVATED_BG = "#222736";
const ACTIVE_BG = "#2b3245";
const INPUT_BG = "#12141c";
const BORDER_DARK = "#2e354a";
const BORDER_MUTED = "#232838";
const TEXT_LIGHT = "#e6eaf2";
const TEXT_MUTED = "#9aa3b8";
const TEXT_FAINT = "#6c758d";

const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function makeComponentRules() {
	const none = "none";
	return {
		Layout: { bodyBg: DARK_BG, siderBg: SURFACE_BG, headerBg: SURFACE_BG },
		Button: { primaryShadow: none, defaultShadow: none, dangerShadow: none },
		Segmented: {
			trackBg: DARK_BG,
			itemSelectedBg: ACTIVE_BG,
			itemSelectedColor: GOLD,
		},
		Input: {
			activeShadow: "0 0 0 2px rgba(245, 197, 66, 0.15)",
			colorBgContainer: INPUT_BG,
		},
		Tabs: { cardHeight: 30 },
		Modal: {
			contentBg: ELEVATED_BG,
			headerBg: ELEVATED_BG,
			footerBg: ELEVATED_BG,
		},
		Drawer: { colorBgElevated: ELEVATED_BG },
		Table: {
			headerBg: SURFACE_BG,
			headerColor: TEXT_MUTED,
			borderColor: BORDER_MUTED,
			rowHoverBg: ACTIVE_BG,
			cellPaddingBlock: 6,
			cellPaddingInline: 8,
			cellPaddingBlockSM: 4,
			cellPaddingInlineSM: 6,
			fontSize: 12,
		},
	};
}

function makeColorTokens() {
	return {
		colorPrimary: GOLD,
		colorBgBase: DARK_BG,
		colorBgContainer: SURFACE_BG,
		colorBgElevated: ELEVATED_BG,
		colorBorder: BORDER_DARK,
		colorBorderSecondary: BORDER_MUTED,
		colorText: TEXT_LIGHT,
		colorTextSecondary: TEXT_MUTED,
		colorTextTertiary: TEXT_FAINT,
		colorTextLightSolid: DARK_BG,
		colorSuccess: "#34d399",
		colorWarning: "#fbbf24",
		colorError: "#f87171",
		colorInfo: "#38bdf8",
	};
}

function makeSizeTokens() {
	return {
		fontFamily: FONT_STACK,
		fontSize: 12,
		fontSizeSM: 11,
		fontSizeLG: 13,
		borderRadius: 4,
		borderRadiusSM: 3,
		borderRadiusLG: 6,
		controlHeight: 26,
		controlHeightSM: 22,
		controlHeightLG: 30,
	};
}

export const THEME_CONFIG = {
	algorithm: theme.darkAlgorithm,
	token: {
		...makeColorTokens(),
		...makeSizeTokens(),
	},
	components: makeComponentRules(),
};
