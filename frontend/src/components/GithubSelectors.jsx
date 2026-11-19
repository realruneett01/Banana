import { Alert, Form, Input, Select, Spin, Tag } from "antd";
import { STYLES } from "./GithubControls.jsx";

const matchesFilter = (val, input) =>
	(val ?? "").toLowerCase().includes((input ?? "").toLowerCase());

const COMMIT_HASH_REGEX = /^[0-9a-fA-F]{7,40}$/;
const BRANCH_NAME_REGEX = /^[A-Za-z0-9._/-]{1,200}$/;

const isAbsolutePrefix = (p) => p.startsWith("/") || /^[a-zA-Z]:/.test(p);
const hasEscapeSegment = (p) => p.includes("\\") || p.split("/").includes("..");
const isPathTraversalOrAbsolute = (p) =>
	isAbsolutePrefix(p) || hasEscapeSegment(p);

function hasHardwareExtension(path) {
	return path.endsWith(".kicad_pcb") || path.endsWith(".kicad_sch");
}

export function isValidHardwareFilePath(path) {
	if (!path || typeof path !== "string") return false;
	const trimmed = path.trim();
	if (isPathTraversalOrAbsolute(trimmed)) return false;
	return hasHardwareExtension(trimmed);
}

function isValidBranchName(val) {
	if (!BRANCH_NAME_REGEX.test(val)) return false;
	return !val.startsWith("-") && !val.includes("..");
}

export function isValidCommitOrBranch(val) {
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

export const COMMIT_INPUT_RULES = makeValidationRule(
	"Please select a revision",
	isValidCommitOrBranch,
	"Must be a commit hash (7-40 hex) or branch name without .. or leading -",
);

export const HARDWARE_FILE_RULES = makeValidationRule(
	"Please select a hardware design file",
	isValidHardwareFilePath,
	"File path must be relative (.kicad_pcb or .kicad_sch) without backslashes or ..",
);

export function TaggedOptionRow({
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

export function FullWidthSearchSelect(props) {
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

export function PullRequestEmptyAlert() {
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

export function PullRequestOptionItem({ pr }) {
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

export function PullRequestSelectDropdown(props) {
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

export function PullRequestSelector(props) {
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

export function SelectFormField(props) {
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

export function BranchSelectField(props) {
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

export function CommitSelectFormItem(props) {
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

export function BranchPairSelectRow(props) {
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

export function CommitPairSelectSection(props) {
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

export const makeCommitSetter = (setCommit, form, fieldName) => (val) => {
	setCommit(val);
	form.setFieldValue(fieldName, val);
};

export function BranchCommitSelector(props) {
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

export function HardwareFileLabel({ loadingFiles }) {
	return (
		<div style={STYLES.labelRow}>
			<span style={STYLES.labelTitle}>
				CAD Hardware File (.kicad_pcb / .kicad_sch)
			</span>
			{loadingFiles && <Spin size="small" />}
		</div>
	);
}

export function HardwareFileOption({ file }) {
	return (
		<TaggedOptionRow
			label={file.path}
			mono
			tagColor={file.isPcb ? "gold" : "blue"}
			tagText={file.isPcb ? "PCB" : "SCH"}
		/>
	);
}

export function HardwareFileSelectDropdown(props) {
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

export function HardwareFileInputControl(props) {
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

export function HardwareFileInputPicker({ files, value, onChange }) {
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

export function HardwareFileSelector(props) {
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
