import { Button, Segmented, Slider, Tabs } from "antd";
import { useMemo, useState } from "react";
import { ENV_PRESETS } from "../envPresets.js";
import FixCard from "./FixCard.jsx";
import GuidedTour from "./GuidedTour.jsx";
import { formatTime } from "./transientModel.js";

const SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4]);

const FIELDSET_STYLE = Object.freeze({
	border: "none",
	padding: 0,
	margin: 0,
	display: "flex",
	flexDirection: "column",
	gap: "6px",
});

const LEGEND_STYLE = Object.freeze({
	fontSize: "12px",
	fontWeight: 700,
	color: "#e2e8f0",
	marginBottom: "4px",
});

const NUMBERS_PANEL_STYLE = Object.freeze({
	border: "1px solid #23283e",
	borderRadius: "6px",
	overflow: "hidden",
});

const NUMBERS_BTN_STYLE = Object.freeze({
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
});

const NUMBERS_BODY_STYLE = Object.freeze({
	padding: "10px",
	background: "#0d0f18",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
});

const NUMBERS_GRID_STYLE = Object.freeze({
	display: "grid",
	gridTemplateColumns: "1fr auto",
	gap: "4px 12px",
	fontSize: "11px",
	maxHeight: "100px",
	overflowY: "auto",
});

const SPEED_LABEL_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "6px",
	fontSize: "11px",
	color: "#94a3b8",
});

const SPEED_SELECT_STYLE = Object.freeze({
	background: "#181d2f",
	color: "#f1f5f9",
	border: "1px solid #28304c",
	borderRadius: "4px",
	padding: "4px 6px",
});

function formatVoltage(v) {
	if (typeof v !== "number" || Number.isNaN(v)) return "-";
	if (Math.abs(v) < 1 && v !== 0) return `${(v * 1000).toFixed(1)} mV`;
	return `${v.toFixed(2)} V`;
}

function formatCurrent(i) {
	if (typeof i !== "number" || Number.isNaN(i)) return "-";
	const mA = i * 1000;
	if (Math.abs(mA) < 1 && mA !== 0) return `${(mA * 1000).toFixed(1)} µA`;
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
				padding: "10px 14px",
				fontSize: "13px",
				fontWeight: 700,
				borderRadius: "6px",
				border: "none",
				cursor: running ? "not-allowed" : "pointer",
				background: running ? "#1e2438" : "#2563eb",
				color: "#ffffff",
			}}
		>
			{running ? "Simulating..." : "Run simulation"}
		</button>
	);
}

function getFaultCardStyle(isSelected) {
	return {
		textAlign: "left",
		padding: "8px 10px",
		borderRadius: "6px",
		border: isSelected ? "1px solid #fadb14" : "1px solid #23283e",
		background: isSelected
			? "rgba(250, 219, 20, 0.12)"
			: "rgba(22, 26, 42, 0.8)",
		cursor: "pointer",
		display: "flex",
		flexDirection: "column",
		gap: "2px",
		width: "100%",
	};
}

function FaultOptionCard({ title, subtitle, isSelected, onClick }) {
	return (
		<button
			type="button"
			aria-pressed={isSelected}
			onClick={onClick}
			style={getFaultCardStyle(isSelected)}
		>
			<span style={{ fontSize: "12px", fontWeight: 600, color: "#f1f5f9" }}>
				{title}
			</span>
			<span style={{ fontSize: "11px", color: "#94a3b8" }}>{subtitle}</span>
		</button>
	);
}

function HealthyFaultCard({ selectedFault, onSelectFault }) {
	return (
		<FaultOptionCard
			title="Healthy circuit [normal operation]"
			subtitle="All components operate as specified"
			isSelected={selectedFault === null}
			onClick={() => onSelectFault(null)}
		/>
	);
}

function InjectedFaultCard({ fault, index, selectedFault, onSelectFault }) {
	return (
		<FaultOptionCard
			key={fault.kind + (fault.netId || fault.partId || index)}
			title={fault.info?.label || fault.kind || "Fault"}
			subtitle={fault.info?.plainEnglish || "Simulate circuit failure"}
			isSelected={selectedFault === fault}
			onClick={() => onSelectFault(fault)}
		/>
	);
}

function FaultPicker({ faults = [], selectedFault, onSelectFault }) {
	return (
		<fieldset style={FIELDSET_STYLE}>
			<legend style={LEGEND_STYLE}>What if...? [test failure scenarios]</legend>
			<HealthyFaultCard
				selectedFault={selectedFault}
				onSelectFault={onSelectFault}
			/>
			{faults.map((f, i) => (
				<InjectedFaultCard
					key={f.kind + (f.netId || f.partId || i)}
					fault={f}
					index={i}
					selectedFault={selectedFault}
					onSelectFault={onSelectFault}
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
			badge: "Danger",
		};
	}
	if (level === "warning") {
		return {
			color: "#fbbf24",
			bg: "rgba(251, 191, 36, 0.12)",
			border: "#f59e0b",
			badge: "Warning",
		};
	}
	return {
		color: "#38bdf8",
		bg: "rgba(56, 189, 248, 0.12)",
		border: "#0284c7",
		badge: "Info",
	};
}

function ExplanationCardHeader({ title, badge, color }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
			}}
		>
			<span style={{ fontSize: "12px", fontWeight: 700, color }}>{title}</span>
			<span style={{ fontSize: "10px", fontWeight: 700, color }}>{badge}</span>
		</div>
	);
}

function getCardBtnStyle(theme, isSelected) {
	return {
		textAlign: "left",
		padding: "10px 12px",
		borderRadius: "6px",
		border: isSelected ? "2px solid #fadb14" : `1px solid ${theme.border}`,
		background: theme.bg,
		cursor: "pointer",
		display: "flex",
		flexDirection: "column",
		gap: "4px",
		width: "100%",
	};
}

function ExplanationCard({ card, isSelected, onSelect }) {
	const theme = getLevelTheme(card.level);
	return (
		<button
			type="button"
			aria-pressed={isSelected}
			onClick={() => onSelect(card)}
			style={getCardBtnStyle(theme, isSelected)}
		>
			<ExplanationCardHeader
				title={card.title}
				badge={theme.badge}
				color={theme.color}
			/>
			<div style={{ fontSize: "11px", color: "#e2e8f0", lineHeight: "1.4" }}>
				{card.text}
			</div>
		</button>
	);
}

function CardWithFixes({ card, isSelected, onSelect, fixes, onApplyFix }) {
	const cardFixes = (fixes || []).filter(
		(f) => f.forCardId === card.id || f.cardId === card.id,
	);
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
			<ExplanationCard
				card={card}
				isSelected={isSelected}
				onSelect={onSelect}
			/>
			{cardFixes.map((fix) => (
				<FixCard key={fix.id} fix={fix} onApply={onApplyFix} />
			))}
		</div>
	);
}

function ExplanationCardsList({
	cards,
	fixes,
	selectedCardId,
	onSelectCard,
	onApplyFix,
}) {
	if (!cards || cards.length === 0) return null;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
			{cards.map((c, i) => (
				<CardWithFixes
					key={c.id || c.title || i}
					card={c}
					isSelected={selectedCardId === c.id}
					onSelect={onSelectCard}
					fixes={fixes}
					onApplyFix={onApplyFix}
				/>
			))}
		</div>
	);
}

function SummaryAlert({ error }) {
	return (
		<div
			role="alert"
			style={{
				padding: "8px 10px",
				borderRadius: "6px",
				background: "rgba(244, 63, 94, 0.15)",
				border: "1px solid #f43f5e",
				color: "#fb7185",
				fontSize: "12px",
			}}
		>
			{error}
		</div>
	);
}

function ExplanationSummary({ summary, error }) {
	if (error) return <SummaryAlert error={error} />;
	const text = summary || "Ready to simulate [click Run simulation above]";
	return (
		<div
			aria-live="polite"
			style={{
				fontSize: "14px",
				fontWeight: 600,
				color: "#f1f5f9",
				lineHeight: "1.4",
			}}
		>
			{text}
		</div>
	);
}

function NumberRow({ name, val, formatter }) {
	return (
		<div style={{ display: "contents", fontFamily: "monospace" }}>
			<span style={{ color: "#cbd5e1" }}>{name}</span>
			<span style={{ color: "#38bdf8", textAlign: "right" }}>
				{formatter(val)}
			</span>
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
				<div style={NUMBERS_GRID_STYLE}>
					{entries.map(([name, val]) => (
						<NumberRow key={name} name={name} val={val} formatter={formatter} />
					))}
				</div>
			)}
		</div>
	);
}

function NumbersButton({ open, onToggle }) {
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			aria-controls="sim-numbers-content"
			style={NUMBERS_BTN_STYLE}
		>
			<span>Numbers [voltages & currents]</span>
			<span>{open ? "▲" : "▼"}</span>
		</button>
	);
}

function NumbersBody({ result }) {
	return (
		<div id="sim-numbers-content" style={NUMBERS_BODY_STYLE}>
			<NumbersTable
				title="Net voltages"
				data={result?.nodeVoltages}
				formatter={formatVoltage}
				emptyText="No voltages recorded"
			/>
			<NumbersTable
				title="Part currents"
				data={result?.partCurrents}
				formatter={formatCurrent}
				emptyText="No currents recorded"
			/>
		</div>
	);
}

function NumbersCollapsible({ result }) {
	const [open, setOpen] = useState(false);
	return (
		<div style={NUMBERS_PANEL_STYLE}>
			<NumbersButton open={open} onToggle={() => setOpen(!open)} />
			{open && <NumbersBody result={result} />}
		</div>
	);
}

function WhatHappensTab({ sim, selectedCardId, onSelectCard, onApplyFix }) {
	const fixes = sim?.result?.fixes || sim?.result?.explanation?.fixes || [];
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
			<RunSimButton status={sim?.status} onRun={sim?.run} />
			<FaultPicker
				faults={sim?.faults}
				selectedFault={sim?.selectedFault}
				onSelectFault={sim?.setFault}
			/>
			<ExplanationSummary
				summary={sim?.result?.explanation?.summary}
				error={sim?.error}
			/>
			<ExplanationCardsList
				cards={sim?.result?.explanation?.cards}
				fixes={fixes}
				selectedCardId={selectedCardId}
				onSelectCard={onSelectCard}
				onApplyFix={onApplyFix}
			/>
			<NumbersCollapsible result={sim?.result} />
		</div>
	);
}

function AnalysisModeSwitch({ mode, onChange }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
			<span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8" }}>
				Analysis Mode:
			</span>
			<Segmented
				block
				value={mode || "snapshot"}
				onChange={onChange}
				options={[
					{ label: "Snapshot [steady]", value: "snapshot" },
					{ label: "Over time [transient]", value: "over time" },
				]}
			/>
		</div>
	);
}

function PlayPauseButton({ playing, onTogglePlay }) {
	return (
		<Button
			type="primary"
			onClick={onTogglePlay}
			aria-label={
				playing ? "Pause simulation playback" : "Play simulation playback"
			}
			style={{ flex: 1, background: playing ? "#0284c7" : "#2563eb" }}
		>
			{playing ? "⏸ Pause" : "▶ Play"}
		</Button>
	);
}

function SpeedSelect({ speed, onChangeSpeed }) {
	return (
		<label style={SPEED_LABEL_STYLE}>
			Speed:
			<select
				aria-label="Playback speed"
				value={speed}
				onChange={(e) => onChangeSpeed(Number(e.target.value))}
				style={SPEED_SELECT_STYLE}
			>
				{SPEEDS.map((s) => (
					<option key={s} value={s}>
						{s}x
					</option>
				))}
			</select>
		</label>
	);
}

function PlayControls({ playing, onTogglePlay, speed, onChangeSpeed }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px",
			}}
		>
			<PlayPauseButton playing={playing} onTogglePlay={onTogglePlay} />
			<SpeedSelect speed={speed} onChangeSpeed={onChangeSpeed} />
		</div>
	);
}

function buildEventMarks(events) {
	const marks = {};
	for (const ev of events || []) {
		marks[ev.t] = {
			style: { color: "#38bdf8", fontSize: "10px" },
			label: "•",
		};
	}
	return marks;
}

function findActiveEvent(events, time) {
	if (!events || events.length === 0) return null;
	let active = null;
	for (const ev of events) {
		if (ev.t <= time) active = ev;
		else break;
	}
	return active;
}

function TimelineHeader({ time, duration }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				fontSize: "11px",
				color: "#94a3b8",
			}}
		>
			<span>Timeline [{formatTime(time)}]</span>
			<span>{formatTime(duration)}</span>
		</div>
	);
}

function ActiveEventStatus({ active }) {
	return (
		<div
			role="status"
			aria-live="polite"
			style={{
				padding: "8px 10px",
				borderRadius: "6px",
				background: "#141724",
				border: "1px solid #23283e",
				fontSize: "11px",
				color: active ? "#38bdf8" : "#94a3b8",
			}}
		>
			{active ? active.text : "No events at current timestamp"}
		</div>
	);
}

function TimelineSlider({ time, duration, events, onSeek }) {
	const marks = useMemo(() => buildEventMarks(events), [events]);
	const max = duration > 0 ? duration : 0.01;
	const active = useMemo(() => findActiveEvent(events, time), [events, time]);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
			<TimelineHeader time={time} duration={duration} />
			<Slider
				min={0}
				max={max}
				step={max / 1000}
				value={time || 0}
				onChange={onSeek}
				marks={marks}
				tooltip={{ formatter: (v) => formatTime(v) }}
				disabled={duration <= 0}
				aria-label="Playback timeline"
			/>
			<ActiveEventStatus active={active} />
		</div>
	);
}

function OverTimeTab({ sim }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
			<AnalysisModeSwitch
				mode={sim?.analysisMode}
				onChange={sim?.setAnalysisMode}
			/>
			<RunSimButton status={sim?.status} onRun={sim?.run} />
			<PlayControls
				playing={sim?.playing}
				onTogglePlay={() => sim?.setPlaying(!sim?.playing)}
				speed={sim?.speed}
				onChangeSpeed={sim?.setSpeed}
			/>
			<TimelineSlider
				time={sim?.time}
				duration={sim?.duration}
				events={sim?.events}
				onSeek={sim?.seek}
			/>
		</div>
	);
}

function getEnvCardStyle(isSelected) {
	return {
		textAlign: "left",
		padding: "8px 10px",
		borderRadius: "6px",
		border: isSelected ? "1px solid #38bdf8" : "1px solid #23283e",
		background: isSelected
			? "rgba(56, 189, 248, 0.15)"
			: "rgba(22, 26, 42, 0.8)",
		cursor: "pointer",
		display: "flex",
		flexDirection: "column",
		gap: "2px",
		width: "100%",
	};
}

function EnvPresetCard({ title, subtitle, isSelected, onClick }) {
	return (
		<button
			type="button"
			aria-pressed={isSelected}
			onClick={onClick}
			style={getEnvCardStyle(isSelected)}
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

function BenchtopPresetCard({ isSelected, onSelect }) {
	return (
		<EnvPresetCard
			title="Benchtop [lab default]"
			subtitle="Room temperature 25°C, standard indoor conditions"
			isSelected={isSelected}
			onClick={onSelect}
		/>
	);
}

function WhereItLivesTab({ env, onSelectEnv }) {
	return (
		<fieldset style={FIELDSET_STYLE}>
			<legend style={LEGEND_STYLE}>
				Operating environment [stress & conditions]
			</legend>
			<BenchtopPresetCard
				isSelected={!env}
				onSelect={() => onSelectEnv(null)}
			/>
			{ENV_PRESETS.map((preset) => (
				<EnvPresetCard
					key={preset.key}
					title={preset.label}
					subtitle={preset.description}
					isSelected={env?.name === preset.label}
					onClick={() => onSelectEnv(preset.env)}
				/>
			))}
		</fieldset>
	);
}

function WhatCouldGoWrongTab({ api, ir, onHighlight }) {
	return <GuidedTour api={api} ir={ir} onHighlight={onHighlight} />;
}

function makeMainTabs(props, sim) {
	const { selectedCardId, onSelectCard, onApplyFix } = props;
	return [
		{
			key: "what-happens",
			label: "What happens",
			children: (
				<WhatHappensTab
					sim={sim}
					selectedCardId={selectedCardId}
					onSelectCard={onSelectCard}
					onApplyFix={onApplyFix}
				/>
			),
		},
		{
			key: "over-time",
			label: "Over time",
			children: <OverTimeTab sim={sim} />,
		},
	];
}

function makeEnvAndTourTabs(props) {
	const { api, ir, env, onSelectEnv, onHighlight } = props;
	return [
		{
			key: "where-it-lives",
			label: "Where it lives",
			children: <WhereItLivesTab env={env} onSelectEnv={onSelectEnv} />,
		},
		{
			key: "what-could-go-wrong",
			label: "What could go wrong?",
			children: (
				<WhatCouldGoWrongTab api={api} ir={ir} onHighlight={onHighlight} />
			),
		},
	];
}

function buildSidePanelTabs(props, sim) {
	return [...makeMainTabs(props, sim), ...makeEnvAndTourTabs(props)];
}

export default function StudioSidePanel(props) {
	const sim = props.sim || props;
	const items = useMemo(() => buildSidePanelTabs(props, sim), [props, sim]);
	return (
		<div
			style={{
				width: "380px",
				minWidth: "320px",
				height: "100%",
				overflowY: "auto",
				padding: "14px",
				background: "#0f121d",
				borderLeft: "1px solid #1e2438",
			}}
		>
			<Tabs defaultActiveKey="what-happens" items={items} />
		</div>
	);
}
