import { Button, Collapse, Form, Input, InputNumber, Select } from "antd";
import { useEffect, useState } from "react";
import { ENV_PRESETS, validateEnvDraft, withNewId } from "./envPresets.js";

const CONTAINER_STYLE = Object.freeze({
	width: "100%",
	height: "100%",
	background: "#0f121d",
	color: "#e2e8f0",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
});

const HEADER_STYLE = Object.freeze({
	padding: "12px 14px",
	borderBottom: "1px solid #1e2438",
	background: "#121520",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
	flexShrink: 0,
});

const HEADER_TOP_ROW_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "8px",
});

const STATUS_DOT_STYLE = Object.freeze({
	width: 8,
	height: 8,
	borderRadius: "50%",
	background: "#10b981",
	boxShadow: "0 0 8px #10b981",
	display: "inline-block",
});

const TITLE_TEXT_STYLE = Object.freeze({
	margin: 0,
	fontSize: "12px",
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.06em",
	color: "#e2e8f0",
});

const FORM_CONTAINER_STYLE = Object.freeze({
	flex: 1,
	overflowY: "auto",
	padding: "12px 14px",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
});

const ROW_STYLE = Object.freeze({
	display: "flex",
	gap: "10px",
	width: "100%",
});

const FLEX_ITEM_STYLE = Object.freeze({
	flex: 1,
	marginBottom: "10px",
});

const ITEM_STYLE = Object.freeze({
	marginBottom: "10px",
	width: "100%",
});

const INPUT_STYLE = Object.freeze({
	background: "#161821",
	borderColor: "#283250",
	color: "#f1f5f9",
	borderRadius: "6px",
});

const NUMBER_INPUT_STYLE = Object.freeze({
	width: "100%",
	background: "#161821",
	borderColor: "#283250",
	color: "#f1f5f9",
	borderRadius: "6px",
});

const COLLAPSE_STYLE = Object.freeze({
	background: "rgba(22, 26, 42, 0.8)",
	border: "1px solid #23283e",
	borderRadius: "6px",
	marginBottom: "12px",
});

const COLLAPSE_LABEL_STYLE = Object.freeze({
	fontSize: "12px",
	fontWeight: 600,
	color: "#cbd5e1",
});

const FOOTER_STYLE = Object.freeze({
	padding: "12px 14px",
	borderTop: "1px solid #1e2438",
	background: "#121520",
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-end",
	flexShrink: 0,
});

const SAVE_BTN_STYLE = Object.freeze({
	background: "#fadb14",
	borderColor: "#fadb14",
	color: "#0f1015",
	fontWeight: 700,
});

function useDraftState(value) {
	const [draft, setDraft] = useState(() => value ?? ENV_PRESETS[0].env);
	useEffect(() => {
		if (value) {
			setDraft(value);
		}
	}, [value]);
	return [draft, setDraft];
}

function PresetPicker({ onSelectPreset }) {
	const options = ENV_PRESETS.map((p) => ({
		value: p.key,
		label: `${p.label} - ${p.description}`,
	}));
	return (
		<Form.Item label="Preset" htmlFor="env-preset-select" style={ITEM_STYLE}>
			<Select
				id="env-preset-select"
				aria-label="Preset"
				placeholder="Load a preset..."
				options={options}
				onChange={onSelectPreset}
				style={INPUT_STYLE}
			/>
		</Form.Item>
	);
}

function EditorHeader({ onSelectPreset }) {
	return (
		<header style={HEADER_STYLE}>
			<div style={HEADER_TOP_ROW_STYLE}>
				<span style={STATUS_DOT_STYLE} />
				<h3 style={TITLE_TEXT_STYLE}>Environment Editor</h3>
			</div>
			<PresetPicker onSelectPreset={onSelectPreset} />
		</header>
	);
}

function NameField({ name, error, onUpdate }) {
	const handleChange = (e) => onUpdate({ name: e.target.value });
	return (
		<Form.Item
			label="Name"
			htmlFor="env-name"
			validateStatus={error ? "error" : ""}
			help={error}
			style={ITEM_STYLE}
		>
			<Input
				id="env-name"
				aria-label="Name"
				value={name ?? ""}
				onChange={handleChange}
				placeholder="e.g. Automotive Cabin"
				style={INPUT_STYLE}
			/>
		</Form.Item>
	);
}

function NumberField({ id, label, value, onChange, error, min, max, step }) {
	return (
		<Form.Item
			label={label}
			htmlFor={id}
			validateStatus={error ? "error" : ""}
			help={error}
			style={FLEX_ITEM_STYLE}
		>
			<InputNumber
				id={id}
				aria-label={label}
				value={value}
				onChange={onChange}
				min={min}
				max={max}
				step={step}
				style={NUMBER_INPUT_STYLE}
			/>
		</Form.Item>
	);
}

function AmbientFields({ ambientC, errors, onUpdate }) {
	const setMin = (min) => onUpdate({ ambientC: { ...ambientC, min } });
	const setMax = (max) => onUpdate({ ambientC: { ...ambientC, max } });
	return (
		<div style={ROW_STYLE}>
			<NumberField
				id="ambient-min"
				label="Ambient Min (°C)"
				value={ambientC?.min}
				onChange={setMin}
				error={errors["ambientC.min"]}
			/>
			<NumberField
				id="ambient-max"
				label="Ambient Max (°C)"
				value={ambientC?.max}
				onChange={setMax}
				error={errors["ambientC.max"] || errors.ambientC}
			/>
		</div>
	);
}

function HumidityFields({ humidityPct, errors, onUpdate }) {
	const setMin = (min) => onUpdate({ humidityPct: { ...humidityPct, min } });
	const setMax = (max) => onUpdate({ humidityPct: { ...humidityPct, max } });
	return (
		<div style={ROW_STYLE}>
			<NumberField
				id="humidity-min"
				label="Humidity Min (%)"
				value={humidityPct?.min}
				onChange={setMin}
				error={errors["humidityPct.min"]}
				min={0}
				max={100}
			/>
			<NumberField
				id="humidity-max"
				label="Humidity Max (%)"
				value={humidityPct?.max}
				onChange={setMax}
				error={errors["humidityPct.max"] || errors.humidityPct}
				min={0}
				max={100}
			/>
		</div>
	);
}

function RangeFields({ draft, errors, onUpdate }) {
	return (
		<>
			<AmbientFields
				ambientC={draft.ambientC}
				errors={errors}
				onUpdate={onUpdate}
			/>
			<HumidityFields
				humidityPct={draft.humidityPct}
				errors={errors}
				onUpdate={onUpdate}
			/>
		</>
	);
}

function GeneralFields({ altitudeM, airflowMs, errors, onUpdate }) {
	return (
		<div style={ROW_STYLE}>
			<NumberField
				id="altitude-m"
				label="Altitude (m)"
				value={altitudeM}
				onChange={(v) => onUpdate({ altitudeM: v })}
				error={errors.altitudeM}
			/>
			<NumberField
				id="airflow-ms"
				label="Airflow (m/s)"
				value={airflowMs}
				onChange={(v) => onUpdate({ airflowMs: v })}
				error={errors.airflowMs}
				min={0}
			/>
		</div>
	);
}

function VibrationPsdRow({ psdG2Hz, shockG, errors, onUpdate }) {
	const handlePsd = (v) => onUpdate({ psdG2Hz: v });
	const handleShock = (v) => onUpdate({ shockG: v });
	return (
		<div style={ROW_STYLE}>
			<NumberField
				id="vib-psd"
				label="PSD (g²/Hz)"
				value={psdG2Hz}
				onChange={handlePsd}
				error={errors["vibration.psdG2Hz"]}
				min={0}
				step={0.01}
			/>
			<NumberField
				id="shock-g"
				label="Shock (g)"
				value={shockG}
				onChange={handleShock}
				error={errors.shockG}
				min={0}
			/>
		</div>
	);
}

function VibrationFreqRow({ fromHz, toHz, errors, onUpdate }) {
	const toErr = errors["vibration.toHz"] || errors.vibration;
	return (
		<div style={ROW_STYLE}>
			<NumberField
				id="vib-from"
				label="From Frequency (Hz)"
				value={fromHz}
				onChange={(v) => onUpdate({ fromHz: v })}
				error={errors["vibration.fromHz"]}
				min={0}
			/>
			<NumberField
				id="vib-to"
				label="To Frequency (Hz)"
				value={toHz}
				onChange={(v) => onUpdate({ toHz: v })}
				error={toErr}
				min={0}
			/>
		</div>
	);
}

function VibrationInputs({ vibration, shockG, errors, onUpdate }) {
	const handlePsdRow = (patch) => {
		if (patch.shockG !== undefined) {
			onUpdate({ shockG: patch.shockG });
		} else {
			onUpdate({ vibration: { ...vibration, ...patch } });
		}
	};
	const handleFreqRow = (patch) =>
		onUpdate({ vibration: { ...vibration, ...patch } });
	return (
		<div>
			<VibrationPsdRow
				psdG2Hz={vibration?.psdG2Hz}
				shockG={shockG}
				errors={errors}
				onUpdate={handlePsdRow}
			/>
			<VibrationFreqRow
				fromHz={vibration?.fromHz}
				toHz={vibration?.toHz}
				errors={errors}
				onUpdate={handleFreqRow}
			/>
		</div>
	);
}

function VibrationSection({ vibration, shockG, errors, onUpdate }) {
	const items = [
		{
			key: "vib-shock",
			label: <span style={COLLAPSE_LABEL_STYLE}>Vibration and shock</span>,
			children: (
				<VibrationInputs
					vibration={vibration}
					shockG={shockG}
					errors={errors}
					onUpdate={onUpdate}
				/>
			),
		},
	];
	return <Collapse items={items} style={COLLAPSE_STYLE} />;
}

function EditorForm({ draft, errors, onUpdate }) {
	return (
		<Form layout="vertical" style={FORM_CONTAINER_STYLE}>
			<NameField name={draft.name} error={errors.name} onUpdate={onUpdate} />
			<RangeFields draft={draft} errors={errors} onUpdate={onUpdate} />
			<GeneralFields
				altitudeM={draft.altitudeM}
				airflowMs={draft.airflowMs}
				errors={errors}
				onUpdate={onUpdate}
			/>
			<VibrationSection
				vibration={draft.vibration}
				shockG={draft.shockG}
				errors={errors}
				onUpdate={onUpdate}
			/>
		</Form>
	);
}

function EditorFooter({ isValid, onSave }) {
	return (
		<footer style={FOOTER_STYLE}>
			<Button
				type="primary"
				disabled={!isValid}
				onClick={onSave}
				style={SAVE_BTN_STYLE}
				aria-label="Save Environment"
			>
				Save Environment
			</Button>
		</footer>
	);
}

function useEditorController({ value, onChange, onSave, newId }) {
	const [draft, setDraft] = useDraftState(value);
	const validation = validateEnvDraft(draft);

	const updateDraft = (patch) => {
		const next = { ...draft, ...patch };
		setDraft(next);
		onChange?.(next);
	};
	const handlePreset = (key) => {
		const p = ENV_PRESETS.find((item) => item.key === key);
		if (p) {
			updateDraft(p.env);
		}
	};
	const handleSave = () => {
		if (validation.ok) {
			onSave?.(withNewId(draft, newId));
		}
	};
	return { draft, validation, updateDraft, handlePreset, handleSave };
}

export default function EnvironmentEditor(props) {
	const { draft, validation, updateDraft, handlePreset, handleSave } =
		useEditorController(props);
	return (
		<section style={CONTAINER_STYLE}>
			<EditorHeader onSelectPreset={handlePreset} />
			<EditorForm
				draft={draft}
				errors={validation.errors}
				onUpdate={updateDraft}
			/>
			<EditorFooter isValid={validation.ok} onSave={handleSave} />
		</section>
	);
}
