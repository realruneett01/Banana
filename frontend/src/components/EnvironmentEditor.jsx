import { Button, Collapse, Form, Input, InputNumber, Select } from "antd";
import { useEffect, useState } from "react";
import { ENV_PRESETS, validateEnvDraft, withNewId } from "./envPresets.js";

const makeFlex = (direction, extra = {}) => ({
	display: "flex",
	flexDirection: direction,
	...extra,
});

const darkInput = {
	background: "#161821",
	borderColor: "#283250",
	color: "#f1f5f9",
	borderRadius: "6px",
};

const STYLES = Object.freeze({
	container: makeFlex("column", {
		width: "100%",
		height: "100%",
		background: "#0f121d",
		color: "#e2e8f0",
		overflow: "hidden",
	}),
	header: makeFlex("column", {
		padding: "12px 14px",
		borderBottom: "1px solid #1e2438",
		background: "#121520",
		gap: "8px",
		flexShrink: 0,
	}),
	headerTop: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
	},
	statusDot: {
		width: 8,
		height: 8,
		borderRadius: "50%",
		background: "#10b981",
		boxShadow: "0 0 8px #10b981",
		display: "inline-block",
	},
	titleText: {
		margin: 0,
		fontSize: "12px",
		fontWeight: 700,
		textTransform: "uppercase",
		letterSpacing: "0.06em",
		color: "#e2e8f0",
	},
	form: makeFlex("column", {
		flex: 1,
		overflowY: "auto",
		padding: "12px 14px",
		gap: "8px",
	}),
	row: {
		display: "flex",
		gap: "10px",
		width: "100%",
	},
	flexItem: {
		flex: 1,
		marginBottom: "10px",
	},
	item: {
		marginBottom: "10px",
		width: "100%",
	},
	input: darkInput,
	numberInput: {
		width: "100%",
		...darkInput,
	},
	collapse: {
		background: "rgba(22, 26, 42, 0.8)",
		border: "1px solid #23283e",
		borderRadius: "6px",
		marginBottom: "12px",
	},
	collapseLabel: {
		fontSize: "12px",
		fontWeight: 600,
		color: "#cbd5e1",
	},
	footer: {
		padding: "12px 14px",
		borderTop: "1px solid #1e2438",
		background: "#121520",
		display: "flex",
		alignItems: "center",
		justifyContent: "flex-end",
		flexShrink: 0,
	},
	saveBtn: {
		background: "#fadb14",
		borderColor: "#fadb14",
		color: "#0f1015",
		fontWeight: 700,
	},
});

const RANGE_CONFIGS = Object.freeze({
	ambient: Object.freeze({
		key: "ambientC",
		idPrefix: "ambient",
		label: "Ambient",
		unit: "°C",
	}),
	humidity: Object.freeze({
		key: "humidityPct",
		idPrefix: "humidity",
		label: "Humidity",
		unit: "%",
		min: 0,
		max: 100,
	}),
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
		<Form.Item label="Preset" htmlFor="env-preset-select" style={STYLES.item}>
			<Select
				id="env-preset-select"
				aria-label="Preset"
				placeholder="Load a preset..."
				options={options}
				onChange={onSelectPreset}
				style={STYLES.input}
			/>
		</Form.Item>
	);
}

function EditorHeader({ onSelectPreset }) {
	return (
		<header style={STYLES.header}>
			<div style={STYLES.headerTop}>
				<span style={STYLES.statusDot} />
				<h3 style={STYLES.titleText}>Environment Editor</h3>
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
			style={STYLES.item}
		>
			<Input
				id="env-name"
				aria-label="Name"
				value={name ?? ""}
				onChange={handleChange}
				placeholder="e.g. Automotive Cabin"
				style={STYLES.input}
			/>
		</Form.Item>
	);
}

function NumberField(props) {
	const { id, label, value, onChange, error, min, max, step } = props;
	return (
		<Form.Item
			label={label}
			htmlFor={id}
			validateStatus={error ? "error" : ""}
			help={error}
			style={STYLES.flexItem}
		>
			<InputNumber
				id={id}
				aria-label={label}
				value={value}
				onChange={onChange}
				min={min}
				max={max}
				step={step}
				style={STYLES.numberInput}
			/>
		</Form.Item>
	);
}

function FieldRow({ fields }) {
	return (
		<div style={STYLES.row}>
			{fields.map((f) => (
				<NumberField key={f.id} {...f} />
			))}
		</div>
	);
}

function MinMaxRow({ config, value, errors, onUpdate }) {
	const { key, idPrefix, label, unit, min, max } = config;
	const setBound = (bound, val) =>
		onUpdate({ [key]: { ...value, [bound]: val } });
	const fields = [
		{
			id: `${idPrefix}-min`,
			label: `${label} Min (${unit})`,
			value: value?.min,
			onChange: (v) => setBound("min", v),
			error: errors[`${key}.min`],
			min,
			max,
		},
		{
			id: `${idPrefix}-max`,
			label: `${label} Max (${unit})`,
			value: value?.max,
			onChange: (v) => setBound("max", v),
			error: errors[`${key}.max`] || errors[key],
			min,
			max,
		},
	];
	return <FieldRow fields={fields} />;
}

function AmbientFields({ ambientC, errors, onUpdate }) {
	return (
		<MinMaxRow
			config={RANGE_CONFIGS.ambient}
			value={ambientC}
			errors={errors}
			onUpdate={onUpdate}
		/>
	);
}

function HumidityFields({ humidityPct, errors, onUpdate }) {
	return (
		<MinMaxRow
			config={RANGE_CONFIGS.humidity}
			value={humidityPct}
			errors={errors}
			onUpdate={onUpdate}
		/>
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
	const fields = [
		{
			id: "altitude-m",
			label: "Altitude (m)",
			value: altitudeM,
			onChange: (v) => onUpdate({ altitudeM: v }),
			error: errors.altitudeM,
		},
		{
			id: "airflow-ms",
			label: "Airflow (m/s)",
			value: airflowMs,
			onChange: (v) => onUpdate({ airflowMs: v }),
			error: errors.airflowMs,
			min: 0,
		},
	];
	return <FieldRow fields={fields} />;
}

function VibrationPsdRow({ psdG2Hz, shockG, errors, onUpdate }) {
	const fields = [
		{
			id: "vib-psd",
			label: "PSD (g²/Hz)",
			value: psdG2Hz,
			onChange: (v) => onUpdate({ psdG2Hz: v }),
			error: errors["vibration.psdG2Hz"],
			min: 0,
			step: 0.01,
		},
		{
			id: "shock-g",
			label: "Shock (g)",
			value: shockG,
			onChange: (v) => onUpdate({ shockG: v }),
			error: errors.shockG,
			min: 0,
		},
	];
	return <FieldRow fields={fields} />;
}

function VibrationFreqRow({ fromHz, toHz, errors, onUpdate }) {
	const fields = [
		{
			id: "vib-from",
			label: "From Frequency (Hz)",
			value: fromHz,
			onChange: (v) => onUpdate({ fromHz: v }),
			error: errors["vibration.fromHz"],
			min: 0,
		},
		{
			id: "vib-to",
			label: "To Frequency (Hz)",
			value: toHz,
			onChange: (v) => onUpdate({ toHz: v }),
			error: errors["vibration.toHz"] || errors.vibration,
			min: 0,
		},
	];
	return <FieldRow fields={fields} />;
}

function VibrationInputs({ vibration, shockG, errors, onUpdate }) {
	const handlePsdRow = (patch) => {
		if (patch.shockG !== undefined) {
			onUpdate({ shockG: patch.shockG });
			return;
		}
		onUpdate({ vibration: { ...vibration, ...patch } });
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
			label: <span style={STYLES.collapseLabel}>Vibration and shock</span>,
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
	return <Collapse items={items} style={STYLES.collapse} />;
}

function EditorForm({ draft, errors, onUpdate }) {
	return (
		<Form layout="vertical" style={STYLES.form}>
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
		<footer style={STYLES.footer}>
			<Button
				type="primary"
				disabled={!isValid}
				onClick={onSave}
				style={STYLES.saveBtn}
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
		<section style={STYLES.container}>
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
