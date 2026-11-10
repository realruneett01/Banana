import {
	FileSearchOutlined,
	FolderOpenOutlined,
	HistoryOutlined,
	InboxOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Button,
	Form,
	Input,
	Select,
	Switch,
	Timeline,
	Typography,
	Upload,
} from "antd";

const { Title, Text } = Typography;

const COMMITS_CONTAINER_STYLE = Object.freeze({
	borderTop: "1px solid #232738",
	paddingTop: "20px",
	marginTop: "20px",
});

const COMMITS_TITLE_STYLE = Object.freeze({
	color: "#fadb14",
	display: "flex",
	alignItems: "center",
	gap: "8px",
	marginBottom: "15px",
});

const COMMITS_SCROLL_STYLE = Object.freeze({
	maxHeight: "200px",
	overflowY: "auto",
	paddingRight: "5px",
});

const COMMIT_HEADER_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	marginBottom: "2px",
});

const COMMIT_AUTHOR_STYLE = Object.freeze({
	fontSize: "10px",
	color: "#6b6375",
	marginTop: "2px",
});

const DRAGGER_STYLE = Object.freeze({
	background: "#0f1015",
	borderColor: "#232738",
	borderRadius: "4px",
	marginBottom: "15px",
	padding: "10px 0",
});

const NATIVE_NOTICE = Object.freeze({
	title: "Native Desktop Mode",
	description:
		"Direct local filesystem & KiCad CLI access active. Click Browse above or drag & drop your project folder.",
	type: "success",
	style: {
		marginBottom: "15px",
		background: "#131b14",
		borderColor: "#1e3820",
		fontSize: "11px",
		color: "#86efac",
	},
});

const SANDBOX_NOTICE = Object.freeze({
	title: "Sandbox Security Notice",
	description:
		"Because of browser sandbox security, please verify your local absolute repository path above so the Git engine can target it on disk.",
	type: "info",
	style: {
		marginBottom: "15px",
		background: "#161722",
		borderColor: "#232738",
		fontSize: "11px",
		color: "#a6adbb",
	},
});

const VERSION_CONFIG = Object.freeze({
	"target-branch": Object.freeze({
		label: "Target Branch",
		placeholder: "Select target branch",
		name: "targetCommit",
		kind: "target",
	}),
	"target-commit": Object.freeze({
		label: "Target Commit",
		placeholder: "Select target commit",
		name: "targetCommit",
		kind: "target",
	}),
	"base-branch": Object.freeze({
		label: "Base Branch",
		placeholder: "Select base branch",
		name: "baseCommit",
		kind: "base",
	}),
	"base-commit": Object.freeze({
		label: "Base Commit",
		placeholder: "Select base commit",
		name: "baseCommit",
		kind: "base",
	}),
});

const VERSION_FIELD_ITEMS = Object.freeze([
	{
		isTarget: false,
		key: "base",
		valKey: "baseCommit",
		handlerKey: "handleBaseChange",
	},
	{
		isTarget: true,
		key: "target",
		valKey: "targetCommit",
		handlerKey: "handleTargetChange",
	},
]);

const COMMIT_FIELD_CONFIG = Object.freeze({
	base: Object.freeze({
		field: "baseCommit",
		setter: "setBaseCommit",
		other: "targetCommit",
	}),
	target: Object.freeze({
		field: "targetCommit",
		setter: "setTargetCommit",
		other: "baseCommit",
	}),
});

function CommitMeta({ hash, date }) {
	return (
		<div style={COMMIT_HEADER_STYLE}>
			<Text strong style={{ color: "#f5f5f5", fontSize: "11px" }}>
				{hash.substring(0, 7)}
			</Text>
			<Text type="secondary" style={{ fontSize: "10px" }}>
				{date}
			</Text>
		</div>
	);
}

function RecentCommitEntry({ commit }) {
	return (
		<div style={{ fontSize: "11px", color: "#a6adbb" }}>
			<CommitMeta hash={commit.hash} date={commit.date} />
			<div style={{ lineHeight: "1.3" }}>{commit.subject}</div>
			<div style={COMMIT_AUTHOR_STYLE}>by {commit.author}</div>
		</div>
	);
}

function toCommitTimelineItem(commit, idx) {
	return {
		color: idx === 0 ? "#faad14" : "#6b6375",
		children: <RecentCommitEntry commit={commit} />,
	};
}

function RecentCommitsList({ commits }) {
	if (!commits?.length) return null;

	const items = commits.slice(0, 15).map(toCommitTimelineItem);
	return (
		<div style={COMMITS_CONTAINER_STYLE}>
			<Title level={5} style={COMMITS_TITLE_STYLE}>
				<HistoryOutlined /> Recent Git Commits
			</Title>
			<div style={COMMITS_SCROLL_STYLE}>
				<Timeline pending={false} mode="left" items={items} />
			</div>
		</div>
	);
}

function renderBranchOptions(branches) {
	return branches.map((b) => (
		<Select.Option key={`branch-${b}`} value={b}>
			{b}
		</Select.Option>
	));
}

function renderCommitOptions(commits) {
	return commits.map((c) => (
		<Select.Option key={`commit-${c.hash}`} value={c.hash}>
			{c.hash.substring(0, 7)} - {c.subject} ({c.author})
		</Select.Option>
	));
}

function CommitOrBranchSelect(props) {
	const { isBranch, repoInfo, value, placeholder, onChange } = props;
	if (!repoInfo) {
		return (
			<Input
				placeholder="e.g. HEAD or commit hash"
				onChange={(e) => onChange(e.target.value)}
			/>
		);
	}

	return (
		<Select
			showSearch
			placeholder={placeholder}
			onChange={onChange}
			value={value}
		>
			{isBranch
				? renderBranchOptions(repoInfo.branches)
				: renderCommitOptions(repoInfo.commits)}
		</Select>
	);
}

function DraggerContent() {
	return (
		<>
			<p
				className="ant-upload-drag-icon"
				style={{ color: "#faad14", margin: 0 }}
			>
				<InboxOutlined style={{ fontSize: "24px" }} />
			</p>
			<p
				className="ant-upload-text"
				style={{ fontSize: "12px", color: "#f5f5f5", margin: "4px 0 0" }}
			>
				Drag KiCad Project Folder Here
			</p>
			<p
				className="ant-upload-hint"
				style={{ fontSize: "10px", color: "#6b6375", margin: 0 }}
			>
				Supports entire directory drops containing .kicad_pcb/.kicad_sch
			</p>
		</>
	);
}

function LocalRepoDragger({ onFileDropped }) {
	const handleBeforeUpload = (file) => {
		onFileDropped(file);
		return false;
	};

	return (
		<Upload.Dragger
			directory
			multiple={false}
			showUploadList={false}
			beforeUpload={handleBeforeUpload}
			style={DRAGGER_STYLE}
		>
			<DraggerContent />
		</Upload.Dragger>
	);
}

async function browseFolderForRepo(setRepoPath, form, loadRepoInfo) {
	if (!window.banana?.selectFolder) return;
	const selected = await window.banana.selectFolder();
	if (selected) {
		setRepoPath(selected);
		form.setFieldValue("repoPath", selected);
		loadRepoInfo(selected, false);
	}
}

function BrowseFolderButton({ onBrowse }) {
	if (!window.banana?.selectFolder) return null;
	return (
		<Button
			type="default"
			icon={<FolderOpenOutlined />}
			onClick={onBrowse}
			style={{ borderColor: "#fadb14", color: "#fadb14" }}
		>
			Browse
		</Button>
	);
}

function RepoPathInput({ repoPath, setRepoPath, loadRepoInfo, form }) {
	const handleBrowse = () =>
		browseFolderForRepo(setRepoPath, form, loadRepoInfo);
	const handlePathChange = (e) => {
		setRepoPath(e.target.value);
		form.setFieldValue("repoPath", e.target.value);
	};

	return (
		<Form.Item
			label="Local Repo Root Absolute Path"
			name="repoPath"
			rules={[{ required: true, message: "Please input absolute repo path" }]}
			style={{ marginBottom: "8px" }}
		>
			<div style={{ display: "flex", gap: "8px" }}>
				<Input
					placeholder="e.g. C:\Users\project"
					value={repoPath}
					onChange={handlePathChange}
				/>
				<BrowseFolderButton onBrowse={handleBrowse} />
				<Button type="default" onClick={() => loadRepoInfo(repoPath, false)}>
					Load
				</Button>
			</div>
		</Form.Item>
	);
}

function SandboxSecurityNotice() {
	const notice = window.banana?.isElectron ? NATIVE_NOTICE : SANDBOX_NOTICE;
	return (
		<Alert
			title={notice.title}
			description={notice.description}
			type={notice.type}
			showIcon
			style={notice.style}
		/>
	);
}

function FileListSelect({ files, value, onChange, placeholder, keyPrefix }) {
	return (
		<Select
			showSearch
			placeholder={placeholder}
			onChange={onChange}
			value={value}
		>
			{files.map((file) => (
				<Select.Option key={`${keyPrefix}-${file}`} value={file}>
					{file}
				</Select.Option>
			))}
		</Select>
	);
}

function ChangedFilesSelect({ files, value, onChange }) {
	if (!files?.length) {
		return <Select placeholder="No changed KiCad files found" disabled />;
	}
	return (
		<FileListSelect
			files={files}
			value={value}
			onChange={onChange}
			placeholder="Select changed KiCad file"
			keyPrefix="changed"
		/>
	);
}

function RepoFilesSelect({ files, value, onChange }) {
	if (!files?.length) {
		return (
			<Input
				placeholder="e.g. layout/board.kicad_pcb"
				onChange={(e) => onChange(e.target.value)}
			/>
		);
	}
	return (
		<FileListSelect
			files={files}
			value={value}
			onChange={onChange}
			placeholder="Select KiCad file"
			keyPrefix="file"
		/>
	);
}

function LocalDesignFileSelector(props) {
	const {
		compareBranches,
		changedFiles,
		repoInfo,
		relativeFilePath,
		onSelectFile,
	} = props;

	if (compareBranches) {
		return (
			<ChangedFilesSelect
				files={changedFiles}
				value={relativeFilePath}
				onChange={onSelectFile}
			/>
		);
	}

	return (
		<RepoFilesSelect
			files={repoInfo?.kicadFiles}
			value={relativeFilePath}
			onChange={onSelectFile}
		/>
	);
}

function BranchToggleFormItem({ compareBranches, onChange }) {
	return (
		<Form.Item
			label="Compare Branches instead of Commits"
			valuePropName="checked"
			style={{ marginBottom: "12px" }}
		>
			<Switch checked={compareBranches} onChange={onChange} />
		</Form.Item>
	);
}

function getVersionConfig(isTarget, compareBranches) {
	const role = isTarget ? "target" : "base";
	const mode = compareBranches ? "branch" : "commit";
	return VERSION_CONFIG[`${role}-${mode}`];
}

function VersionSelectFormItem(props) {
	const { isTarget, compareBranches, repoInfo, value, onChange } = props;
	const { label, placeholder, name, kind } = getVersionConfig(
		isTarget,
		compareBranches,
	);

	return (
		<Form.Item
			label={label}
			name={name}
			rules={[{ required: true, message: `Please select ${kind} version` }]}
		>
			<CommitOrBranchSelect
				isBranch={compareBranches}
				repoInfo={repoInfo}
				value={value}
				placeholder={placeholder}
				onChange={onChange}
			/>
		</Form.Item>
	);
}

function VersionSelectionFields(props) {
	return (
		<>
			{VERSION_FIELD_ITEMS.map((item) => (
				<VersionSelectFormItem
					key={item.key}
					isTarget={item.isTarget}
					compareBranches={props.compareBranches}
					repoInfo={props.repoInfo}
					value={props[item.valKey]}
					onChange={props[item.handlerKey]}
				/>
			))}
		</>
	);
}

function DesignFileFormItem(props) {
	const handleSelectFile = (val) => {
		props.setRelativeFilePath(val);
		props.form.setFieldValue("relativeFilePath", val);
	};

	return (
		<Form.Item
			label="Design File Path"
			name="relativeFilePath"
			rules={[{ required: true, message: "Please select file path" }]}
		>
			<LocalDesignFileSelector
				compareBranches={props.compareBranches}
				changedFiles={props.changedFiles}
				repoInfo={props.repoInfo}
				relativeFilePath={props.relativeFilePath}
				onSelectFile={handleSelectFile}
			/>
		</Form.Item>
	);
}

function SubmitButtonFormItem({ loading }) {
	return (
		<Form.Item>
			<Button
				type="primary"
				htmlType="submit"
				icon={<FileSearchOutlined />}
				loading={loading}
				block
			>
				Fetch and Render Diff
			</Button>
		</Form.Item>
	);
}

function LocalRepoForm(props) {
	const {
		form,
		repoPath,
		baseCommit,
		targetCommit,
		relativeFilePath,
		onFetchDiff,
	} = props;

	return (
		<Form
			form={form}
			layout="vertical"
			initialValues={{ repoPath, baseCommit, targetCommit, relativeFilePath }}
			onFinish={onFetchDiff}
		>
			<RepoPathInput {...props} />
			<SandboxSecurityNotice />
			<BranchToggleFormItem
				compareBranches={props.compareBranches}
				onChange={props.handleBranchToggle}
			/>
			<VersionSelectionFields {...props} />
			<DesignFileFormItem {...props} />
			<SubmitButtonFormItem loading={props.loading} />
		</Form>
	);
}

function applyBranchToggle(checked, props) {
	const {
		setCompareBranches,
		setBaseCommit,
		setTargetCommit,
		form,
		setChangedFiles,
		setRelativeFilePath,
	} = props;
	setCompareBranches(checked);
	setBaseCommit("");
	setTargetCommit("");
	form.setFieldsValue({ baseCommit: "", targetCommit: "" });
	if (checked) {
		setChangedFiles([]);
		setRelativeFilePath("");
		form.setFieldValue("relativeFilePath", "");
	}
}

function applyCommitSelection(type, val, props) {
	const cfg = COMMIT_FIELD_CONFIG[type];
	props[cfg.setter](val);
	props.form.setFieldValue(cfg.field, val);

	const otherVal = props[cfg.other];
	if (props.compareBranches && otherVal) {
		const isBase = type === "base";
		const baseCommit = isBase ? val : otherVal;
		const targetCommit = isBase ? otherVal : val;
		props.fetchChangedFiles(props.repoPath, baseCommit, targetCommit);
	}
}

function applyBaseCommitChange(val, props) {
	applyCommitSelection("base", val, props);
}

function applyTargetCommitChange(val, props) {
	applyCommitSelection("target", val, props);
}

export function LocalRepoControls(props) {
	const formProps = {
		...props,
		handleBranchToggle: (checked) => applyBranchToggle(checked, props),
		handleBaseChange: (val) => applyBaseCommitChange(val, props),
		handleTargetChange: (val) => applyTargetCommitChange(val, props),
	};

	return (
		<>
			<LocalRepoDragger onFileDropped={props.onFileDropped} />
			<LocalRepoForm {...formProps} />
			<RecentCommitsList commits={props.repoInfo?.commits} />
		</>
	);
}
