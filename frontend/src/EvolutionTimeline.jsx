import {
	ArrowRightOutlined,
	BranchesOutlined,
	CaretRightOutlined,
	CloseOutlined,
	PauseOutlined,
	StepBackwardOutlined,
	StepForwardOutlined,
} from "@ant-design/icons";
import { Button, Segmented, Tag, Tooltip } from "antd";

const EVOLUTION_CONTAINER_STYLE = Object.freeze({
	position: "absolute",
	bottom: "16px",
	left: "20px",
	right: "20px",
	zIndex: 40,
	backgroundColor: "rgba(15, 23, 42, 0.94)",
	backdropFilter: "blur(12px)",
	WebkitBackdropFilter: "blur(12px)",
	border: "1px solid rgba(59, 130, 246, 0.35)",
	borderRadius: "12px",
	boxShadow:
		"0 12px 32px rgba(0, 0, 0, 0.55), 0 0 16px rgba(59, 130, 246, 0.2)",
	padding: "12px 18px",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
	userSelect: "none",
	transition: "all 0.25s ease-in-out",
});

const EVOLUTION_TAG_STYLE = Object.freeze({
	display: "inline-flex",
	alignItems: "center",
	gap: "6px",
	padding: "3px 10px",
	borderRadius: "6px",
	fontWeight: 700,
	fontSize: "11px",
	letterSpacing: "0.04em",
	background: "rgba(59, 130, 246, 0.2)",
	borderColor: "rgba(59, 130, 246, 0.4)",
	color: "#60a5fa",
	margin: 0,
});

const COMMIT_SUMMARY_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "6px",
	fontSize: "12px",
	color: "#cbd5e1",
	fontFamily: "monospace",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
});

const COMMIT_MESSAGE_STYLE = Object.freeze({
	color: "#e2e8f0",
	fontWeight: 500,
	maxWidth: "380px",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

const CLOSE_BTN_STYLE = Object.freeze({
	background: "rgba(239, 68, 68, 0.15)",
	border: "1px solid rgba(239, 68, 68, 0.3)",
	color: "#f87171",
	borderRadius: "6px",
	width: "24px",
	height: "24px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	cursor: "pointer",
	fontSize: "11px",
	transition: "all 0.15s",
});

const SEGMENTED_OPTIONS = Object.freeze([
	{ label: "Step Delta", value: "step" },
	{ label: "Cumulative", value: "cumulative" },
]);

const SEGMENTED_STYLE = Object.freeze({
	backgroundColor: "rgba(30, 41, 59, 0.8)",
	color: "#cbd5e1",
	border: "1px solid rgba(51, 65, 85, 0.6)",
});

const HEADER_CONTAINER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "12px",
});

const HEADER_INFO_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "10px",
	minWidth: 0,
});

const HEADER_CONTROLS_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "10px",
	flexShrink: 0,
});

const NODE_STYLES = Object.freeze({
	target: {
		size: "22px",
		bg: "#10b981",
		border: "3px solid #f8fafc",
		boxShadow: "0 0 12px #10b981, 0 0 4px #10b981",
		textColor: "#34d399",
		fontWeight: 700,
	},
	past: {
		size: "16px",
		bg: "#3b82f6",
		border: "2px solid #60a5fa",
		boxShadow: "0 0 6px rgba(59, 130, 246, 0.4)",
		textColor: "#93c5fd",
		fontWeight: 500,
	},
	future: {
		size: "16px",
		bg: "#1e293b",
		border: "2px solid #475569",
		boxShadow: "none",
		textColor: "#64748b",
		fontWeight: 500,
	},
});

const TARGET_DOT_STYLE = Object.freeze({
	width: "6px",
	height: "6px",
	borderRadius: "50%",
	backgroundColor: "#ffffff",
});

const TRACK_CONTAINER_STYLE = Object.freeze({
	position: "relative",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "6px 8px",
	marginTop: "2px",
});

const TRACK_BASE_STYLE = Object.freeze({
	position: "absolute",
	left: "20px",
	top: "50%",
	height: "3px",
	transform: "translateY(-50%)",
});

const TRANSPORT_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "8px",
	paddingTop: "2px",
});

function getCommitHash(commit) {
	return commit?.shortHash || commit?.hash?.substring(0, 7) || "";
}

function isActivationKey(key) {
	return key === "Enter" || key === " ";
}

function handleCloseHover(e, bg) {
	e.currentTarget.style.background = bg;
}

function handleNodeKey(e, idx, onStepChange) {
	if (!isActivationKey(e.key)) return;
	if (idx > 0 && onStepChange) {
		e.preventDefault();
		onStepChange(idx - 1);
	}
}

function calcProgressPct(activeStep, totalSteps) {
	if (totalSteps <= 0) return 0;
	return (activeStep / (totalSteps - 1 || 1)) * 95;
}

function stepBackward(activeStep, onStepChange) {
	if (activeStep > 0) onStepChange?.(activeStep - 1);
}

function stepForward(activeStep, totalSteps, onStepChange) {
	if (activeStep < totalSteps - 1) onStepChange?.(activeStep + 1);
}

function getNodeContainerStyle(isClickable) {
	return {
		position: "relative",
		zIndex: 3,
		cursor: isClickable ? "pointer" : "default",
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: "4px",
	};
}

function EvolutionPathTag() {
	return (
		<Tag color="processing" style={EVOLUTION_TAG_STYLE}>
			<BranchesOutlined /> EVOLUTION PATH
		</Tag>
	);
}

function EvolutionStepCounter({ activeStep, totalSteps }) {
	return (
		<span
			style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "monospace" }}
		>
			Step <strong style={{ color: "#f8fafc" }}>{activeStep + 1}</strong> of{" "}
			<strong style={{ color: "#f8fafc" }}>{totalSteps}</strong>
		</span>
	);
}

function EvolutionCommitSummary({ currentBase, currentTarget }) {
	const baseHash = getCommitHash(currentBase);
	const targetHash = getCommitHash(currentTarget);
	return (
		<div style={COMMIT_SUMMARY_STYLE}>
			<span style={{ color: "#f43f5e", fontWeight: 600 }}>{baseHash}</span>
			<ArrowRightOutlined style={{ fontSize: "10px", color: "#64748b" }} />
			<span style={{ color: "#10b981", fontWeight: 600 }}>{targetHash}</span>
			<span style={{ color: "#64748b" }}>•</span>
			<span style={COMMIT_MESSAGE_STYLE} title={currentTarget?.message}>
				"{currentTarget?.message}"
			</span>
		</div>
	);
}

function EvolutionCloseButton({ onClose }) {
	if (!onClose) return null;
	return (
		<Tooltip title="Exit History Evolution (Return to Direct Snapshot Diff)">
			<button
				type="button"
				onClick={onClose}
				style={CLOSE_BTN_STYLE}
				onMouseEnter={(e) => handleCloseHover(e, "rgba(239, 68, 68, 0.3)")}
				onMouseLeave={(e) => handleCloseHover(e, "rgba(239, 68, 68, 0.15)")}
			>
				<CloseOutlined />
			</button>
		</Tooltip>
	);
}

function EvolutionHeaderControls({ mode, onModeChange, onClose }) {
	return (
		<div style={HEADER_CONTROLS_STYLE}>
			{onModeChange && (
				<Segmented
					size="small"
					value={mode}
					onChange={onModeChange}
					options={SEGMENTED_OPTIONS}
					style={SEGMENTED_STYLE}
				/>
			)}
			<EvolutionCloseButton onClose={onClose} />
		</div>
	);
}

function EvolutionHeaderSummary(props) {
	const { activeStep, totalSteps, currentBase, currentTarget } = props;
	return (
		<div style={HEADER_INFO_STYLE}>
			<EvolutionPathTag />
			<EvolutionStepCounter activeStep={activeStep} totalSteps={totalSteps} />
			<EvolutionCommitSummary
				currentBase={currentBase}
				currentTarget={currentTarget}
			/>
		</div>
	);
}

function EvolutionHeader(props) {
	return (
		<div style={HEADER_CONTAINER_STYLE}>
			<EvolutionHeaderSummary {...props} />
			<EvolutionHeaderControls
				mode={props.mode}
				onModeChange={props.onModeChange}
				onClose={props.onClose}
			/>
		</div>
	);
}

function CommitNodeTooltipContent({ commit, idx }) {
	const shortHash = getCommitHash(commit);
	const label = idx === 0 ? "Start: " : `Commit ${idx}: `;
	return (
		<div>
			<div style={{ fontWeight: 700, color: "#f8fafc", marginBottom: "2px" }}>
				{label}
				{commit.message}
			</div>
			<div style={{ fontSize: "11px", color: "#94a3b8" }}>
				Hash:{" "}
				<span style={{ fontFamily: "monospace", color: "#38bdf8" }}>
					{shortHash}
				</span>
			</div>
			{commit.author && (
				<div style={{ fontSize: "11px", color: "#94a3b8" }}>
					Author: {commit.author}
				</div>
			)}
			{commit.date && (
				<div style={{ fontSize: "10px", color: "#64748b" }}>{commit.date}</div>
			)}
		</div>
	);
}

function resolveNodeStyles(isStepTarget, isPast) {
	if (isStepTarget) return NODE_STYLES.target;
	if (isPast) return NODE_STYLES.past;
	return NODE_STYLES.future;
}

function NodeCircle({ styles, isStepTarget }) {
	return (
		<div
			style={{
				width: styles.size,
				height: styles.size,
				borderRadius: "50%",
				backgroundColor: styles.bg,
				border: styles.border,
				boxShadow: styles.boxShadow,
				transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{isStepTarget && <div style={TARGET_DOT_STYLE} />}
		</div>
	);
}

function NodeHashLabel({ shortHash, styles }) {
	return (
		<span
			style={{
				fontSize: "10px",
				fontFamily: "monospace",
				fontWeight: styles.fontWeight,
				color: styles.textColor,
				marginTop: "2px",
				transition: "color 0.15s",
			}}
		>
			{shortHash}
		</span>
	);
}

function EvolutionNode(props) {
	const { commit, idx, isStepTarget, isPast, onStepChange } = props;
	const styles = resolveNodeStyles(isStepTarget, isPast);
	const shortHash = getCommitHash(commit);
	const isClickable = idx > 0;

	return (
		<Tooltip
			key={commit.hash || idx}
			title={<CommitNodeTooltipContent commit={commit} idx={idx} />}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: complex node layout */}
			<div
				role="button"
				tabIndex={isClickable ? 0 : -1}
				onClick={() => isClickable && onStepChange?.(idx - 1)}
				onKeyDown={(e) => handleNodeKey(e, idx, onStepChange)}
				style={getNodeContainerStyle(isClickable)}
			>
				<NodeCircle styles={styles} isStepTarget={isStepTarget} />
				<NodeHashLabel shortHash={shortHash} styles={styles} />
			</div>
		</Tooltip>
	);
}

function TrackBackground({ progressPct }) {
	return (
		<>
			<div
				style={{
					...TRACK_BASE_STYLE,
					right: "20px",
					backgroundColor: "#334155",
					zIndex: 1,
				}}
			/>
			<div
				style={{
					...TRACK_BASE_STYLE,
					width: `${progressPct}%`,
					background: "linear-gradient(90deg, #3b82f6, #10b981)",
					zIndex: 2,
					transition: "width 0.3s ease-out",
				}}
			/>
		</>
	);
}

function EvolutionTrack({ commits, activeStep, totalSteps, onStepChange }) {
	const progressPct = calcProgressPct(activeStep, totalSteps);

	return (
		<div style={TRACK_CONTAINER_STYLE}>
			<TrackBackground progressPct={progressPct} />
			{commits.map((commit, idx) => (
				<EvolutionNode
					key={commit.hash || idx}
					commit={commit}
					idx={idx}
					isStepTarget={idx === activeStep + 1}
					isPast={idx <= activeStep}
					onStepChange={onStepChange}
				/>
			))}
		</div>
	);
}

function NavStepButton({ icon, label, disabled, onClick }) {
	return (
		<Button
			size="small"
			icon={icon}
			onClick={onClick}
			disabled={disabled}
			style={{
				backgroundColor: "#1e293b",
				borderColor: "#334155",
				color: disabled ? "#475569" : "#e2e8f0",
				borderRadius: "6px",
			}}
		>
			{label}
		</Button>
	);
}

function PrevStepButton({ activeStep, isLoading, onClick }) {
	return (
		<NavStepButton
			icon={<StepBackwardOutlined />}
			label="Previous Step"
			disabled={activeStep === 0 || isLoading}
			onClick={onClick}
		/>
	);
}

function PlayToggleButton({ isPlaying, isLoading, onClick }) {
	const btnColor = isPlaying ? "#f59e0b" : "#3b82f6";
	return (
		<Button
			type="primary"
			size="small"
			icon={isPlaying ? <PauseOutlined /> : <CaretRightOutlined />}
			onClick={onClick}
			loading={isLoading}
			style={{
				backgroundColor: btnColor,
				borderColor: btnColor,
				borderRadius: "6px",
				minWidth: "95px",
				fontWeight: 600,
			}}
		>
			{isPlaying ? "Pause" : "Auto Play"}
		</Button>
	);
}

function NextStepButton({ isEnd, isLoading, onClick }) {
	return (
		<NavStepButton
			icon={<StepForwardOutlined />}
			label="Next Step"
			disabled={isEnd || isLoading}
			onClick={onClick}
		/>
	);
}

function EvolutionTransport(props) {
	const isEnd = props.activeStep >= props.totalSteps - 1;

	return (
		<div style={TRANSPORT_STYLE}>
			<PrevStepButton
				activeStep={props.activeStep}
				isLoading={props.isLoading}
				onClick={props.handlePrev}
			/>
			<PlayToggleButton
				isPlaying={props.isPlaying}
				isLoading={props.isLoading}
				onClick={props.onTogglePlay}
			/>
			<NextStepButton
				isEnd={isEnd}
				isLoading={props.isLoading}
				onClick={props.handleNext}
			/>
		</div>
	);
}

function resolveTimelineEndpoints(commits, activeStep, isCumulative) {
	const currentBase = isCumulative ? commits[0] : commits[activeStep];
	const currentTarget = commits[activeStep + 1] || commits[commits.length - 1];
	return { currentBase, currentTarget };
}

function resolveTimelineState(props) {
	const activeStep = props.activeStep ?? 0;
	const mode = props.mode ?? "step";
	const endpoints = resolveTimelineEndpoints(
		props.commits,
		activeStep,
		mode === "cumulative",
	);

	return {
		activeStep,
		totalSteps: props.commits.length - 1,
		mode,
		isPlaying: props.isPlaying ?? false,
		isLoading: props.isLoading ?? false,
		...endpoints,
	};
}

export default function EvolutionTimeline(props) {
	if (!props.commits || props.commits.length < 2) return null;
	const state = resolveTimelineState(props);
	const { activeStep, totalSteps } = state;
	const { onStepChange } = props;

	return (
		<div style={EVOLUTION_CONTAINER_STYLE}>
			<EvolutionHeader {...props} {...state} />
			<EvolutionTrack
				commits={props.commits}
				activeStep={activeStep}
				totalSteps={totalSteps}
				onStepChange={onStepChange}
			/>
			<EvolutionTransport
				{...props}
				{...state}
				handlePrev={() => stepBackward(activeStep, onStepChange)}
				handleNext={() => stepForward(activeStep, totalSteps, onStepChange)}
			/>
		</div>
	);
}
