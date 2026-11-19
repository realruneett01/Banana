import { Button, Empty, message, Space } from "antd";
import { useRef } from "react";
import { DiffViewport } from "../components/DiffViewport.jsx";
import SimulationStudio from "../components/sim3d/SimulationStudio.jsx";
import AssignFootprints from "../editor/AssignFootprints.jsx";
import EditorScreen from "../editor/EditorScreen.jsx";
import SymbolFieldsTable from "../editor/SymbolFieldsTable.jsx";
import ProjectHome from "../projects/ProjectHome.jsx";

// --- Pure ide-tab-content helpers ---
export const TAB_SPECS = Object.freeze({
	welcome: Object.freeze({ id: "welcome", kind: "welcome", title: "Welcome" }),
	schematic: Object.freeze({
		id: "schematic",
		kind: "schematic",
		title: "Schematic",
	}),
	pcb: Object.freeze({ id: "pcb", kind: "pcb", title: "PCB" }),
	"3d": Object.freeze({ id: "3d", kind: "3d", title: "3D Studio" }),
	diff: Object.freeze({ id: "diff", kind: "diff", title: "Diff" }),
	holo: Object.freeze({ id: "holo", kind: "holo", title: "Holo" }),
	fields: Object.freeze({ id: "fields", kind: "fields", title: "Fields" }),
	footprints: Object.freeze({
		id: "footprints",
		kind: "footprints",
		title: "Footprints",
	}),
	settings: Object.freeze({
		id: "settings",
		kind: "settings",
		title: "Settings",
	}),
});

export function tabForKind(kind) {
	if (!kind || typeof kind !== "string") {
		return null;
	}
	const match = TAB_SPECS[kind.toLowerCase()];
	return match ? { ...match } : { id: kind, kind, title: kind };
}

function resolveEditorFile(ws) {
	if (!ws) return null;
	const viewFile = ws.viewportProps?.relativeFilePath;
	if (viewFile) return viewFile;
	return ws.sidebarProps?.localProps?.relativeFilePath || null;
}

export function buildEditorRepo(ws) {
	const repoPath = ws?.sidebarProps?.localProps?.repoPath || undefined;
	const file = resolveEditorFile(ws);
	const schPath = file?.endsWith(".kicad_sch") ? file : undefined;
	const pcbPath = file?.endsWith(".kicad_pcb") ? file : undefined;
	return { repoPath, schPath, pcbPath };
}
// --- End pure ide-tab-content helpers ---

async function applyImportedDesign(loop, importRes, kind) {
	const data = importRes?.data;
	const tab = kind === "pcb" ? "pcb" : "schematic";
	const ok = loop?.openDesign?.({
		ir: data?.ir,
		board: data?.board,
		symbols: data?.symbols,
		tab,
	});
	if (ok === false) {
		message.error("File did not contain a valid design");
	}
	return ok !== false;
}

async function requestImport(api, kind, text) {
	const res = await api.editorImport({ kind, text });
	if (!res?.ok) {
		const fail = res?.data?.error || res?.error || "Could not open file";
		message.error(fail);
		return null;
	}
	return res;
}

export async function fetchGitFile(loop, repoPath, filePath) {
	try {
		const res = await loop.api.gitFileContent({ repoPath, filePath });
		if (res?.ok) return res.text;
		const fail = res?.error || res?.data?.error || "Could not read file";
		message.error(fail);
	} catch (err) {
		message.error(err?.message || "Could not read file");
	}
	return null;
}

export async function importAndOpenDesign(loop, kind, text) {
	try {
		if (!loop?.api?.editorImport) return;
		const res = await requestImport(loop.api, kind, text);
		if (res) await applyImportedDesign(loop, res, kind);
	} catch (err) {
		message.error(err?.message || "Could not import file");
	}
}

export async function runEditCurrentFile(loop, repo) {
	const targetPath = repo?.schPath || repo?.pcbPath;
	if (!repo?.repoPath || !targetPath) return;
	const content = await fetchGitFile(loop, repo.repoPath, targetPath);
	if (!content) return;
	const targetKind = targetPath.endsWith(".kicad_pcb") ? "pcb" : "sch";
	await importAndOpenDesign(loop, targetKind, content);
}

export async function loadKicadFile(loop, file) {
	if (!file || !loop?.api?.editorImport) return;
	const isPcb = file.name?.endsWith(".kicad_pcb");
	const kind = isPcb ? "pcb" : "sch";
	try {
		const text = await file.text();
		const res = await requestImport(loop.api, kind, text);
		if (res) applyImportedDesign(loop, res, kind);
	} catch {
		message.error("Could not open file");
	}
}

const DESIGN_START_OPTIONS = Object.freeze([
	{ label: "New schematic", target: "schematic" },
	{ label: "New PCB", target: "pcb" },
]);

function StartActionButtons({ loop, compact, onPickFile, editState }) {
	const size = compact ? "small" : undefined;
	return (
		<Space size="small">
			{DESIGN_START_OPTIONS.map((opt) => (
				<Button
					key={opt.target}
					size={size}
					onClick={() => loop?.newDesign?.(opt.target)}
				>
					{opt.label}
				</Button>
			))}
			<Button size={size} onClick={onPickFile}>
				Open KiCad file
			</Button>
			{editState?.canEdit && (
				<Button size={size} onClick={editState.onEdit}>
					Edit this file
				</Button>
			)}
		</Space>
	);
}

function useDesignStartActions(loop, repo) {
	const fileInputRef = useRef(null);
	const targetPath = repo?.schPath || repo?.pcbPath;
	const canEdit = Boolean(repo?.repoPath && targetPath);

	const handleFileChosen = async (event) => {
		const picked = event.target.files?.[0];
		try {
			if (picked) await loadKicadFile(loop, picked);
		} finally {
			event.target.value = "";
		}
	};

	return {
		fileInputRef,
		openFileDialog: () => fileInputRef.current?.click(),
		handleFileChosen,
		editState: { canEdit, onEdit: () => runEditCurrentFile(loop, repo) },
	};
}

const CENTER_STYLE = Object.freeze({
	height: "100%",
	width: "100%",
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
});

function CenteredBox({ children }) {
	return <div style={CENTER_STYLE}>{children}</div>;
}

const SCROLL_BOX_STYLE = Object.freeze({
	height: "100%",
	overflow: "auto",
});

function ScrollBox({ children }) {
	return <div style={SCROLL_BOX_STYLE}>{children}</div>;
}

export function DesignStartPanel({ loop, compact, repo }) {
	const actions = useDesignStartActions(loop, repo);
	const buttons = (
		<StartActionButtons
			loop={loop}
			compact={compact}
			onPickFile={actions.openFileDialog}
			editState={actions.editState}
		/>
	);
	const fileInput = (
		<input
			ref={actions.fileInputRef}
			type="file"
			accept=".kicad_sch,.kicad_pcb"
			style={{ display: "none" }}
			onChange={actions.handleFileChosen}
		/>
	);

	if (compact) {
		return (
			<>
				{fileInput}
				{buttons}
			</>
		);
	}
	return (
		<CenteredBox>
			{fileInput}
			<Empty description="No design yet - start a new schematic or PCB, or open a KiCad file">
				{buttons}
			</Empty>
		</CenteredBox>
	);
}

function DesignPlaceholder({ loop, repo }) {
	return (
		<CenteredBox>
			<DesignStartPanel loop={loop} repo={repo} />
		</CenteredBox>
	);
}

function EditorTabPane({ loop, repo, initialTab }) {
	if (!loop?.ir) return <DesignPlaceholder loop={loop} repo={repo} />;
	return (
		<EditorScreen
			key={loop.docKey}
			ir={loop.ir}
			board={loop.board}
			symbols={loop.symbols}
			initialTab={initialTab}
			onSave={loop.saveFromEditor}
			focusItemId={loop.focusItemId}
			api={loop.api}
			repo={repo}
		/>
	);
}

function StudioTabPane({ loop }) {
	if (!loop?.ir) return <DesignPlaceholder loop={loop} />;
	const onApplyFix = (fix) => {
		const res = loop.applyFix?.(fix);
		if (res?.ok) message.success(`Fix applied: ${fix.title}`);
		else message.error(res?.error || "Failed to apply fix");
	};
	return (
		<SimulationStudio
			api={loop.api}
			ir={loop.ir}
			board={loop.board}
			onApplyFix={onApplyFix}
		/>
	);
}

function TabEmptyView({ message: text }) {
	return (
		<CenteredBox>
			<Empty description={text} />
		</CenteredBox>
	);
}

function renderEditorPane(kind, loop, repo) {
	return <EditorTabPane loop={loop} repo={repo} initialTab={kind} />;
}

function renderInlineEditorTab(Component, loop, repo) {
	if (!loop?.ir) return <DesignPlaceholder loop={loop} repo={repo} />;
	return (
		<Component
			inline={true}
			ir={loop.ir}
			onApply={(cmd) => loop?.applyModelCommand?.(cmd) || loop?.setIr?.(cmd.ir)}
		/>
	);
}

function renderTabByKind({ kind, loop, repo, ws, onOpenFile }) {
	switch (kind) {
		case "welcome":
			return (
				<ScrollBox>
					<ProjectHome onOpenFile={onOpenFile} />
				</ScrollBox>
			);
		case "schematic":
		case "pcb":
			return renderEditorPane(kind, loop, repo);
		case "3d":
			return <StudioTabPane loop={loop} />;
		case "diff":
			return (
				<ScrollBox>
					<DiffViewport {...ws?.viewportProps} />
				</ScrollBox>
			);
		case "fields":
			return renderInlineEditorTab(SymbolFieldsTable, loop, repo);
		case "footprints":
			return renderInlineEditorTab(AssignFootprints, loop, repo);
		default:
			return null;
	}
}

function renderActiveTabPane({ activeTab, loop, ws, repo, onOpenFile }) {
	const content = renderTabByKind({
		kind: activeTab.kind,
		loop,
		repo,
		ws,
		onOpenFile,
	});
	if (content) return content;
	const label = activeTab.title || activeTab.kind;
	return <TabEmptyView message={`Tab content for ${label} coming soon`} />;
}

export function IdeTabContent({ activeTab, loop, ws, onOpenFile }) {
	if (!activeTab) {
		return <TabEmptyView message="No open editor tab" />;
	}
	const repo = buildEditorRepo(ws);
	return renderActiveTabPane({ activeTab, loop, ws, repo, onOpenFile });
}

export default IdeTabContent;
