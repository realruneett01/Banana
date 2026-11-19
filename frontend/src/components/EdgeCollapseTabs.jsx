import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";

const VERTICAL_CENTER_STYLE = {
	position: "absolute",
	top: "50%",
	transform: "translateY(-50%)",
};

const TAB_THEME = {
	background: "#161821",
	border: "1px solid #fadb14",
	color: "#fadb14",
};

const TAB_LAYOUT = {
	zIndex: 200,
	padding: "10px 5px",
	cursor: "pointer",
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "4px",
};

const SIDE_PROFILES = {
	left: {
		title: "Show Controls Panel",
		Icon: MenuUnfoldOutlined,
		label: "CONTROLS",
		edge: "left",
		borderRadius: "0 6px 6px 0",
		boxShadow: "2px 0 10px rgba(0,0,0,0.5)",
	},
	right: {
		title: "Show Audit Modifications Panel",
		Icon: MenuFoldOutlined,
		label: "AUDIT",
		edge: "right",
		borderRadius: "6px 0 0 6px",
		boxShadow: "-2px 0 10px rgba(0,0,0,0.5)",
	},
};

const ICON_STYLE = { fontSize: "14px" };

const LABEL_STYLE = {
	writingMode: "vertical-rl",
	fontSize: "10px",
	letterSpacing: "1px",
	fontWeight: 700,
};

function getEdgeSpecificStyle(edge, radius, shadow) {
	const borderProp = edge === "left" ? "borderLeft" : "borderRight";
	return {
		[edge]: 0,
		[borderProp]: "none",
		borderRadius: radius,
		boxShadow: shadow,
	};
}

function TabIcon({ Icon }) {
	return <Icon style={ICON_STYLE} />;
}

function TabLabel({ text }) {
	return <span style={LABEL_STYLE}>{text}</span>;
}

function CollapseTab({ side, onExpand }) {
	const profile = SIDE_PROFILES[side];
	const edgeStyle = getEdgeSpecificStyle(
		profile.edge,
		profile.borderRadius,
		profile.boxShadow,
	);
	const tabStyle = {
		...VERTICAL_CENTER_STYLE,
		...TAB_LAYOUT,
		...TAB_THEME,
		...edgeStyle,
		font: "inherit",
	};

	return (
		<button
			type="button"
			onClick={onExpand}
			title={profile.title}
			aria-label={profile.title}
			style={tabStyle}
		>
			<TabIcon Icon={profile.Icon} />
			<TabLabel text={profile.label} />
		</button>
	);
}

export function EdgeCollapseTabs({
	leftCollapsed,
	setLeftCollapsed,
	rightCollapsed,
	setRightCollapsed,
}) {
	const tabs = [
		{
			side: "left",
			show: leftCollapsed,
			onExpand: () => setLeftCollapsed(false),
		},
		{
			side: "right",
			show: rightCollapsed,
			onExpand: () => setRightCollapsed(false),
		},
	];

	return (
		<>
			{tabs.map(
				(tab) =>
					tab.show && (
						<CollapseTab
							key={tab.side}
							side={tab.side}
							onExpand={tab.onExpand}
						/>
					),
			)}
		</>
	);
}
