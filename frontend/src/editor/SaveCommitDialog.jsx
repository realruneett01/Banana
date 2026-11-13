import { Alert, Input, Modal, message, Space } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { editsFromIrChange } from "./kicadEdits.js";

const CONTENT_STYLE = Object.freeze({
	width: "100%",
	paddingTop: "8px",
});

const LIST_STYLE = Object.freeze({
	margin: 0,
	paddingLeft: 20,
});

function buildCommitFiles(repo, sch, pcb) {
	const files = [];
	if (repo?.schPath && sch?.length > 0) {
		files.push({ path: repo.schPath, kind: "sch", edits: sch });
	}
	if (repo?.pcbPath && pcb?.length > 0) {
		files.push({ path: repo.pcbPath, kind: "pcb", edits: pcb });
	}
	return files;
}

function notifyCommitSuccess({ res, onCommitted, onClose }) {
	const shortHash = String(res?.data?.commit ?? "").slice(0, 7);
	message.success(shortHash);
	onCommitted?.(res?.data);
	onClose?.();
}

function canCommit({ canSaveInPlace, repo, messageText }) {
	if (!canSaveInPlace) return false;
	if (!repo?.repoPath) return false;
	if (!repo?.schPath && !repo?.pcbPath) return false;
	return Boolean(messageText?.trim());
}

async function performCommit({ api, repo, edits, messageText }) {
	const files = buildCommitFiles(repo, edits?.sch, edits?.pcb);
	const payload = {
		repoPath: repo?.repoPath,
		files,
		message: messageText.trim(),
	};
	return await api?.editorCommit(payload);
}

async function executeCommit(options) {
	const {
		api,
		repo,
		edits,
		messageText,
		onCommitted,
		onClose,
		setErrorText,
		setLoading,
	} = options;
	setLoading(true);
	setErrorText("");
	try {
		const res = await performCommit({ api, repo, edits, messageText });
		if (res?.ok) {
			notifyCommitSuccess({ res, onCommitted, onClose });
			return;
		}
		setErrorText(res?.error || "Commit failed");
	} catch (err) {
		setErrorText(err?.message || "Commit failed");
	} finally {
		setLoading(false);
	}
}

function UnsupportedAlert({ unsupported }) {
	if (!unsupported || unsupported.length === 0) {
		return null;
	}
	return (
		<Alert
			type="warning"
			showIcon
			message="These changes cannot be written into the existing files yet and Export KiCad files can be used instead."
			description={
				<ul style={LIST_STYLE}>
					{unsupported.map((sentence) => (
						<li key={sentence}>{sentence}</li>
					))}
				</ul>
			}
		/>
	);
}

function MissingFolderAlert({ repo }) {
	const hasRepoPath = Boolean(repo?.repoPath);
	const hasTargetPath = Boolean(repo?.schPath || repo?.pcbPath);
	if (hasRepoPath && hasTargetPath) {
		return null;
	}
	return (
		<Alert
			type="info"
			showIcon
			message="A local project folder must be opened first."
		/>
	);
}

function CommitErrorAlert({ errorText }) {
	if (!errorText) {
		return null;
	}
	return <Alert type="error" showIcon message={errorText} />;
}

function CommitMessageInput({ value, onChange }) {
	return (
		<Input.TextArea
			rows={3}
			maxLength={200}
			showCount
			required
			value={value}
			onChange={onChange}
			placeholder="Commit message"
		/>
	);
}

function runExecution(options, edits, commitMessage, setErrorText, setLoading) {
	executeCommit({
		...options,
		edits,
		messageText: commitMessage,
		setErrorText,
		setLoading,
	});
}

function useCommitMessageSync(open, summary, setCommitMessage, setErrorText) {
	useEffect(() => {
		if (open) {
			setCommitMessage(summary || "");
			setErrorText("");
		}
	}, [open, summary, setCommitMessage, setErrorText]);
}

function useSaveCommit(options) {
	const { beforeIr, afterIr, beforeBoard, afterBoard, open } = options;
	const edits = useMemo(
		() =>
			editsFromIrChange(beforeIr, afterIr, {
				before: beforeBoard,
				after: afterBoard,
			}),
		[beforeIr, afterIr, beforeBoard, afterBoard],
	);
	const [commitMessage, setCommitMessage] = useState(edits.summary || "");
	const [loading, setLoading] = useState(false);
	const [errorText, setErrorText] = useState("");
	useCommitMessageSync(open, edits.summary, setCommitMessage, setErrorText);

	const handleOk = useCallback(
		() => runExecution(options, edits, commitMessage, setErrorText, setLoading),
		[options, edits, commitMessage],
	);

	return {
		edits,
		commitMessage,
		setCommitMessage,
		loading,
		errorText,
		handleOk,
	};
}

function SaveCommitBody(props) {
	const { edits, repo, errorText, commitMessage, onChangeMessage } = props;
	return (
		<Space orientation="vertical" style={CONTENT_STYLE} size="middle">
			<p>{edits.summary}</p>
			<UnsupportedAlert unsupported={edits.unsupported} />
			<MissingFolderAlert repo={repo} />
			<CommitErrorAlert errorText={errorText} />
			<CommitMessageInput value={commitMessage} onChange={onChangeMessage} />
		</Space>
	);
}

function isCommitDisabled(edits, repo, state) {
	if (state.loading) return true;
	return !canCommit({
		canSaveInPlace: edits.canSaveInPlace,
		repo,
		messageText: state.commitMessage,
	});
}

export default function SaveCommitDialog(props) {
	const { open, onClose, repo } = props;
	const state = useSaveCommit(props);
	const okDisabled = isCommitDisabled(state.edits, repo, state);

	return (
		<Modal
			open={open}
			title="Save to KiCad files and commit"
			okText="Save and commit"
			onOk={state.handleOk}
			onCancel={onClose}
			confirmLoading={state.loading}
			okButtonProps={{ disabled: okDisabled }}
		>
			<SaveCommitBody
				edits={state.edits}
				repo={repo}
				errorText={state.errorText}
				commitMessage={state.commitMessage}
				onChangeMessage={(e) => state.setCommitMessage(e.target.value)}
			/>
		</Modal>
	);
}
