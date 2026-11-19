import {
	Button,
	Card,
	Empty,
	Input,
	List,
	message,
	Space,
	Typography,
} from "antd";
import { useState } from "react";
import { createdProjectTarget } from "./openProject.js";
import ProjectFiles from "./ProjectFiles.jsx";
import { joinPath } from "./projectFiles.js";
import { useProjects } from "./useProjects.js";

const CONTAINER_STYLE = Object.freeze({
	maxWidth: 800,
	margin: "0 auto",
	padding: "24px 16px",
	width: "100%",
	boxSizing: "border-box",
});

const BRAND_GOLD_BUTTON_STYLE = Object.freeze({
	background: "var(--bn-color-brand, #f5c542)",
	color: "var(--bn-text-inverse, #0e1117)",
	fontWeight: 600,
	borderColor: "var(--bn-color-brand, #f5c542)",
});

const CARD_BASE_STYLE = Object.freeze({
	border: "1px solid var(--bn-border-base, #2e354a)",
});

const NEW_PROJECT_CARD_STYLE = Object.freeze({
	...CARD_BASE_STYLE,
	marginBottom: 24,
});

const SECTION_TITLE_STYLE = Object.freeze({
	fontSize: "var(--bn-type-heading-md, 15px)",
	fontWeight: 600,
});

const ITEM_LABEL_STYLE = Object.freeze({
	fontSize: "var(--bn-type-body, 12px)",
});

const METADATA_PATH_STYLE = Object.freeze({
	fontSize: "var(--bn-type-micro, 10px)",
	color: "var(--bn-text-muted, #6c758d)",
});

function findFilePath(projectRoot, files, ext, name) {
	const list = Array.isArray(files) ? files : [];
	const found = list.find((f) => f.endsWith(ext));
	const file = found || (name ? `${name}${ext}` : "");
	return joinPath(projectRoot, file);
}

async function openKiCadProject(projectRoot, filePath) {
	if (!window.banana?.kicad?.open) return;
	try {
		const res = await window.banana.kicad.open({
			kind: "project",
			filePath,
			projectRoot,
		});
		if (res && !res.ok) {
			message.error(res.error || "Failed to open in KiCad");
		}
	} catch (err) {
		message.error(err?.message || "Failed to open in KiCad");
	}
}

async function pickFolder(setParentDir) {
	try {
		const folder = await window.banana?.selectFolder?.();
		if (folder) setParentDir(folder);
	} catch {
		// Ignore folder selection cancelled
	}
}

function FolderPicker({ parentDir, setParentDir, hasBrowse }) {
	if (!hasBrowse) {
		return (
			<Input
				placeholder="Parent folder (absolute path)"
				value={parentDir}
				onChange={(e) => setParentDir(e.target.value)}
			/>
		);
	}
	return (
		<Space.Compact style={{ width: "100%" }}>
			<Input
				placeholder="Parent folder"
				value={parentDir}
				onChange={(e) => setParentDir(e.target.value)}
			/>
			<Button onClick={() => pickFolder(setParentDir)}>Browse</Button>
		</Space.Compact>
	);
}

async function submitProject({
	name,
	parentDir,
	onCreate,
	setLoading,
	setName,
}) {
	const trimmedName = name.trim();
	const trimmedDir = parentDir.trim();
	if (!trimmedName || !trimmedDir) {
		message.error("Name and parent folder are required");
		return;
	}
	setLoading(true);
	const res = await onCreate({ parentDir: trimmedDir, name: trimmedName });
	setLoading(false);
	if (!res.ok) {
		message.error(res.error || "Failed to create project");
		return;
	}
	setName("");
}

export function NewProjectCard({ onCreate }) {
	const [name, setName] = useState("");
	const [parentDir, setParentDir] = useState("");
	const [loading, setLoading] = useState(false);
	const hasBrowse = Boolean(window.banana?.selectFolder);

	const handleCreate = () =>
		submitProject({ name, parentDir, onCreate, setLoading, setName });

	return (
		<Card
			title={<span style={SECTION_TITLE_STYLE}>New Project</span>}
			style={NEW_PROJECT_CARD_STYLE}
		>
			<Space orientation="vertical" size="middle" style={{ width: "100%" }}>
				<Input
					placeholder="Project name"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				<FolderPicker
					parentDir={parentDir}
					setParentDir={setParentDir}
					hasBrowse={hasBrowse}
				/>
				<Button
					type="primary"
					loading={loading}
					onClick={handleCreate}
					style={BRAND_GOLD_BUTTON_STYLE}
				>
					Create
				</Button>
			</Space>
		</Card>
	);
}

function openDesignFile(item, ext, kind, onOpenFile) {
	const path = findFilePath(item.projectRoot, item.files, ext, item.name);
	onOpenFile?.({ projectRoot: item.projectRoot, filePath: path, kind });
}

function openKiCadFile(item) {
	const path = findFilePath(
		item.projectRoot,
		item.files,
		".kicad_pro",
		item.name,
	);
	openKiCadProject(item.projectRoot, path);
}

function ItemActions({ item, kicadStatus, onOpenFile, onSelect }) {
	return (
		<Space>
			<Button
				type="link"
				style={ITEM_LABEL_STYLE}
				onClick={() => onSelect?.(item.projectRoot)}
			>
				Files
			</Button>
			<Button
				type="link"
				style={ITEM_LABEL_STYLE}
				onClick={() =>
					openDesignFile(item, ".kicad_sch", "schematic", onOpenFile)
				}
			>
				Open schematic
			</Button>
			<Button
				type="link"
				style={ITEM_LABEL_STYLE}
				onClick={() => openDesignFile(item, ".kicad_pcb", "pcb", onOpenFile)}
			>
				Open PCB
			</Button>
			{kicadStatus?.installed && (
				<Button
					type="link"
					style={ITEM_LABEL_STYLE}
					onClick={() => openKiCadFile(item)}
				>
					Open in KiCad
				</Button>
			)}
		</Space>
	);
}

export function RecentItem({ item, kicadStatus, onOpenFile, onSelect }) {
	return (
		<List.Item
			actions={[
				<ItemActions
					key="actions"
					item={item}
					kicadStatus={kicadStatus}
					onOpenFile={onOpenFile}
					onSelect={onSelect}
				/>,
			]}
		>
			<List.Item.Meta
				title={<span style={ITEM_LABEL_STYLE}>{item.name}</span>}
				description={
					<span style={METADATA_PATH_STYLE}>{item.projectRoot}</span>
				}
			/>
		</List.Item>
	);
}

export function RecentProjects({ recent, kicadStatus, onOpenFile, onSelect }) {
	if (!recent || recent.length === 0) {
		return (
			<Empty
				description="No recent projects"
				image={Empty.PRESENTED_IMAGE_SIMPLE}
			/>
		);
	}
	return (
		<List
			dataSource={recent}
			renderItem={(item) => (
				<RecentItem
					key={item.projectRoot}
					item={item}
					kicadStatus={kicadStatus}
					onOpenFile={onOpenFile}
					onSelect={onSelect}
				/>
			)}
		/>
	);
}

export default function ProjectHome({ onOpenFile }) {
	const { recent, createProject, kicadStatus } = useProjects();
	const [activeRoot, setActiveRoot] = useState("");
	const handleCreate = async (params) => {
		const res = await createProject(params);
		const target = res.ok ? createdProjectTarget(res.project) : null;
		if (target) onOpenFile?.(target);
		return res;
	};

	return (
		<div style={CONTAINER_STYLE}>
			<Typography.Title level={2} style={SECTION_TITLE_STYLE}>
				Project Manager
			</Typography.Title>
			<NewProjectCard onCreate={handleCreate} />
			{activeRoot && (
				<ProjectFiles projectRoot={activeRoot} onOpenFile={onOpenFile} />
			)}
			<Card
				title={<span style={SECTION_TITLE_STYLE}>Recent Projects</span>}
				style={CARD_BASE_STYLE}
			>
				<RecentProjects
					recent={recent}
					kicadStatus={kicadStatus}
					onOpenFile={onOpenFile}
					onSelect={setActiveRoot}
				/>
			</Card>
		</div>
	);
}
