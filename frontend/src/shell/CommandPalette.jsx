import { useEffect, useMemo, useRef, useState } from "react";

export { nextTabId } from "./EditorTabs.jsx";

// --- Pure palette helpers ---
const WORD_BOUNDARIES = new Set([" ", "-", "_", "/", "."]);

function isWordBoundary(prev, curr) {
	if (WORD_BOUNDARIES.has(prev)) {
		return true;
	}
	return /[a-z]/.test(prev) && /[A-Z]/.test(curr);
}

function isWordStart(text, index) {
	if (index === 0) {
		return true;
	}
	return isWordBoundary(text[index - 1], text[index]);
}

function scorePosition(text, matchIdx, lastMatchIdx) {
	let score = 10;
	if (matchIdx === lastMatchIdx + 1) {
		score += 15;
	}
	if (isWordStart(text, matchIdx)) {
		score += 20;
	}
	return score;
}

export function fuzzyScore(query, text) {
	if (typeof query !== "string" || typeof text !== "string") {
		return null;
	}
	if (query === "") {
		return 0;
	}
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	let score = t === q ? 50 : 0;
	let tIdx = 0;
	let lastMatchIdx = -2;

	for (let i = 0; i < q.length; i++) {
		const matchIdx = t.indexOf(q[i], tIdx);
		if (matchIdx === -1) {
			return null;
		}
		score += scorePosition(text, matchIdx, lastMatchIdx);
		lastMatchIdx = matchIdx;
		tIdx = matchIdx + 1;
	}
	return score - (t.length - q.length);
}

function scoreCommand(cmd, query) {
	const title = cmd?.title || "";
	const sTitle = fuzzyScore(query, title);
	const full = cmd?.category ? `${cmd.category} ${title}` : title;
	const sFull = fuzzyScore(query, full);
	if (sTitle === null && sFull === null) {
		return null;
	}
	const bonus = sTitle !== null ? 10 : 0;
	const best = Math.max(sTitle ?? -1e6, sFull ?? -1e6);
	return best + bonus;
}

export function rankCommands(commands, query) {
	if (!Array.isArray(commands)) {
		return [];
	}
	const trimmed = typeof query === "string" ? query.trim() : "";
	if (!trimmed) {
		return [...commands];
	}
	const scored = [];
	for (const cmd of commands) {
		const score = scoreCommand(cmd, trimmed);
		if (score !== null) {
			scored.push({ cmd, score });
		}
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.map((item) => item.cmd);
}
// --- End pure palette helpers ---

const FONT_BODY = "var(--bn-type-body, 12px)";
const FONT_STATUS = "var(--bn-type-status, 11px)";
const BORDER_SUBTLE = "1px solid var(--bn-border-subtle, #232836)";
const TEXT_MUTED = "var(--bn-text-muted, #5d6476)";

const BACKDROP_STYLE = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	zIndex: 1000,
	display: "flex",
	justifyContent: "center",
	alignItems: "flex-start",
	paddingTop: "60px",
	background: "rgba(0, 0, 0, 0.5)",
};

const PALETTE_BOX_STYLE = {
	width: "600px",
	maxWidth: "calc(100vw - 32px)",
	background: "var(--bn-bg-elevated, #1f2430)",
	border: "1px solid var(--bn-border-base, #2f3546)",
	borderRadius: "6px",
	boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
};

const INPUT_STYLE = {
	width: "100%",
	height: "36px",
	padding: "0 12px",
	background: "var(--bn-bg-editor, #1e1e1e)",
	color: "var(--bn-text-primary, #e6e8ee)",
	border: "none",
	borderBottom: BORDER_SUBTLE,
	outline: "none",
	fontSize: FONT_BODY,
	boxSizing: "border-box",
};

const LIST_STYLE = {
	maxHeight: "360px",
	overflowY: "auto",
	margin: 0,
	padding: "4px 0",
	outline: "none",
};

const EMPTY_STYLE = {
	padding: "16px",
	textAlign: "center",
	color: TEXT_MUTED,
	fontSize: FONT_BODY,
};

const BASE_ROW_STYLE = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "6px 12px",
	cursor: "pointer",
	fontSize: FONT_BODY,
	userSelect: "none",
	boxSizing: "border-box",
	outline: "none",
};

const RIGHT_CONTENT_STYLE = {
	display: "inline-flex",
	alignItems: "center",
	gap: "8px",
	flexShrink: 0,
	marginLeft: "12px",
};

const CATEGORY_STYLE = {
	fontSize: FONT_STATUS,
	color: TEXT_MUTED,
};

const SHORTCUT_STYLE = {
	fontSize: FONT_STATUS,
	color: "var(--bn-text-secondary, #8a91a3)",
	background: "var(--bn-bg-surface, #12151c)",
	border: BORDER_SUBTLE,
	borderRadius: "3px",
	padding: "1px 5px",
	fontFamily: "inherit",
};

const TITLE_STYLE = {
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	flex: 1,
};

function getRowStyle(isSelected) {
	return {
		...BASE_ROW_STYLE,
		background: isSelected ? "var(--bn-bg-active, #2a2e3d)" : "transparent",
		borderLeft: isSelected
			? "2px solid var(--bn-color-brand, #f5c542)"
			: "2px solid transparent",
		color: isSelected
			? "var(--bn-text-primary, #e6e8ee)"
			: "var(--bn-text-secondary, #8a91a3)",
	};
}

function handleRun(cmd, onClose) {
	cmd?.run?.();
	onClose?.();
}

function CommandPaletteRow(props) {
	const { cmd, index, selectedIndex, onSelect, onRun } = props;
	const isSelected = index === selectedIndex;
	const rowStyle = getRowStyle(isSelected);

	const handleRowKeyDown = (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onRun(cmd);
		}
	};

	return (
		<div
			role="option"
			tabIndex={-1}
			aria-selected={isSelected}
			style={rowStyle}
			onClick={() => onRun(cmd)}
			onKeyDown={handleRowKeyDown}
			onMouseEnter={() => onSelect(index)}
		>
			<span style={TITLE_STYLE}>{cmd.title}</span>
			<span style={RIGHT_CONTENT_STYLE}>
				{cmd.category && <span style={CATEGORY_STYLE}>{cmd.category}</span>}
				{cmd.shortcut && <kbd style={SHORTCUT_STYLE}>{cmd.shortcut}</kbd>}
			</span>
		</div>
	);
}

function stepSelection(prev, step, count) {
	if (count <= 0) return 0;
	if (step > 0) return (prev + 1) % count;
	return prev <= 0 ? count - 1 : prev - 1;
}

function runSelection(list, index, onClose) {
	const target = list[index];
	if (target) {
		target.run?.();
		onClose?.();
	}
}

function handleKeyDown(e, ctx) {
	const { filteredCommands, selectedIndex, setSelectedIndex, onClose } = ctx;
	if (e.key === "Escape") {
		e.preventDefault();
		onClose?.();
	} else if (e.key === "ArrowDown") {
		e.preventDefault();
		setSelectedIndex((p) => stepSelection(p, 1, filteredCommands.length));
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		setSelectedIndex((p) => stepSelection(p, -1, filteredCommands.length));
	} else if (e.key === "Enter") {
		e.preventDefault();
		runSelection(filteredCommands, selectedIndex, onClose);
	}
}

function CommandList({ filtered, selectedIndex, onSelect, onRun }) {
	if (filtered.length === 0) {
		return (
			<div role="listbox" tabIndex={-1} style={LIST_STYLE}>
				<div style={EMPTY_STYLE}>No matching commands</div>
			</div>
		);
	}
	return (
		<div role="listbox" tabIndex={-1} style={LIST_STYLE}>
			{filtered.map((cmd, idx) => (
				<CommandPaletteRow
					key={cmd.id ?? cmd.title}
					cmd={cmd}
					index={idx}
					selectedIndex={selectedIndex}
					onSelect={onSelect}
					onRun={onRun}
				/>
			))}
		</div>
	);
}

function PaletteOverlay({ onClose, children }) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Command Palette"
			tabIndex={-1}
			style={BACKDROP_STYLE}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose?.();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose?.();
			}}
		>
			<div style={PALETTE_BOX_STYLE}>{children}</div>
		</div>
	);
}

function usePaletteState(open, commands) {
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef(null);

	useEffect(() => {
		if (open) {
			setQuery("");
			setSelectedIndex(0);
			inputRef.current?.focus();
		}
	}, [open]);

	const filtered = useMemo(
		() => rankCommands(commands, query).slice(0, 12),
		[commands, query],
	);

	useEffect(() => {
		if (selectedIndex >= filtered.length) {
			setSelectedIndex(0);
		}
	}, [filtered.length, selectedIndex]);

	return {
		query,
		setQuery,
		selectedIndex,
		setSelectedIndex,
		inputRef,
		filtered,
	};
}

export function CommandPalette(props) {
	const {
		open,
		commands = [],
		onClose,
		placeholder = "Type a command or search...",
	} = props;
	const state = usePaletteState(open, commands);

	if (!open) {
		return null;
	}

	const onInputKeyDown = (e) => {
		handleKeyDown(e, {
			filteredCommands: state.filtered,
			selectedIndex: state.selectedIndex,
			setSelectedIndex: state.setSelectedIndex,
			onClose,
		});
	};

	return (
		<PaletteOverlay onClose={onClose}>
			<input
				ref={state.inputRef}
				type="text"
				value={state.query}
				placeholder={placeholder}
				style={INPUT_STYLE}
				onChange={(e) => state.setQuery(e.target.value)}
				onKeyDown={onInputKeyDown}
			/>
			<CommandList
				filtered={state.filtered}
				selectedIndex={state.selectedIndex}
				onSelect={state.setSelectedIndex}
				onRun={(c) => handleRun(c, onClose)}
			/>
		</PaletteOverlay>
	);
}

export default CommandPalette;
