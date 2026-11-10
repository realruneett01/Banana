import {
	BranchesOutlined,
	GithubOutlined,
	GlobalOutlined,
	HistoryOutlined,
	LockOutlined,
	PullRequestOutlined,
	SyncOutlined,
	ThunderboltOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Button,
	Card,
	Form,
	Input,
	message,
	Radio,
	Select,
	Space,
	Spin,
	Tag,
	Timeline,
	Tooltip,
	Typography,
} from "antd";
import { useState } from "react";
import { useGithubSync } from "./useGithubSync.js";

const { Text, Title } = Typography;

const BANANA_BUTTON_STYLE = Object.freeze({
	background: "linear-gradient(135deg, #fadb14 0%, #faad14 100%)",
	color: "#000",
	fontWeight: 600,
	border: "none",
});

const STYLES = Object.freeze({
	cardPrompt: {
		background: "linear-gradient(180deg, #161821 0%, #0f1015 100%)",
		borderColor: "#232738",
		borderRadius: "8px",
		textAlign: "center",
		padding: "16px 8px",
	},
	githubIconCircle: {
		width: 48,
		height: 48,
		borderRadius: "50%",
		background: "#24292e",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		marginBottom: "12px",
		border: "2px solid #fadb14",
	},
	mutedBlock: {
		fontSize: "11px",
		color: "#8b949e",
		display: "block",
		marginBottom: "16px",
	},
	accountBadge: {
		background: "#0f1015",
		border: "1px solid #232738",
		borderRadius: "6px",
		padding: "8px 12px",
		marginBottom: "14px",
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
	},
	avatarImg: {
		width: 22,
		height: 22,
		borderRadius: "50%",
		border: "1px solid #fadb14",
	},
	yellowLink: {
		color: "#fadb14",
		fontSize: "11px",
		padding: 0,
	},
	rowBetween: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
	},
	labelRow: {
		display: "flex",
		justifyContent: "space-between",
		width: "100%",
		alignItems: "center",
	},
	labelTitle: {
		color: "#e2e8f0",
		fontSize: "12px",
		fontWeight: 600,
	},
	inputDark: {
		background: "#0f1015",
		borderColor: "#232738",
		color: "#fff",
	},
	alertInfo: {
		background: "#0f1015",
		borderColor: "#232738",
		fontSize: "11px",
	},
	miniTag: {
		fontSize: "10px",
		padding: "0 4px",
		margin: 0,
	},
	commitTrailContainer: {
		borderTop: "1px solid #232738",
		paddingTop: "16px",
		marginTop: "16px",
	},
	commitTrailTitle: {
		color: "#fadb14",
		display: "flex",
		alignItems: "center",
		gap: "8px",
		marginBottom: "12px",
		fontSize: "13px",
	},
	commitTrailScroll: {
		maxHeight: "180px",
		overflowY: "auto",
		paddingRight: "4px",
	},
	targetLabel: {
		fontSize: "11px",
		color: "#8b949e",
		display: "block",
		marginBottom: "6px",
	},
});

const matchesFilter = (val, input) =>
	(val ?? "").toLowerCase().includes((input ?? "").toLowerCase());

function GithubPromptCard({ onOpenAuthModal }) {
	return (
		<div style={{ padding: "10px 0" }}>
			<Card style={STYLES.cardPrompt}>
				<div style={STYLES.githubIconCircle}>
					<GithubOutlined style={{ fontSize: "24px", color: "#fff" }} />
				</div>
				<Title level={5} style={{ color: "#fff", margin: "0 0 6px" }}>
					GitHub Cloud Diffing
				</Title>
				<Text style={STYLES.mutedBlock}>
					Compare remote hardware branches, commits and Pull Requests directly
					from GitHub without cloning locally.
				</Text>
				<Button
					type="primary"
					icon={<GithubOutlined />}
					onClick={onOpenAuthModal}
					style={{ ...BANANA_BUTTON_STYLE, width: "100%", height: "36px" }}
				>
					Connect GitHub Account
				</Button>
			</Card>
		</div>
	);
}

function GithubAccountBadge({ githubUser, onOpenAuthModal }) {
	return (
		<div style={STYLES.accountBadge}>
			<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
				<img
					src={githubUser.avatarUrl}
					alt={githubUser.login}
					style={STYLES.avatarImg}
				/>
				<Text style={{ color: "#fff", fontSize: "12px", fontWeight: 600 }}>
					{githubUser.login}
				</Text>
			</div>
			<Tooltip title="Manage GitHub connection">
				<Button
					type="text"
					size="small"
					style={STYLES.yellowLink}
					onClick={onOpenAuthModal}
				>
					Manage
				</Button>
			</Tooltip>
		</div>
	);
}

function RepoOptionItem({ repo }) {
	const tagColor = repo.isPrivate ? "warning" : "default";
	const tagIcon = repo.isPrivate ? <LockOutlined /> : <GlobalOutlined />;
	const tagText = repo.isPrivate ? "Private" : "Public";

	return (
		<div style={STYLES.rowBetween}>
			<span style={{ fontWeight: 500 }}>
				{repo.name}
				<span style={{ color: "#6b7280", fontSize: "11px", marginLeft: "4px" }}>
					({repo.owner})
				</span>
			</span>
			<Tag color={tagColor} icon={tagIcon} style={STYLES.miniTag}>
				{tagText}
			</Tag>
		</div>
	);
}

function RepoSelectorLabel(props) {
	const { loadingRepos, onRefreshRepos, manualRepoMode, setManualRepoMode } =
		props;
	return (
		<div style={STYLES.labelRow}>
			<span style={STYLES.labelTitle}>Remote Repository</span>
			<Space size="small">
				<Button
					type="link"
					size="small"
					icon={<SyncOutlined spin={loadingRepos} />}
					onClick={onRefreshRepos}
					style={STYLES.yellowLink}
					title="Refresh Repositories"
				/>
				<Text type="secondary" style={{ fontSize: "10px" }}>
					|
				</Text>
				<Button
					type="link"
					size="small"
					onClick={() => setManualRepoMode(!manualRepoMode)}
					style={STYLES.yellowLink}
				>
					{manualRepoMode ? "Select from list" : "Custom repo"}
				</Button>
			</Space>
		</div>
	);
}

function ManualRepoInputControl(props) {
	const { value, onChange, onSubmit } = props;
	return (
		<div style={{ display: "flex", gap: "6px" }}>
			<Input
				placeholder="owner/repository"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onPressEnter={onSubmit}
				style={STYLES.inputDark}
			/>
			<Button
				type="primary"
				onClick={onSubmit}
				style={{ background: "#fadb14", color: "#000" }}
			>
				Set
			</Button>
		</div>
	);
}

function RepoSelectDropdown(props) {
	const { repos, selectedRepo, onSelectRepo, loadingRepos } = props;
	const selectedValue = selectedRepo
		? `${selectedRepo.owner}/${selectedRepo.name}`
		: undefined;

	const handleChange = (val) => {
		const found = repos.find((r) => `${r.owner}/${r.name}` === val);
		if (found) onSelectRepo(found);
	};

	return (
		<Select
			showSearch
			placeholder="Search repositories..."
			loading={loadingRepos}
			value={selectedValue}
			onChange={handleChange}
			filterOption={(input, option) => matchesFilter(option?.value, input)}
			style={{ width: "100%" }}
		>
			{repos.map((r) => (
				<Select.Option
					key={r.id || `${r.owner}/${r.name}`}
					value={`${r.owner}/${r.name}`}
				>
					<RepoOptionItem repo={r} />
				</Select.Option>
			))}
		</Select>
	);
}

function RepoSelector(props) {
	const {
		manualRepoMode,
		manualRepoInput,
		setManualRepoInput,
		onManualRepoSubmit,
	} = props;
	return (
		<Form.Item
			label={<RepoSelectorLabel {...props} />}
			style={{ marginBottom: "12px" }}
		>
			{manualRepoMode ? (
				<ManualRepoInputControl
					value={manualRepoInput}
					onChange={setManualRepoInput}
					onSubmit={onManualRepoSubmit}
				/>
			) : (
				<RepoSelectDropdown {...props} />
			)}
		</Form.Item>
	);
}

function CompareModeToggle({ compareMode, setCompareMode }) {
	const radioStyle = { flex: 1, textAlign: "center", fontSize: "11px" };
	return (
		<div style={{ marginBottom: "14px" }}>
			<Text style={STYLES.targetLabel}>Comparison Target:</Text>
			<Radio.Group
				value={compareMode}
				onChange={(e) => setCompareMode(e.target.value)}
				style={{ width: "100%", display: "flex" }}
				buttonStyle="solid"
			>
				<Radio.Button value="pulls" style={radioStyle}>
					<PullRequestOutlined style={{ marginRight: "4px" }} />
					Pull Request
				</Radio.Button>
				<Radio.Button value="branches" style={radioStyle}>
					<BranchesOutlined style={{ marginRight: "4px" }} />
					Branch / Commit
				</Radio.Button>
			</Radio.Group>
		</div>
	);
}

function PullRequestEmptyAlert() {
	return (
		<Alert
			title="No open Pull Requests found"
			description="This repository has no open PRs. Switch to 'Branch / Commit' mode above."
			type="info"
			showIcon
			style={STYLES.alertInfo}
		/>
	);
}

function PullRequestOptionItem({ pr }) {
	return (
		<div>
			<div style={{ fontWeight: 600, color: "#f5f5f5", fontSize: "12px" }}>
				#{pr.number}: {pr.title}
			</div>
			<div style={{ fontSize: "10px", color: "#8b949e", marginTop: "2px" }}>
				by @{pr.author} • <span style={{ color: "#fadb14" }}>{pr.baseRef}</span>{" "}
				← <span style={{ color: "#00ff66" }}>{pr.headRef}</span>
			</div>
		</div>
	);
}

function PullRequestSelectDropdown(props) {
	const { pulls, loading, selectedNumber, onSelect } = props;
	return (
		<Select
			showSearch
			placeholder="Select Pull Request..."
			loading={loading}
			value={selectedNumber}
			onChange={onSelect}
			filterOption={(input, option) => matchesFilter(option?.label, input)}
			style={{ width: "100%" }}
		>
			{pulls.map((pr) => (
				<Select.Option
					key={pr.id || pr.number}
					value={pr.number}
					label={`#${pr.number} ${pr.title}`}
				>
					<PullRequestOptionItem pr={pr} />
				</Select.Option>
			))}
		</Select>
	);
}

function PullRequestSelector(props) {
	const { pulls, loadingPulls, selectedPull, onSelectPull } = props;
	const handleSelect = (num) => {
		const pr = pulls.find((p) => p.number === num);
		if (pr) onSelectPull(pr);
	};

	return (
		<Form.Item label="Pull Request" style={{ marginBottom: "12px" }}>
			{pulls.length === 0 ? (
				<PullRequestEmptyAlert />
			) : (
				<PullRequestSelectDropdown
					pulls={pulls}
					loading={loadingPulls}
					selectedNumber={selectedPull?.number}
					onSelect={handleSelect}
				/>
			)}
		</Form.Item>
	);
}

function BranchSelectField(props) {
	const { label, placeholder, value, loading, branches, onChange, keyPrefix } =
		props;
	return (
		<Form.Item label={label} style={{ marginBottom: "8px" }}>
			<Select
				showSearch
				placeholder={placeholder}
				value={value}
				loading={loading}
				onChange={onChange}
			>
				{branches.map((b) => (
					<Select.Option key={`${keyPrefix}-${b.name}`} value={b.name}>
						{b.name}
					</Select.Option>
				))}
			</Select>
		</Form.Item>
	);
}

function CommitSelectFormItem(props) {
	const {
		label,
		placeholder,
		value,
		loading,
		commits,
		onChange,
		keyPrefix,
		marginBottom = "8px",
	} = props;

	return (
		<Form.Item label={label} style={{ marginBottom }}>
			<Select
				showSearch
				placeholder={placeholder}
				value={value}
				loading={loading}
				onChange={onChange}
			>
				{commits.map((c) => (
					<Select.Option key={`${keyPrefix}-${c.hash}`} value={c.hash}>
						{c.shortHash} - {c.message} ({c.author})
					</Select.Option>
				))}
			</Select>
		</Form.Item>
	);
}

function BranchPairSelectRow(props) {
	const { branches, loading, baseBranch, onBase, targetBranch, onTarget } =
		props;
	return (
		<div
			style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}
		>
			<BranchSelectField
				label="Base Branch"
				placeholder="Base Branch"
				value={baseBranch}
				loading={loading}
				branches={branches}
				onChange={onBase}
				keyPrefix="base"
			/>
			<BranchSelectField
				label="Target Branch"
				placeholder="Target Branch"
				value={targetBranch}
				loading={loading}
				branches={branches}
				onChange={onTarget}
				keyPrefix="tgt"
			/>
		</div>
	);
}

function CommitPairSelectSection(props) {
	const {
		baseCommits,
		targetCommits,
		loading,
		baseCommit,
		targetCommit,
		onBase,
		onTarget,
	} = props;
	return (
		<>
			<CommitSelectFormItem
				label="Base Commit"
				placeholder="Select base commit..."
				value={baseCommit}
				loading={loading}
				commits={baseCommits}
				keyPrefix="base"
				onChange={onBase}
			/>
			<CommitSelectFormItem
				label="Target Commit"
				placeholder="Select target commit..."
				value={targetCommit}
				loading={loading}
				commits={targetCommits}
				keyPrefix="tgt"
				marginBottom="12px"
				onChange={onTarget}
			/>
		</>
	);
}

function BranchCommitSelector(props) {
	const { setBaseCommit, setTargetCommit, form } = props;
	const onBase = (val) => {
		setBaseCommit(val);
		form.setFieldValue("baseCommit", val);
	};
	const onTarget = (val) => {
		setTargetCommit(val);
		form.setFieldValue("targetCommit", val);
	};

	return (
		<>
			<BranchPairSelectRow
				branches={props.branches}
				loading={props.loadingBranches}
				baseBranch={props.baseBranch}
				onBase={props.setBaseBranch}
				targetBranch={props.targetBranch}
				onTarget={props.setTargetBranch}
			/>
			<CommitPairSelectSection
				baseCommits={props.baseCommits}
				targetCommits={props.targetCommits}
				loading={props.loadingCommits}
				baseCommit={props.baseCommit}
				targetCommit={props.targetCommit}
				onBase={onBase}
				onTarget={onTarget}
			/>
		</>
	);
}

function HardwareFileLabel({ loadingFiles }) {
	return (
		<div style={STYLES.labelRow}>
			<span style={STYLES.labelTitle}>
				CAD Hardware File (.kicad_pcb / .kicad_sch)
			</span>
			{loadingFiles && <Spin size="small" />}
		</div>
	);
}

function HardwareFileOption({ file }) {
	return (
		<div style={STYLES.rowBetween}>
			<span style={{ fontFamily: "monospace", fontSize: "11px" }}>
				{file.path}
			</span>
			<Tag color={file.isPcb ? "gold" : "blue"} style={STYLES.miniTag}>
				{file.isPcb ? "PCB" : "SCH"}
			</Tag>
		</div>
	);
}

function HardwareFileSelectDropdown(props) {
	const { files, value, onChange } = props;
	return (
		<Select
			showSearch
			placeholder="Select hardware design file..."
			value={value}
			onChange={onChange}
			style={{ width: "100%" }}
		>
			{files.map((f) => (
				<Select.Option key={f.path} value={f.path}>
					<HardwareFileOption file={f} />
				</Select.Option>
			))}
		</Select>
	);
}

function HardwareFileInputControl(props) {
	const { value, onChange } = props;
	return (
		<Input
			placeholder="e.g. path/to/board.kicad_pcb"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			style={STYLES.inputDark}
		/>
	);
}

function HardwareFileSelector(props) {
	const {
		hardwareFiles,
		loadingFiles,
		relativeFilePath,
		setRelativeFilePath,
		form,
	} = props;
	const handleFileChange = (path) => {
		setRelativeFilePath(path);
		form.setFieldValue("relativeFilePath", path);
	};

	return (
		<Form.Item
			label={<HardwareFileLabel loadingFiles={loadingFiles} />}
			style={{ marginBottom: "16px" }}
		>
			{hardwareFiles.length === 0 ? (
				<HardwareFileInputControl
					value={relativeFilePath}
					onChange={handleFileChange}
				/>
			) : (
				<HardwareFileSelectDropdown
					files={hardwareFiles}
					value={relativeFilePath}
					onChange={handleFileChange}
				/>
			)}
		</Form.Item>
	);
}

function CommitTimelineItemContent({ commit }) {
	const formattedDate = commit.date
		? new Date(commit.date).toLocaleDateString()
		: "";
	return (
		<div style={{ fontSize: "11px", color: "#a6adbb" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					marginBottom: "2px",
				}}
			>
				<Text strong style={{ color: "#f5f5f5", fontSize: "11px" }}>
					{commit.shortHash}
				</Text>
				<Text type="secondary" style={{ fontSize: "10px" }}>
					{formattedDate}
				</Text>
			</div>
			<div style={{ lineHeight: "1.3" }}>{commit.message}</div>
			<div style={{ fontSize: "10px", color: "#6b6375", marginTop: "2px" }}>
				by {commit.author}
			</div>
		</div>
	);
}

function buildCommitTimelineItems(commits) {
	return commits.slice(0, 10).map((c, idx) => ({
		color: idx === 0 ? "#faad14" : "#6b6375",
		children: <CommitTimelineItemContent commit={c} />,
	}));
}

function RemoteCommitTrail({ baseCommits }) {
	if (baseCommits.length === 0) return null;
	const items = buildCommitTimelineItems(baseCommits);
	return (
		<div style={STYLES.commitTrailContainer}>
			<Title level={5} style={STYLES.commitTrailTitle}>
				<HistoryOutlined /> Remote Commit Trail
			</Title>
			<div style={STYLES.commitTrailScroll}>
				<Timeline pending={false} mode="left" items={items} />
			</div>
		</div>
	);
}

function GithubComparisonSection(props) {
	const { compareMode, syncState } = props;
	if (compareMode === "pulls") {
		return (
			<PullRequestSelector
				pulls={syncState.pulls}
				loadingPulls={syncState.loadingPulls}
				selectedPull={syncState.selectedPull}
				onSelectPull={syncState.handleSelectPull}
			/>
		);
	}
	return <BranchCommitSelector {...syncState} {...props} />;
}

function FetchDiffSubmitButton({ loading }) {
	return (
		<Button
			type="primary"
			htmlType="submit"
			icon={<ThunderboltOutlined />}
			loading={loading}
			block
			style={{
				...BANANA_BUTTON_STYLE,
				fontWeight: 700,
				height: "38px",
				fontSize: "13px",
				boxShadow: "0 4px 14px rgba(250, 219, 20, 0.35)",
			}}
		>
			Fetch & Render Remote Diff
		</Button>
	);
}

function validateGithubSubmission(options) {
	const { selectedRepo, baseCommit, targetCommit, relativeFilePath } = options;
	if (!selectedRepo) {
		message.error("Please select a repository");
		return false;
	}
	if (!baseCommit || !targetCommit) {
		message.error("Please select base and target revisions");
		return false;
	}
	if (!relativeFilePath) {
		message.error("Please select a hardware design file");
		return false;
	}
	return true;
}

function parseManualRepoString(input) {
	const trimmed = input.trim();
	if (!trimmed.includes("/")) {
		message.error(
			"Format must be owner/repository (e.g. OLIMEX/OLIMEXINO-328)",
		);
		return null;
	}
	const [owner, name] = trimmed.split("/");
	return {
		id: trimmed,
		name,
		fullName: trimmed,
		owner,
		isPrivate: false,
		defaultBranch: "main",
	};
}

const buildRepoProps = (controlsProps, formState) => ({
	repos: formState.syncState.repos,
	loadingRepos: formState.syncState.loadingRepos,
	onRefreshRepos: formState.syncState.fetchRepos,
	selectedRepo: controlsProps.selectedRepo,
	onSelectRepo: controlsProps.setSelectedRepo,
	manualRepoMode: formState.manualRepoMode,
	setManualRepoMode: formState.setManualRepoMode,
	manualRepoInput: formState.manualRepoInput,
	setManualRepoInput: formState.setManualRepoInput,
	onManualRepoSubmit: formState.handleManualRepoSubmit,
});

function GithubDiffForm(props) {
	const { controlsProps, formState, handleSubmit } = props;
	const { form, compareMode, setCompareMode, syncState } = formState;

	return (
		<Form form={form} layout="vertical" onFinish={handleSubmit}>
			<RepoSelector {...buildRepoProps(controlsProps, formState)} />
			<CompareModeToggle
				compareMode={compareMode}
				setCompareMode={setCompareMode}
			/>
			<GithubComparisonSection
				compareMode={compareMode}
				syncState={syncState}
				{...controlsProps}
				form={form}
			/>
			<HardwareFileSelector
				hardwareFiles={syncState.hardwareFiles}
				loadingFiles={syncState.loadingFiles}
				{...controlsProps}
				form={form}
			/>
			<FetchDiffSubmitButton loading={controlsProps.loading} />
		</Form>
	);
}

function useGithubFormState(props) {
	const [form] = Form.useForm();
	const [compareMode, setCompareMode] = useState("pulls");
	const [manualRepoMode, setManualRepoMode] = useState(false);
	const [manualRepoInput, setManualRepoInput] = useState("");
	const syncState = useGithubSync({ ...props, compareMode, form });

	const handleManualRepoSubmit = () => {
		const parsed = parseManualRepoString(manualRepoInput);
		if (parsed) {
			props.setSelectedRepo(parsed);
			setManualRepoMode(false);
		}
	};

	return {
		form,
		compareMode,
		setCompareMode,
		manualRepoMode,
		setManualRepoMode,
		manualRepoInput,
		setManualRepoInput,
		syncState,
		handleManualRepoSubmit,
	};
}

function handleDiffSubmit(props) {
	const {
		selectedRepo,
		baseCommit,
		targetCommit,
		relativeFilePath,
		onFetchDiff,
	} = props;
	const isValid = validateGithubSubmission({
		selectedRepo,
		baseCommit,
		targetCommit,
		relativeFilePath,
	});
	if (!isValid) return;

	onFetchDiff({
		owner: selectedRepo.owner,
		repo: selectedRepo.name,
		baseCommit,
		targetCommit,
		filePath: relativeFilePath,
		isPcb: relativeFilePath.endsWith(".kicad_pcb"),
	});
}

export default function GithubControls(props) {
	const { githubToken, githubUser, onOpenAuthModal } = props;
	const formState = useGithubFormState(props);
	const onSubmit = () => handleDiffSubmit(props);

	if (!githubToken || !githubUser) {
		return <GithubPromptCard onOpenAuthModal={onOpenAuthModal} />;
	}

	return (
		<div style={{ width: "100%" }}>
			<GithubAccountBadge
				githubUser={githubUser}
				onOpenAuthModal={onOpenAuthModal}
			/>

			<GithubDiffForm
				controlsProps={props}
				formState={formState}
				handleSubmit={onSubmit}
			/>

			<RemoteCommitTrail baseCommits={formState.syncState.baseCommits} />
		</div>
	);
}
