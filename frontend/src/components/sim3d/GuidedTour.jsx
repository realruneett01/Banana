import { Button, Card, Space, Spin, Steps, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTour, stepVerdict, tourSummary } from "./tourModel.js";

const CARD_STYLE = {
	marginTop: 20,
	background: "#161b26",
	borderColor: "#28304c",
};

function VerdictTag({ verdict }) {
	if (!verdict) return null;
	const config = {
		survives: { color: "success", label: "Survives" },
		"stops working": { color: "warning", label: "Stops Working" },
		"gets damaged": { color: "error", label: "Gets Damaged" },
	}[verdict] || { color: "default", label: verdict };

	return (
		<Tag color={config.color} aria-label={`Verdict: ${config.label}`}>
			{config.label}
		</Tag>
	);
}

function StepResultView({ verdict, summary }) {
	if (!verdict) return null;
	return (
		<div
			style={{
				marginTop: 16,
				padding: 12,
				background: "#1f2430",
				borderRadius: 6,
			}}
			role="status"
			aria-live="polite"
		>
			<Space orientation="vertical" size={8} style={{ width: "100%" }}>
				<Space>
					<span style={{ fontWeight: 600 }}>Verdict:</span>
					<VerdictTag verdict={verdict.verdict} />
				</Space>
				<Typography.Paragraph style={{ margin: 0, color: "#cbd5e1" }}>
					{summary || verdict.text}
				</Typography.Paragraph>
			</Space>
		</div>
	);
}

function TourNavButtons({ onBack, onNext, backDisabled, nextLabel }) {
	return (
		<Space
			style={{
				marginTop: 20,
				justifyContent: "space-between",
				width: "100%",
			}}
		>
			<Button
				onClick={onBack}
				disabled={backDisabled}
				aria-label="Go to previous step"
			>
				Back
			</Button>
			<Button
				type="primary"
				onClick={onNext}
				aria-label={nextLabel || "Go to next step"}
			>
				{nextLabel || "Next"}
			</Button>
		</Space>
	);
}

function TipsList({ tips }) {
	return (
		<ul style={{ paddingLeft: 20, color: "#e2e8f0" }}>
			{tips.map((tip) => (
				<li key={tip} style={{ marginBottom: 8 }}>
					{tip}
				</li>
			))}
		</ul>
	);
}

function TourSummaryCard({ summary, onRestart, onBack }) {
	return (
		<Card
			title="Tour Summary: How Your Board Handled the Faults"
			style={CARD_STYLE}
		>
			<Typography.Title level={4} style={{ color: "#38bdf8", marginTop: 0 }}>
				{summary.score}
			</Typography.Title>
			<Typography.Paragraph style={{ color: "#94a3b8" }}>
				Here is what we learned from stressing your circuit:
			</Typography.Paragraph>
			<TipsList tips={summary.tips} />
			<Space style={{ marginTop: 16 }}>
				<Button onClick={onBack} aria-label="Go back to previous step">
					Back
				</Button>
				<Button
					type="primary"
					onClick={onRestart}
					aria-label="Restart guided tour"
				>
					Restart Tour
				</Button>
			</Space>
		</Card>
	);
}

function StepCardBody({ step, running, onRun, result, verdict }) {
	return (
		<>
			<Typography.Paragraph style={{ fontSize: 14, color: "#cbd5e1" }}>
				{step?.intro}
			</Typography.Paragraph>
			<Typography.Paragraph style={{ fontWeight: 600, color: "#93c5fd" }}>
				{step?.question}
			</Typography.Paragraph>
			<Button
				type="primary"
				onClick={onRun}
				loading={running}
				aria-label={`Run simulation for ${step?.title}`}
			>
				{running ? "Simulating..." : "Run this step"}
			</Button>
			<StepResultView
				verdict={verdict}
				summary={result?.explanation?.summary}
			/>
		</>
	);
}

function StepSection({ step, running, onRun, result, verdict, navProps }) {
	return (
		<Card title={step?.title} style={CARD_STYLE}>
			<StepCardBody
				step={step}
				running={running}
				onRun={onRun}
				result={result}
				verdict={verdict}
			/>
			<TourNavButtons {...navProps} />
		</Card>
	);
}

function TourContent({ isSummary, summary, onRestart, stepProps }) {
	if (isSummary) {
		return (
			<TourSummaryCard
				summary={summary}
				onRestart={onRestart}
				onBack={stepProps.navProps.onBack}
			/>
		);
	}
	return <StepSection {...stepProps} />;
}

const ALERT_LEVELS = new Set(["danger", "warning"]);

function collectCardPartIds(cards) {
	if (!Array.isArray(cards)) return [];
	const ids = [];
	for (const card of cards) {
		if (ALERT_LEVELS.has(card?.level)) {
			ids.push(...(card.partIds || []));
		}
	}
	return ids;
}

function highlightAffected(step, result, onHighlight) {
	if (typeof onHighlight !== "function") return;
	const partIds = new Set();
	if (step?.fault?.partId) partIds.add(step.fault.partId);
	for (const id of collectCardPartIds(result?.explanation?.cards)) {
		partIds.add(id);
	}
	onHighlight(Array.from(partIds));
}

function useTourSteps({ api, ir }) {
	const [faults, setFaults] = useState([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!api?.suggestFaults || !ir) {
			setFaults([]);
			return;
		}
		setLoading(true);
		const ctrl = new AbortController();
		api
			.suggestFaults({ ir }, { signal: ctrl.signal })
			.then((res) => {
				if (!ctrl.signal.aborted && res?.ok) {
					setFaults(res.data?.faults ?? []);
				}
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setLoading(false);
			});
		return () => ctrl.abort();
	}, [api, ir]);

	const steps = useMemo(() => buildTour(faults), [faults]);
	return { steps, loading };
}

async function executeStepSim({ api, ir, step, healthyRes }) {
	try {
		const res = await api.simulateCircuit({
			ir,
			fault: step.fault || undefined,
		});
		if (!res?.ok) {
			const text = res?.error || "Simulation could not complete.";
			return {
				result: null,
				verdict: { verdict: "stops working", text },
			};
		}
		const h = step.fault ? healthyRes : res.data;
		const v = stepVerdict(h, res.data);
		return {
			result: res.data,
			verdict: v,
			healthy: !step.fault ? res.data : healthyRes,
		};
	} catch (err) {
		const text = err?.message || "Simulation failed to execute.";
		return { result: null, verdict: { verdict: "stops working", text } };
	}
}

function useTourRunner({ api, ir, onHighlight }) {
	const [results, setResults] = useState({});
	const [verdicts, setVerdicts] = useState({});
	const [running, setRunning] = useState(false);
	const healthyRef = useRef(null);

	const runStep = useCallback(
		async (step) => {
			if (!api?.simulateCircuit || !ir || !step) return;
			setRunning(true);
			try {
				const out = await executeStepSim({
					api,
					ir,
					step,
					healthyRes: healthyRef.current,
				});
				if (out.healthy) healthyRef.current = out.healthy;
				setResults((prev) => ({ ...prev, [step.id]: out.result }));
				setVerdicts((prev) => ({ ...prev, [step.id]: out.verdict }));
				highlightAffected(step, out.result, onHighlight);
			} finally {
				setRunning(false);
			}
		},
		[api, ir, onHighlight],
	);

	return { results, verdicts, running, runStep };
}

function useTourHighlight({ steps, currIdx, isSummary, results, onHighlight }) {
	useEffect(() => {
		if (isSummary || !steps[currIdx]) {
			onHighlight?.([]);
			return;
		}
		const step = steps[currIdx];
		const res = results[step.id];
		highlightAffected(step, res, onHighlight);
	}, [currIdx, isSummary, steps, results, onHighlight]);
}

function buildStepItems(steps) {
	return [...steps.map((s) => ({ title: s.title })), { title: "Summary" }];
}

function buildNavProps(currIdx, totalSteps, setCurrIdx) {
	return {
		onBack: () => setCurrIdx((i) => Math.max(0, i - 1)),
		onNext: () => setCurrIdx((i) => i + 1),
		backDisabled: currIdx === 0,
		nextLabel: currIdx === totalSteps - 1 ? "View Summary" : "Next",
	};
}

function makeStepProps(currStep, runner, navProps) {
	return {
		step: currStep,
		running: runner.running,
		onRun: () => runner.runStep(currStep),
		result: runner.results[currStep?.id],
		verdict: runner.verdicts[currStep?.id],
		navProps,
	};
}

function useTourState({ api, ir, onHighlight }) {
	const { steps, loading } = useTourSteps({ api, ir });
	const runner = useTourRunner({ api, ir, onHighlight });
	const [currIdx, setCurrIdx] = useState(0);
	const summary = useMemo(
		() => tourSummary(Object.values(runner.verdicts)),
		[runner.verdicts],
	);
	const stepItems = useMemo(() => buildStepItems(steps), [steps]);
	const isSummary = currIdx >= steps.length;
	useTourHighlight({
		steps,
		currIdx,
		isSummary,
		results: runner.results,
		onHighlight,
	});
	return {
		steps,
		loading,
		runner,
		currIdx,
		setCurrIdx,
		summary,
		stepItems,
		isSummary,
	};
}

export default function GuidedTour({ api, ir, onHighlight }) {
	const state = useTourState({ api, ir, onHighlight });
	if (state.loading) return <Spin tip="Preparing guided tour..." />;

	const currStep = state.steps[state.currIdx];
	const navProps = buildNavProps(
		state.currIdx,
		state.steps.length,
		state.setCurrIdx,
	);
	const stepProps = makeStepProps(currStep, state.runner, navProps);

	return (
		<div style={{ padding: 16 }}>
			<Steps current={state.currIdx} items={state.stepItems} size="small" />
			<TourContent
				isSummary={state.isSummary}
				summary={state.summary}
				onRestart={() => state.setCurrIdx(0)}
				stepProps={stepProps}
			/>
		</div>
	);
}
