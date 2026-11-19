import { Button, Card, Empty, List, message, Tag, Upload } from "antd";
import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../config.js";
import {
	fileOpenTarget,
	importProjectFile,
	listProjectFiles,
} from "./projectFiles.js";
import { createProjectHeaders } from "./useProjects.js";

const IMPORT_ACCEPT = ".kicad_sch,.kicad_pcb,.kicad_sym,.kicad_mod";

async function requestDeps() {
	return { baseUrl: API_BASE_URL, headers: await createProjectHeaders() };
}

function useProjectFiles(projectRoot) {
	const [files, setFiles] = useState([]);
	const [loading, setLoading] = useState(false);
	const refresh = useCallback(async () => {
		setLoading(true);
		const res = await listProjectFiles(projectRoot, await requestDeps());
		setLoading(false);
		if (!res.ok) message.error(res.error);
		setFiles(res.ok ? res.files : []);
	}, [projectRoot]);
	useEffect(() => {
		refresh();
	}, [refresh]);
	return { files, loading, refresh };
}

async function importFile(projectRoot, file, refresh) {
	const res = await importProjectFile(projectRoot, file, await requestDeps());
	if (!res.ok) {
		message.error(res.error);
		return;
	}
	message.success(`Imported ${file.name}`);
	refresh();
}

function FileRow({ projectRoot, file, onOpenFile }) {
	const target = fileOpenTarget(projectRoot, file);
	const actions = target
		? [
				<Button key="open" type="link" onClick={() => onOpenFile?.(target)}>
					Open
				</Button>,
			]
		: [];
	return (
		<List.Item actions={actions}>
			<List.Item.Meta title={file.name} description={file.modified} />
			<Tag>{file.kind}</Tag>
		</List.Item>
	);
}

export default function ProjectFiles({ projectRoot, onOpenFile }) {
	const { files, loading, refresh } = useProjectFiles(projectRoot);
	const beforeUpload = (file) => {
		importFile(projectRoot, file, refresh);
		return false;
	};
	const addButton = (
		<Upload
			accept={IMPORT_ACCEPT}
			showUploadList={false}
			beforeUpload={beforeUpload}
		>
			<Button>Add file</Button>
		</Upload>
	);
	return (
		<Card title="Project Files" extra={addButton} style={{ marginBottom: 24 }}>
			<List
				loading={loading}
				dataSource={files}
				locale={{ emptyText: <Empty description="No files" /> }}
				renderItem={(file) => (
					<FileRow
						key={file.name}
						projectRoot={projectRoot}
						file={file}
						onOpenFile={onOpenFile}
					/>
				)}
			/>
		</Card>
	);
}
