import { useCallback, useMemo, useState } from "react";
import BoardPreview from "../BoardPreview.jsx";
import Board3DScene from "./Board3DScene.jsx";
import { useCircuitSim } from "./useCircuitSim.js";

const SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4]);

function formatVoltage(v) {
	if (typeof v !== "number" || Number.isNaN(v)) return "-";
	if (Math.abs(v) < 1 && v !== 0) {
		return `${(v * 1000).toFixed(1)} mV`;
	}
	return `${v.toFixed(2)} V`;
}

function formatCurrent(i) {
	if (typeof i !== "number" || Number.isNaN(i)) return "-";
	const mA = i * 1000;
	if (Math.abs(mA) < 1 && mA !== 0) {
		return `${(mA * 1000).toFixed(1)} µA`;
	}
	return `${mA.toFixed(2)} mA`;
}

function RunSimButton({ status, onRun }) {
	const running = status === "running";
	return (
		<button
			type="button"
			onClick={onRun}
			disabled={running}
			aria-label="Run simulation [calculate circuit behavior]"
			style={{
				width: "100%",
				padding: "12px 14px",
				fontSize: "14px",
				fontWeight: 700,
				borderRadius: "6px",
				border: "none",
				cursor: running ? "not-allowed" : "pointer",
				background: running ? "#1e2438" : "#2563eb",
				color: "#ffffff",
			}}
		>
			{running
				? "Simulating... [calculating circuit physics]"
				: "Run simulation [calculate circuit behavior]"}
		</button>
	);
}

function PlaySpeedControls({ playing, onTogglePlay, speed, onChangeSpeed }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px",
			}}
		>
			<button
				type="button"
				onClick={onTogglePlay}
				aria-label={
					playing
						? "Pause flow animation [freeze current particles]"
						: "Play flow animation [show current particles]"
				}
				style={{
					flex: 1,
					padding: "6px 12px",
					fontSize: "12px",
					fontWeight: 600,
					borderRadius: "4px",
					border: "1px solid #28304c",
					background: playing ? "rgba(56, 189, 248, 0.15)" : "#181d2f",
					color: playing ? "#38bdf8" : "#f1f5f9",
					cursor: "pointer",
				}}
			>
				{playing ? "⏸ Pause [freeze flow]" : "▶ Play [start flow]"}
			</button>
			<label
				style={{
					display: "flex",
					alignItems: "center",
					gap: "6px",
					fontSize: "11px",
					color: "#94a3b8",
				}}
			>
				Speed [playback rate]:
				<select
					aria-label="Playback speed [rate of flow]"
					value={speed}
					onChange={(e) => onChangeSpeed(Number(e.target.value))}
					style={{
						background: "#181d2f",
						color: "#f1f5f9",
						border: "1px solid #28304c",
						borderRadius: "4px",
						padding: "4px 6px",
						fontSize: "11px",
					}}
				>
					{SPEEDS.map((s) => (
						<option key={s} value={s}>
							{s}x
						</option>
					))}
				</select>
			</label>
		</div>
	);
}

function FaultOptionCard({ title, subtitle, isSelected, onClick }) {
	const border = isSelected ? "1px solid #fadb14" : "1px solid #23283e";
	const bg = isSelected ? "rgba(250, 219, 20, 0.12)" : "rgba(22, 26, 42, 0.8)";
	return (
		<button
			type="button"
			aria-pressed={isSelected}
			onClick={onClick}
			style={{
				textAlign: "left",
				padding: "8px 10px",
				borderRadius: "6px",
				border,
				background: bg,
				cursor: "pointer",
				display: "flex",
				flexDirection: "column",
				gap: "2px",
			}}
		>
			<span
				style={{
					fontSize: "12px",
					fontWeight: 600,
					color: isSelected ? "#ffffff" : "#f1f5f9",
				}}
			>
				{title}
			</span>
			<span
				style={{
					fontSize: "11px",
					color: isSelected ? "#cbd5e1" : "#94a3b8",
				}}
			>
				{subtitle}
			</span>
		</button>
	);
}

function FaultPicker({ faults = [], selectedFault, onSelectFault }) {
	return (
		<fieldset
			style={{
				border: "none",
				padding: 0,
				margin: 0,
				display: "flex",
				flexDirection: "column",
				gap: "6px",
			}}
		>
			<legend
				style={{
					fontSize: "12px",
					fontWeight: 700,
					color: "#e2e8f0",
					marginBottom: "4px",
				}}
			>
				What if...? [test failure scenarios]
			</legend>
			<FaultOptionCard
				title="Healthy circuit [normal operation without faults]"
				subtitle="All components and connections operate as specified"
				isSelected={selectedFault === null}
				onClick={() => onSelectFault(null)}
			/>
			{faults.map((f, i) => (
				<FaultOptionCard
					key={f.kind + (f.netId || f.partId || i)}
					title={f.info?.label || f.kind || "Fault [failure condition]"}
					subtitle={f.info?.plainEnglish || "Simulate circuit failure"}
					isSelected={selectedFault === f}
					onClick={() => onSelectFault(f)}
				/>
			))}
		</fieldset>
	);
}

function getLevelTheme(level) {
	if (level === "danger" || level === "error") {
		return {
			color: "#fb7185",
			bg: "rgba(244, 63, 94, 0.12)",
			border: "#f43f5e",
			badge: "Danger [high risk]",
		};
	}
	if (level === "warning") {
		return {
			color: "#fbbf24",
			bg: "rgba(251, 191, 36, 0.12)",
			border: "#f59e0b",
			badge: "Warning [caution]",
		};
	}
	return {
		color: "#38bdf8",
		bg: "rgba(56, 189, 248, 0.12)",
		border: "#0284c7",
		badge: "Info [notice]",
	};
}

function ExplanationCard({ card, isSelected, onSelect }) {
	const theme = getLevelTheme(card.level);
	const activeBorder = isSelected
		? "2px solid #fadb14"
		: `1px solid ${theme.border}`;
	return (
		<button
			type="button"
			aria-pressed={isSelected}
			onClick={() => onSelect(card)}
			style={{
				textAlign: "left",
				padding: "10px 12px",
				borderRadius: "6px",
				border: activeBorder,
				background: theme.bg,
				cursor: "pointer",
				display: "flex",
				flexDirection: "column",
				gap: "4px",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<span style={{ fontSize: "12px", fontWeight: 700, color: theme.color }}>
					{card.title}
				</span>
				<span
					style={{
						fontSize: "10px",
						fontWeight: 700,
						color: theme.color,
					}}
				>
					{theme.badge}
				</span>
			</div>
			<div style={{ fontSize: "11px", color: "#e2e8f0", lineHeight: "1.4" }}>
				{card.text}
			</div>
		</button>
	);
}

function ExplanationSummary({ summary, error }) {
	if (error) {
		return (
			<div
				role="alert"
				style={{
					padding: "10px 12px",
					borderRadius: "6px",
					background: "rgba(244, 63, 94, 0.15)",
					border: "1px solid #f43f5e",
					color: "#fb7185",
					fontSize: "12px",
					lineHeight: "1.4",
				}}
			>
				{error}
			</div>
		);
	}
	const text =
		summary ||
		"Ready to simulate [click Run simulation above to check circuit]";
	return (
		<div
			aria-live="polite"
			style={{
				fontSize: "15px",
				fontWeight: 600,
				color: "#f1f5f9",
				lineHeight: "1.4",
			}}
		>
			{text}
		</div>
	);
}

function ExplanationCardsList({ cards, selectedCardId, onSelectCard }) {
	if (!cards || cards.length === 0) return null;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
			{cards.map((c, i) => (
				<ExplanationCard
					key={c.id || c.title || i}
					card={c}
					isSelected={selectedCardId === c.id}
					onSelect={onSelectCard}
				/>
			))}
		</div>
	);
}

function NumbersTable({ title, data, formatter, emptyText }) {
	const entries = Object.entries(data || {});
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
			<div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8" }}>
				{title}
			</div>
			{entries.length === 0 ? (
				<div style={{ fontSize: "11px", color: "#64748b" }}>{emptyText}</div>
			) : (
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr auto",
						gap: "4px 12px",
						fontSize: "11px",
						maxHeight: "120px",
						overflowY: "auto",
					}}
				>
					{entries.map(([name, val]) => (
						<div
							key={name}
							style={{ display: "contents", fontFamily: "monospace" }}
						>
							<span style={{ color: "#cbd5e1" }}>{name}</span>
							<span style={{ color: "#38bdf8", textAlign: "right" }}>
								{formatter(val)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function NumbersCollapsible({ result }) {
	const [open, setOpen] = useState(false);
	return (
		<div
			style={{
				border: "1px solid #23283e",
				borderRadius: "6px",
				overflow: "hidden",
			}}
		>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				aria-controls="sim-numbers-content"
				style={{
					width: "100%",
					padding: "8px 10px",
					background: "#141724",
					border: "none",
					color: "#cbd5e1",
					fontSize: "12px",
					fontWeight: 600,
					display: "flex",
					justifyContent: "space-between",
					cursor: "pointer",
				}}
			>
				<span>Numbers [voltages & currents]</span>
				<span>{open ? "▲" : "▼"}</span>
			</button>
			{open && (
				<div
					id="sim-numbers-content"
					style={{
						padding: "10px",
						background: "#0d0f18",
						display: "flex",
						flexDirection: "column",
						gap: "10px",
					}}
				>
					<NumbersTable
						title="Net voltages [electrical potential in Volts (V)]"
						data={result?.nodeVoltages}
						formatter={formatVoltage}
						emptyText="No voltages recorded"
					/>
					<NumbersTable
						title="Part currents [flow of charge in milliamperes (mA)]"
						data={result?.partCurrents}
						formatter={formatCurrent}
						emptyText="No currents recorded"
					/>
				</div>
			)}
		</div>
	);
}

function StudioStoryPanel({ sim, selectedCardId, onSelectCard }) {
	return (
		<div
			style={{
				width: "380px",
				minWidth: "320px",
				height: "100%",
				overflowY: "auto",
				display: "flex",
				flexDirection: "column",
				gap: "14px",
				padding: "14px",
				background: "#0f121d",
				borderLeft: "1px solid #1e2438",
			}}
		>
			<RunSimButton status={sim.status} onRun={sim.run} />
			<PlaySpeedControls
				playing={sim.playing}
				onTogglePlay={() => sim.setPlaying(!sim.playing)}
				speed={sim.speed}
				onChangeSpeed={sim.setSpeed}
			/>
			<FaultPicker
				faults={sim.faults}
				selectedFault={sim.selectedFault}
				onSelectFault={sim.setFault}
			/>
			<ExplanationSummary
				summary={sim.result?.explanation?.summary}
				error={sim.error}
			/>
			<ExplanationCardsList
				cards={sim.result?.explanation?.cards}
				selectedCardId={selectedCardId}
				onSelectCard={onSelectCard}
			/>
			<NumbersCollapsible result={sim.result} />
		</div>
	);
}

function ViewToggle({ viewMode, onToggle }) {
	return (
		<div
			style={{
				display: "flex",
				gap: "4px",
				marginBottom: "8px",
				alignSelf: "flex-start",
			}}
		>
			<button
				type="button"
				onClick={() => onToggle("3d")}
				aria-pressed={viewMode === "3d"}
				style={{
					padding: "4px 10px",
					fontSize: "12px",
					fontWeight: 600,
					borderRadius: "4px",
					border: "1px solid #28304c",
					background: viewMode === "3d" ? "rgba(56, 189, 248, 0.2)" : "#181d2f",
					color: viewMode === "3d" ? "#38bdf8" : "#94a3b8",
					cursor: "pointer",
				}}
			>
				3D
			</button>
			<button
				type="button"
				onClick={() => onToggle("2d")}
				aria-pressed={viewMode === "2d"}
				style={{
					padding: "4px 10px",
					fontSize: "12px",
					fontWeight: 600,
					borderRadius: "4px",
					border: "1px solid #28304c",
					background: viewMode === "2d" ? "rgba(56, 189, 248, 0.2)" : "#181d2f",
					color: viewMode === "2d" ? "#38bdf8" : "#94a3b8",
					cursor: "pointer",
				}}
			>
				2D
			</button>
		</div>
	);
}

function StudioBoardView({ ir, board, sim, selectedId, onSelect }) {
	const [viewMode, setViewMode] = useState("3d");
	return (
		<div
			style={{
				flex: 1,
				minWidth: "320px",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				padding: "12px",
			}}
		>
			<ViewToggle viewMode={viewMode} onToggle={setViewMode} />
			{viewMode === "3d" ? (
				<Board3DScene
					ir={ir}
					board={board}
					result={sim?.result}
					fault={sim?.selectedFault}
					playing={sim?.playing}
					speed={sim?.speed}
					highlightIds={selectedId ? [selectedId] : []}
				/>
			) : (
				<BoardPreview ir={ir} selectedId={selectedId} onSelect={onSelect} />
			)}
		</div>
	);
}

function resolveHighlightId(selectedPartId, selectedCard) {
	if (selectedPartId) return selectedPartId;
	if (!selectedCard) return null;
	return selectedCard.partIds?.[0] || selectedCard.netIds?.[0] || null;
}

export default function SimulationStudio({ api, ir, board }) {
	const sim = useCircuitSim({ api, ir });
	const [selectedCard, setSelectedCard] = useState(null);
	const [selectedPartId, setSelectedPartId] = useState(null);

	const handleCardSelect = useCallback((card) => {
		setSelectedCard((prev) => (prev?.id === card?.id ? null : card));
		setSelectedPartId(null);
	}, []);

	const highlightId = useMemo(
		() => resolveHighlightId(selectedPartId, selectedCard),
		[selectedPartId, selectedCard],
	);

	return (
		<div
			style={{
				display: "flex",
				width: "100%",
				height: "100%",
				minHeight: "500px",
				background: "#0a0c14",
				overflow: "hidden",
			}}
		>
			<StudioBoardView
				ir={ir}
				board={board}
				sim={sim}
				selectedId={highlightId}
				onSelect={setSelectedPartId}
			/>
			<StudioStoryPanel
				sim={sim}
				selectedCardId={selectedCard?.id}
				onSelectCard={handleCardSelect}
			/>
		</div>
	);
}
