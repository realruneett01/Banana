import {
	AppstoreOutlined,
	BranchesOutlined,
	FolderOutlined,
	RobotOutlined,
	SearchOutlined,
	SettingOutlined,
	ThunderboltOutlined,
	UserOutlined,
} from "@ant-design/icons";
import {
	BAR_CONTAINER_BASE_STYLE,
	BASE_INTERACTIVE_STYLE,
	BarButton,
	BarIcon,
	formatTooltip,
} from "./barButton.jsx";

const makeBarItem = (id, label, icon, shortcut = "") => ({
	id,
	label,
	icon,
	shortcut,
});

const TOP_ITEM_SPECS = [
	["explorer", "Explorer", FolderOutlined, "Ctrl+Shift+E"],
	["search", "Search", SearchOutlined, "Ctrl+Shift+F"],
	["scm", "Source Control", BranchesOutlined, "Ctrl+Shift+G"],
	["library", "Library", AppstoreOutlined, "Ctrl+Shift+L"],
	["simulation", "Simulation", ThunderboltOutlined, "Ctrl+Shift+S"],
	["ai", "Banana AI Copilot", RobotOutlined, "Ctrl+Shift+A"],
];

const BOTTOM_ITEM_SPECS = [
	["accounts", "Accounts", UserOutlined, ""],
	["settings", "Settings", SettingOutlined, "Ctrl+,"],
];

export const DEFAULT_TOP_ITEMS = TOP_ITEM_SPECS.map(
	([id, label, icon, shortcut]) => makeBarItem(id, label, icon, shortcut),
);

export const DEFAULT_BOTTOM_ITEMS = BOTTOM_ITEM_SPECS.map(
	([id, label, icon, shortcut]) => makeBarItem(id, label, icon, shortcut),
);

export function activityButtonState(item, activeId, sidebarOpen) {
	const id = typeof item === "string" ? item : item?.id;
	const active = Boolean(sidebarOpen && activeId && id === activeId);
	const theme = active
		? {
				border: "2px solid var(--bn-color-brand, #f5c542)",
				color: "var(--bn-text-primary, #e6e8ee)",
			}
		: {
				border: "2px solid transparent",
				color: "var(--bn-text-muted, #5d6476)",
			};
	return {
		active,
		isActive: active,
		borderLeft: theme.border,
		color: theme.color,
	};
}

const ACTIVITY_BTN_STYLE = {
	...BASE_INTERACTIVE_STYLE,
	width: "100%",
	height: 48,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	fontSize: 18,
	padding: 0,
};

// Activity button with Tooltip, aria-label and badge via BarButton
function ActivityButton({ item, activeId, sidebarOpen, onSelect }) {
	const state = activityButtonState(item, activeId, sidebarOpen);
	const title = formatTooltip(item.label, item.shortcut);
	const btnStyle = {
		...ACTIVITY_BTN_STYLE,
		borderLeft: state.borderLeft,
		color: state.color,
	};
	return (
		<BarButton
			className={`bn-activity-btn${state.active ? " is-active" : ""}`}
			style={btnStyle}
			aria-label={item.label}
			aria-pressed={state.active}
			tooltip={title}
			tooltipPlacement="right"
			badge={item.badge}
			onClick={() => onSelect?.(item.id, item)}
		>
			<span style={{ color: state.color, display: "inline-flex" }}>
				<BarIcon icon={item.icon} size={18} />
			</span>
		</BarButton>
	);
}

const LIST_STYLE = {
	width: "100%",
	display: "flex",
	flexDirection: "column",
};

function ButtonList({ items, activeId, sidebarOpen, onSelect, className }) {
	return (
		<div className={className} style={LIST_STYLE}>
			{items.map((item) => (
				<ActivityButton
					key={item.id}
					item={item}
					activeId={activeId}
					sidebarOpen={sidebarOpen}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}

const BAR_NAV_STYLE = {
	...BAR_CONTAINER_BASE_STYLE,
	width: "var(--bn-activity-bar-w, 48px)",
	minWidth: "var(--bn-activity-bar-w, 48px)",
	height: "100%",
	flexDirection: "column",
	borderRight: "1px solid var(--bn-border-subtle, #232836)",
	padding: "4px 0",
};

export function ActivityBar({
	items = DEFAULT_TOP_ITEMS,
	activeId,
	sidebarOpen = false,
	onSelect,
	bottomItems = DEFAULT_BOTTOM_ITEMS,
	onBottomSelect,
}) {
	const handleBottomSelect = onBottomSelect || onSelect;
	return (
		<nav
			className="bn-activity-bar"
			aria-label="Activity Bar"
			style={BAR_NAV_STYLE}
		>
			<ButtonList
				className="bn-activity-bar-top"
				items={items}
				activeId={activeId}
				sidebarOpen={sidebarOpen}
				onSelect={onSelect}
			/>
			<ButtonList
				className="bn-activity-bar-bottom"
				items={bottomItems}
				activeId={activeId}
				sidebarOpen={sidebarOpen}
				onSelect={handleBottomSelect}
			/>
		</nav>
	);
}

export default ActivityBar;
