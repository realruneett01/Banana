import { Badge, Tooltip } from "antd";
import { isValidElement } from "react";

export function BarIcon({ icon, size = 16, style }) {
	if (!icon) return null;
	if (isValidElement(icon)) return icon;
	const Component = icon;
	return <Component style={{ fontSize: size, ...style }} />;
}

export function BarBadge({ badge, children }) {
	if (typeof badge === "number" && badge > 0) {
		return (
			<Badge count={badge} size="small" overflowCount={99}>
				{children}
			</Badge>
		);
	}
	return children;
}

export function formatTooltip(label, shortcut) {
	return shortcut ? `${label} (${shortcut})` : label;
}

export function handleBarKeyDown(event, onClick) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		onClick?.(event);
	}
}

export function resolveAriaLabel(item) {
	if (!item) return undefined;
	return (
		item["aria-label"] || item.label || item.text || item.tooltip || item.id
	);
}

export const BASE_INTERACTIVE_STYLE = {
	border: "none",
	outline: "none",
	boxSizing: "border-box",
	userSelect: "none",
	fontFamily: "inherit",
	background: "transparent",
};

export const BAR_CONTAINER_BASE_STYLE = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	background: "var(--bn-bg-surface, #12151c)",
	boxSizing: "border-box",
	userSelect: "none",
};

function ButtonElement({
	as = "button",
	type,
	className,
	style,
	ariaLabel,
	ariaPressed,
	onClick,
	onKeyDown,
	children,
}) {
	const Comp = as;
	const isBtn = as === "button";
	return (
		<Comp
			type={type || (isBtn ? "button" : undefined)}
			className={className}
			style={style}
			aria-label={ariaLabel}
			aria-pressed={ariaPressed}
			onClick={onClick}
			onKeyDown={onKeyDown}
		>
			{children}
		</Comp>
	);
}

export function BarButton(props) {
	const {
		as = "button",
		type,
		className = "",
		style,
		badge,
		tooltip,
		tooltipPlacement = "top",
		onClick,
		onKeyDown,
		children,
	} = props;
	const content = <BarBadge badge={badge}>{children}</BarBadge>;
	const elem = (
		<ButtonElement
			as={as}
			type={type}
			className={className}
			style={style}
			ariaLabel={props["aria-label"] || props.ariaLabel}
			ariaPressed={props["aria-pressed"] ?? props.ariaPressed}
			onClick={onClick}
			onKeyDown={onKeyDown}
		>
			{content}
		</ButtonElement>
	);
	if (tooltip) {
		return (
			<Tooltip title={tooltip} placement={tooltipPlacement}>
				{elem}
			</Tooltip>
		);
	}
	return elem;
}

export default BarButton;
