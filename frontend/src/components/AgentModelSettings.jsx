import { Button, Form, Input, Select } from "antd";
import { useEffect, useState } from "react";

const PROVIDER_OPTIONS = Object.freeze([
	{ label: "Gemini", value: "gemini" },
	{ label: "Claude", value: "claude" },
	{ label: "Local - Ollama", value: "ollama" },
]);

const MODEL_STORAGE_KEY = "banana.agentModel";
const KEY_PREFIX = "banana.agentKey.";

const NOTE_STYLE = Object.freeze({
	color: "#94a3b8",
	fontSize: "12px",
	marginBottom: "16px",
});

function parseJsonSafe(raw) {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function readAgentModel() {
	let raw = null;
	try {
		raw = localStorage.getItem(MODEL_STORAGE_KEY);
	} catch {
		return { provider: "gemini", model: "" };
	}
	const parsed = parseJsonSafe(raw);
	if (!parsed || typeof parsed !== "object") {
		return { provider: "gemini", model: "" };
	}
	const provider = parsed.provider || "gemini";
	const defaultModel = provider === "ollama" ? "qwen2.5:7b" : "";
	const model = typeof parsed.model === "string" ? parsed.model : defaultModel;
	return { provider, model };
}

export function writeAgentModel({ provider, model }) {
	try {
		const payload = JSON.stringify({ provider, model });
		localStorage.setItem(MODEL_STORAGE_KEY, payload);
	} catch {
		// Ignore storage errors
	}
}

export function readAgentApiKey(provider) {
	if (!provider || provider === "ollama") {
		return "";
	}
	try {
		return localStorage.getItem(`${KEY_PREFIX}${provider}`) || "";
	} catch {
		return "";
	}
}

export function writeAgentApiKey(provider, key) {
	if (!provider || provider === "ollama") {
		return;
	}
	try {
		if (key) {
			localStorage.setItem(`${KEY_PREFIX}${provider}`, key);
		} else {
			localStorage.removeItem(`${KEY_PREFIX}${provider}`);
		}
	} catch {
		// Ignore storage errors
	}
}

function resolveModelOnProviderSwitch(nextProvider, prevModel) {
	if (nextProvider === "ollama") {
		return prevModel || "qwen2.5:7b";
	}
	if (prevModel === "qwen2.5:7b") {
		return "";
	}
	return prevModel || "";
}

function persistSettings(values) {
	const provider = values.provider || "gemini";
	const defaultModel = provider === "ollama" ? "qwen2.5:7b" : "";
	const model = values.model ?? defaultModel;
	const apiKey = values.apiKey || "";
	writeAgentModel({ provider, model });
	writeAgentApiKey(provider, apiKey);
	return { provider, model, apiKey };
}

function switchProviderFields(form, nextProvider, setSelected) {
	const currentModel = form.getFieldValue("model");
	const nextModel = resolveModelOnProviderSwitch(nextProvider, currentModel);
	const nextKey = readAgentApiKey(nextProvider);
	setSelected(nextProvider);
	form.setFieldsValue({
		provider: nextProvider,
		model: nextModel,
		apiKey: nextKey,
	});
}

function initFormFields(form, setSelected) {
	const modelSettings = readAgentModel();
	const savedKey = readAgentApiKey(modelSettings.provider);
	setSelected(modelSettings.provider);
	form.setFieldsValue({
		provider: modelSettings.provider,
		model: modelSettings.model,
		apiKey: savedKey,
	});
}

function ApiKeyField({ isOllama }) {
	if (isOllama) return null;
	return (
		<Form.Item label="API Key" name="apiKey">
			<Input.Password
				placeholder="Leave empty to use the server key"
				visibilityToggle={false}
				aria-label="API key"
			/>
		</Form.Item>
	);
}

function SettingsForm({ form, onFinish, selectedProvider, onProviderChange }) {
	const isOllama = selectedProvider === "ollama";
	return (
		<Form form={form} layout="vertical" onFinish={onFinish}>
			<Form.Item label="Provider" name="provider">
				<Select
					options={PROVIDER_OPTIONS}
					onChange={onProviderChange}
					aria-label="Provider select"
				/>
			</Form.Item>
			<ApiKeyField isOllama={isOllama} />
			<Form.Item label="Model" name="model">
				<Input
					placeholder={isOllama ? "qwen2.5:7b" : "Default model"}
					aria-label="Model input"
				/>
			</Form.Item>
			<div style={NOTE_STYLE}>Your key is stored only on this device.</div>
			<Form.Item>
				<Button type="primary" htmlType="submit" block>
					Save
				</Button>
			</Form.Item>
		</Form>
	);
}

export default function AgentModelSettings({ onSave, onClose }) {
	const [form] = Form.useForm();
	const [selectedProvider, setSelectedProvider] = useState("gemini");

	useEffect(() => {
		initFormFields(form, setSelectedProvider);
	}, [form]);

	const onFinish = (values) => {
		const saved = persistSettings(values);
		onSave?.(saved);
		onClose?.();
	};

	const onProviderChange = (val) => {
		switchProviderFields(form, val, setSelectedProvider);
	};

	return (
		<SettingsForm
			form={form}
			onFinish={onFinish}
			selectedProvider={selectedProvider}
			onProviderChange={onProviderChange}
		/>
	);
}
