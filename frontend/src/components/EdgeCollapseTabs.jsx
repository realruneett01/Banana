import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";

const BASE_STYLE_DECLARATIONS =
	"position:absolute|top:50%|transform:translateY(-50%)|zIndex:200|background:#161821|border:1px solid #fadb14|padding:10px 5px|cursor:pointer|display:flex|flexDirection:column|alignItems:center|gap:4px|color:#fadb14";

const BASE_STYLE = BASE_STYLE_DECLARATIONS.split("|").reduce((acc, entry) => {
	const [prop, val] = entry.split(":");
	acc[prop] = prop === "zIndex" ? Number(val) : val;
	return acc;
}, {});

function getTabStyle(isLeft) {
	const sideStyle = isLeft
		? {
				left: 0,
				borderLeft: "none",
				borderRadius: "0 6px 6px 0",
				boxShadow: "2px 0 10px rgba(0,0,0,0.5)",
			}
		: {
				right: 0,
				borderRight: "none",
				borderRadius: "6px 0 0 6px",
				boxShadow: "-2px 0 10px rgba(0,0,0,0.5)",
			};

	return {
		...BASE_STYLE,
		...sideStyle,
	};
}

function createTabConfig(side) {
	const isLeft = side === "left";
	return {
		title: isLeft ? "Show Controls Panel" : "Show Audit Modifications Panel",
		Icon: isLeft ? MenuUnfoldOutlined : MenuFoldOutlined,
		label: isLeft ? "CONTROLS" : "AUDIT",
		style: getTabStyle(isLeft),
	};
}

const TAB_CONFIGS = {
	left: createTabConfig("left"),
	right: createTabConfig("right"),
};

const ICON_STYLE = { fontSize: "14px" };

const LABEL_STYLE = {
	writingMode: "vertical-rl",
	fontSize: "10px",
	letterSpacing: "1px",
	fontWeight: 700,
};

function CollapseTab({ side, onExpand }) {
	const config = TAB_CONFIGS[side];
	const Icon = config.Icon;

	return (
		<button
			type="button"
			onClick={onExpand}
			title={config.title}
			aria-label={config.title}
			style={{ ...config.style, font: "inherit" }}
		>
			<Icon style={ICON_STYLE} />
			<span style={LABEL_STYLE}>{config.label}</span>
		</button>
	);
}

export function EdgeCollapseTabs({
	leftCollapsed,
	setLeftCollapsed,
	rightCollapsed,
	setRightCollapsed,
}) {
	return (
		<>
			{leftCollapsed && (
				<CollapseTab side="left" onExpand={() => setLeftCollapsed(false)} />
			)}
			{rightCollapsed && (
				<CollapseTab side="right" onExpand={() => setRightCollapsed(false)} />
			)}
		</>
	);
}
