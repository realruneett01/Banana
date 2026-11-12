import { Alert, Button, Input, message, Space } from "antd";
import { useCallback, useState } from "react";

function notifyCommitResult(res, setMessageText) {
	if (res?.ok) {
		const shortSha = String(res?.commit ?? "").slice(0, 7);
		message.success(shortSha);
		setMessageText("");
		return;
	}
	message.error(res?.error || "Commit failed");
}

async function handleCommitAction({
	saves,
	messageText,
	setLoading,
	setMessageText,
}) {
	const trimmed = messageText.trim();
	if (!trimmed) return;
	setLoading(true);
	try {
		const res = await saves.commitPending(trimmed);
		notifyCommitResult(res, setMessageText);
	} catch (err) {
		// UI message error reporting
		message.error(err?.message || "Commit failed");
	} finally {
		setLoading(false);
	}
}

function CommitButtons({ loading, canCommit, onCommit, onDismiss }) {
	return (
		<>
			<Button
				type="primary"
				disabled={!canCommit}
				loading={loading}
				onClick={onCommit}
			>
				Commit
			</Button>
			<Button disabled={loading} onClick={onDismiss}>
				Dismiss
			</Button>
		</>
	);
}

function SaveBarActions({ state }) {
	const { messageText, setMessageText, loading, onCommit, onDismiss } = state;
	const trimmed = messageText.trim();
	const canCommit = Boolean(trimmed) && !loading;
	return (
		<Space>
			<Input
				placeholder="Commit message"
				value={messageText}
				onChange={(e) => setMessageText(e.target.value)}
				onPressEnter={canCommit ? onCommit : undefined}
				maxLength={200}
				disabled={loading}
			/>
			<CommitButtons
				loading={loading}
				canCommit={canCommit}
				onCommit={onCommit}
				onDismiss={onDismiss}
			/>
		</Space>
	);
}

function useSaveBarState(saves, filePath) {
	const [messageText, setMessageText] = useState("");
	const [loading, setLoading] = useState(false);
	const [prevFilePath, setPrevFilePath] = useState(filePath);

	if (filePath !== prevFilePath) {
		setPrevFilePath(filePath);
		setMessageText("");
	}

	const onCommit = useCallback(() => {
		handleCommitAction({ saves, messageText, setLoading, setMessageText });
	}, [saves, messageText]);

	const onDismiss = useCallback(() => {
		saves?.dismiss?.();
		setMessageText("");
	}, [saves]);

	return { messageText, setMessageText, loading, onCommit, onDismiss };
}

export function KicadSaveBar({ saves }) {
	const filePath = saves?.pending?.filePath;
	const barState = useSaveBarState(saves, filePath);

	if (!filePath) return null;

	return (
		<Alert
			type="info"
			showIcon
			message={`Saved in KiCad: ${filePath} - showing uncommitted changes`}
			action={<SaveBarActions state={barState} />}
		/>
	);
}

export default KicadSaveBar;
