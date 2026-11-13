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

const DARK_BORDER = "#232738";
const YELLOW_ACCENT = "#fadb14";
const MUTED_GRAY = "#8b949e";

const BANANA_BUTTON_STYLE = Object.freeze({
	background: "linear-gradient(135deg, #fadb14 0%, #faad14 100%)",
	color: "#000",
	fontWeight: 600,
	border: "none",
});

const FLEX_ALIGN_CENTER = Object.freeze({
	display: "flex",
	alignItems: "center",
});

const FLEX_ROW_BETWEEN = Object.freeze({
	...FLEX_ALIGN_CENTER,
	justifyContent: "space-between",
});

const DARK_SURFACE = Object.freeze({
	background: "#0f1015",
	borderColor: DARK_BORDER,
});

const makeFlexCenter = (isInline = false) => ({
	display: isInline ? "inline-flex" : "flex",
	alignItems: "center",
	justifyContent: "center",
});

const mutedLabel = (marginBottom) => ({
	fontSize: "11px",
	color: MUTED_GRAY,
	display: "block",
	marginBottom,
});

const STYLES = Object.freeze({
	cardPrompt: {
		background: "linear-gradient(180deg, #161821 0%, #0f1015 100%)",
		borderColor: DARK_BORDER,
		borderRadius: "8px",
		textAlign: "center",
		padding: "16px 8px",
	},
	githubIconCircle: {
		...makeFlexCenter(true),
		width: 48,
		height: 48,
		borderRadius: "50%",
		background: "#24292e",
		marginBottom: "12px",
		border: `2px solid ${YELLOW_ACCENT}`,
	},
	mutedBlock: mutedLabel("16px"),
	accountBadge: {
		...FLEX_ROW_BETWEEN,
		...DARK_SURFACE,
		border: `1px solid ${DARK_BORDER}`,
		borderRadius: "6px",
		padding: "8px 12px",
		marginBottom: "14px",
	},
	avatarImg: {
		width: 22,
		height: 22,
		borderRadius: "50%",
		border: `1px solid ${YELLOW_ACCENT}`,
	},
	yellowLink: {
		color: YELLOW_ACCENT,
		fontSize: "11px",
		padding: 0,
	},
	rowBetween: FLEX_ROW_BETWEEN,
	labelRow: {
		...FLEX_ROW_BETWEEN,
		width: "100%",
	},
	labelTitle: {
		color: "#e2e8f0",
		fontSize: "12px",
		fontWeight: 600,
	},
	inputDark: {
		...DARK_SURFACE,
		color: "#fff",
	},
	alertInfo: {
		...DARK_SURFACE,
		fontSize: "11px",
	},
	miniTag: {
		fontSize: "10px",
		padding: "0 4px",
		margin: 0,
	},
	commitTrailContainer: {
		borderTop: `1px solid ${DARK_BORDER}`,
		paddingTop: "16px",
		marginTop: "16px",
	},
	commitTrailTitle: {
		...FLEX_ALIGN_CENTER,
		color: YELLOW_ACCENT,
		gap: "8px",
		marginBottom: "12px",
		fontSize: "13px",
	},
	commitTrailScroll: {
		maxHeight: "180px",
		overflowY: "auto",
		paddingRight: "4px",
	},
	targetLabel: mutedLabel("6px"),
});

const matchesFilter = (val, input) =>
	(val ?? "").toLowerCase().includes((input ?? "").toLowerCase());

const REPO_PART_REGEX = /^[A-Za-z0-9_.-]{1,100}$/;
const COMMIT_HASH_REGEX = /^[0-9a-fA-F]{7,40}$/;
const BRANCH_NAME_REGEX = /^[A-Za-z0-9._/-]{1,200}$/;

function isValidRepoPart(part) {
	if (!part || !REPO_PART_REGEX.test(part)) return false;
	return part !== "." && part !== "..";
}

const isAbsolutePrefix = (p) => p.startsWith("/") || /^[a-zA-Z]:/.test(p);
const hasEscapeSegment = (p) => p.includes("\\") || p.split("/").includes("..");
const isPathTraversalOrAbsolute = (p) =>
	isAbsolutePrefix(p) || hasEscapeSegment(p);

function hasHardwareExtension(path) {
	return path.endsWith(".kicad_pcb") || path.endsWith(".kicad_sch");
}

function isValidHardwareFilePath(path) {
	if (!path || typeof path !== "string") return false;
	const trimmed = path.trim();
	if (isPathTraversalOrAbsolute(trimmed)) return false;
	return hasHardwareExtension(trimmed);
}

function isValidBranchName(val) {
	if (!BRANCH_NAME_REGEX.test(val)) return false;
	return !val.startsWith("-") && !val.includes("..");
}

function isValidCommitOrBranch(val) {
	if (!val || typeof val !== "string") return false;
	const trimmed = val.trim();
	if (COMMIT_HASH_REGEX.test(trimmed)) return true;
	return isValidBranchName(trimmed);
}

const makeValidationRule = (reqMsg, isValid, errMsg) =>
	Object.freeze([
		{ required: true, message: reqMsg },
		{
			validator(_, value) {
				return !value || isValid(value)
					? Promise.resolve()
					: Promise.reject(new Error(errMsg));
			},
		},
	]);

const COMMIT_INPUT_RULES = makeValidationRule(
	"Please select a revision",
	isValidCommitOrBranch,
	"Must be a commit hash (7-40 hex) or branch name without .. or leading -",
);

const HARDWARE_FILE_RULES = makeValidationRule(
	"Please select a hardware design file",
	isValidHardwareFilePath,
	"File path must be relative (.kicad_pcb or .kicad_sch) without backslashes or ..",
);

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

function TaggedOptionRow({
	label,
	extraLabel,
	tagColor,
	tagIcon,
	tagText,
	mono,
}) {
	const textStyle = mono
		? { fontFamily: "monospace", fontSize: "11px" }
		: { fontWeight: 500 };
	return (
		<div style={STYLES.rowBetween}>
			<span style={textStyle}>
				{label}
				{extraLabel && (
					<span
						style={{ color: "#6b7280", fontSize: "11px", marginLeft: "4px" }}
					>
						{extraLabel}
					</span>
				)}
			</span>
			<Tag color={tagColor} icon={tagIcon} style={STYLES.miniTag}>
				{tagText}
			</Tag>
		</div>
	);
}

function RepoOptionItem({ repo }) {
	return (
		<TaggedOptionRow
			label={repo.name}
			extraLabel={`(${repo.owner})`}
			tagColor={repo.isPrivate ? "warning" : "default"}
			tagIcon={repo.isPrivate ? <LockOutlined /> : <GlobalOutlined />}
			tagText={repo.isPrivate ? "Private" : "Public"}
		/>
	);
}

function RepoSelectorLabel({
	loadingRepos,
	onRefreshRepos,
	manualRepoMode,
	setManualRepoMode,
}) {
	const toggleText = manualRepoMode ? "Select from list" : "Custom repo";
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
					{toggleText}
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

function FullWidthSearchSelect(props) {
	const { placeholder, loading, value, onChange, filterField, children } =
		props;
	const filterOption = filterField
		? (input, option) => matchesFilter(option?.[filterField], input)
		: undefined;
	return (
		<Select
			showSearch
			placeholder={placeholder}
			loading={loading}
			value={value}
			onChange={onChange}
			filterOption={filterOption}
			style={{ width: "100%" }}
		>
			{children}
		</Select>
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
		<FullWidthSearchSelect
			placeholder="Search repositories..."
			loading={loadingRepos}
			value={selectedValue}
			onChange={handleChange}
			filterField="value"
		>
			{repos.map((r) => {
				const full = `${r.owner}/${r.name}`;
				return (
					<Select.Option key={r.id || full} value={full}>
						<RepoOptionItem repo={r} />
					</Select.Option>
				);
			})}
		</FullWidthSearchSelect>
	);
}

function RepoSelectorInputPicker(props) {
	if (props.manualRepoMode) {
		return (
			<ManualRepoInputControl
				value={props.manualRepoInput}
				onChange={props.setManualRepoInput}
				onSubmit={props.onManualRepoSubmit}
			/>
		);
	}
	return <RepoSelectDropdown {...props} />;
}

function RepoSelector(props) {
	return (
		<Form.Item
			label={<RepoSelectorLabel {...props} />}
			style={{ marginBottom: "12px" }}
		>
			<RepoSelectorInputPicker {...props} />
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
		<FullWidthSearchSelect
			placeholder="Select Pull Request..."
			loading={loading}
			value={selectedNumber}
			onChange={onSelect}
			filterField="label"
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
		</FullWidthSearchSelect>
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

function SelectFormField(props) {
	const {
		label,
		name,
		rules,
		marginBottom = "8px",
		placeholder,
		value,
		loading,
		onChange,
		options,
	} = props;

	return (
		<Form.Item label={label} name={name} rules={rules} style={{ marginBottom }}>
			<Select
				showSearch
				placeholder={placeholder}
				value={value}
				loading={loading}
				onChange={onChange}
			>
				{options.map((opt) => (
					<Select.Option key={opt.key} value={opt.value}>
						{opt.label}
					</Select.Option>
				))}
			</Select>
		</Form.Item>
	);
}

function BranchSelectField(props) {
	const { label, placeholder, value, loading, branches, onChange, keyPrefix } =
		props;
	const options = branches.map((b) => ({
		key: `${keyPrefix}-${b.name}`,
		value: b.name,
		label: b.name,
	}));
	return (
		<SelectFormField
			label={label}
			placeholder={placeholder}
			value={value}
			loading={loading}
			onChange={onChange}
			options={options}
		/>
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
		name,
		rules,
	} = props;
	const options = commits.map((c) => ({
		key: `${keyPrefix}-${c.hash}`,
		value: c.hash,
		label: `${c.shortHash} - ${c.message} (${c.author})`,
	}));
	return (
		<SelectFormField
			label={label}
			name={name}
			rules={rules}
			marginBottom={marginBottom}
			placeholder={placeholder}
			value={value}
			loading={loading}
			onChange={onChange}
			options={options}
		/>
	);
}

function BranchPairSelectRow(props) {
	const { branches, loading, baseBranch, onBase, targetBranch, onTarget } =
		props;
	const pairs = [
		{ label: "Base Branch", val: baseBranch, onChange: onBase, prefix: "base" },
		{
			label: "Target Branch",
			val: targetBranch,
			onChange: onTarget,
			prefix: "tgt",
		},
	];
	return (
		<div
			style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}
		>
			{pairs.map((p) => (
				<BranchSelectField
					key={p.prefix}
					label={p.label}
					placeholder={p.label}
					value={p.val}
					loading={loading}
					branches={branches}
					onChange={p.onChange}
					keyPrefix={p.prefix}
				/>
			))}
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
	const configs = [
		{
			label: "Base Commit",
			name: "baseCommit",
			value: baseCommit,
			commits: baseCommits,
			keyPrefix: "base",
			onChange: onBase,
			marginBottom: "8px",
		},
		{
			label: "Target Commit",
			name: "targetCommit",
			value: targetCommit,
			commits: targetCommits,
			keyPrefix: "tgt",
			onChange: onTarget,
			marginBottom: "12px",
		},
	];
	return (
		<>
			{configs.map((cfg) => (
				<CommitSelectFormItem
					key={cfg.keyPrefix}
					rules={COMMIT_INPUT_RULES}
					placeholder={`Select ${cfg.label.toLowerCase()}...`}
					loading={loading}
					{...cfg}
				/>
			))}
		</>
	);
}

const makeCommitSetter = (setCommit, form, fieldName) => (val) => {
	setCommit(val);
	form.setFieldValue(fieldName, val);
};

function BranchCommitSelector(props) {
	const { setBaseCommit, setTargetCommit, form } = props;
	const onBase = makeCommitSetter(setBaseCommit, form, "baseCommit");
	const onTarget = makeCommitSetter(setTargetCommit, form, "targetCommit");

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
		<TaggedOptionRow
			label={file.path}
			mono
			tagColor={file.isPcb ? "gold" : "blue"}
			tagText={file.isPcb ? "PCB" : "SCH"}
		/>
	);
}

function HardwareFileSelectDropdown(props) {
	const { files, value, onChange } = props;
	return (
		<FullWidthSearchSelect
			placeholder="Select hardware design file..."
			value={value}
			onChange={onChange}
		>
			{files.map((f) => (
				<Select.Option key={f.path} value={f.path}>
					<HardwareFileOption file={f} />
				</Select.Option>
			))}
		</FullWidthSearchSelect>
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

function HardwareFileInputPicker({ files, value, onChange }) {
	if (files.length === 0) {
		return <HardwareFileInputControl value={value} onChange={onChange} />;
	}
	return (
		<HardwareFileSelectDropdown
			files={files}
			value={value}
			onChange={onChange}
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
			name="relativeFilePath"
			rules={HARDWARE_FILE_RULES}
			style={{ marginBottom: "16px" }}
		>
			<HardwareFileInputPicker
				files={hardwareFiles}
				value={relativeFilePath}
				onChange={handleFileChange}
			/>
		</Form.Item>
	);
}

function CommitTimelineItemContent({ commit }) {
	const formattedDate = commit.date
		? new Date(commit.date).toLocaleDateString()
		: "";
	return (
		<div style={{ fontSize: "11px", color: "#a6adbb" }}>
			<div style={STYLES.rowBetween}>
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

const SUBMISSION_VALIDATORS = Object.freeze([
	{
		test: (opts) => !opts.selectedRepo,
		msg: "Please select a repository",
	},
	{
		test: (opts) => !opts.baseCommit || !opts.targetCommit,
		msg: "Please select base and target revisions",
	},
	{
		test: (opts) =>
			!isValidCommitOrBranch(opts.baseCommit) ||
			!isValidCommitOrBranch(opts.targetCommit),
		msg: "Must be a commit hash (7-40 hex) or branch name without .. or leading -",
	},
	{
		test: (opts) => !opts.relativeFilePath,
		msg: "Please select a hardware design file",
	},
	{
		test: (opts) => !isValidHardwareFilePath(opts.relativeFilePath),
		msg: "File path must be relative (.kicad_pcb or .kicad_sch) without backslashes or ..",
	},
]);

function validateGithubSubmission(options) {
	const failure = SUBMISSION_VALIDATORS.find((rule) => rule.test(options));
	if (failure) {
		message.error(failure.msg);
		return false;
	}
	return true;
}

const areRepoPartsValid = (parts) =>
	parts.length === 2 && parts.every(isValidRepoPart);

function parseManualRepoString(input) {
	const trimmed = (input ?? "").trim();
	const parts = trimmed.split("/");
	if (!areRepoPartsValid(parts)) {
		message.error(
			"Format must be owner/repository (e.g. OLIMEX/OLIMEXINO-328)",
		);
		return null;
	}
	const [owner, name] = parts;
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

const getFormInitialValues = (props) => ({
	baseCommit: props.baseCommit,
	targetCommit: props.targetCommit,
	relativeFilePath: props.relativeFilePath,
});

function GithubDiffForm({ controlsProps, formState, handleSubmit }) {
	const { form, compareMode, setCompareMode, syncState } = formState;

	return (
		<Form
			form={form}
			layout="vertical"
			onFinish={handleSubmit}
			initialValues={getFormInitialValues(controlsProps)}
		>
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
