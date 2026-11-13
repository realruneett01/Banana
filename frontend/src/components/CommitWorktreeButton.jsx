import { Alert, Button, Input, Modal, message } from "antd";
import { useState } from "react";
import { normalizeCommitMessage } from "../kicad/commitWorktree.js";
import { useKicadSaves } from "../kicad/useKicadSaves.js";

function useCommitDialog(saves) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [loading, setLoading] = useState(false);

	const submit = async () => {
		setLoading(true);
		const res = await saves.commitPending(text);
		setLoading(false);
		if (!res.ok) {
			message.error(res.error);
			return;
		}
		message.success(`Committed ${String(res.commit).slice(0, 7)}`);
		setText("");
		setOpen(false);
	};

	return { open, setOpen, text, setText, loading, submit };
}

function CommitDialog({ dialog, filePath }) {
	const canCommit = Boolean(normalizeCommitMessage(dialog.text));
	return (
		<Modal
			open={dialog.open}
			title={`Commit ${filePath}`}
			okText="Commit"
			onOk={dialog.submit}
			onCancel={() => dialog.setOpen(false)}
			confirmLoading={dialog.loading}
			okButtonProps={{ disabled: !canCommit }}
		>
			<Input.TextArea
				placeholder="Commit message (required)"
				value={dialog.text}
				onChange={(e) => dialog.setText(e.target.value)}
				maxLength={200}
				autoSize={{ minRows: 2 }}
			/>
		</Modal>
	);
}

export function CommitWorktreeButton({ repoPath, baseCommit, onWorktreeDiff }) {
	const saves = useKicadSaves({ repoPath, baseCommit, onWorktreeDiff });
	const dialog = useCommitDialog(saves);
	const filePath = saves.pending?.filePath;
	if (!filePath) return null;

	return (
		<>
			<Alert
				type="info"
				showIcon
				message={`Saved in KiCad: ${filePath} - showing uncommitted changes`}
				action={
					<Button type="primary" onClick={() => dialog.setOpen(true)}>
						Commit changes
					</Button>
				}
			/>
			<CommitDialog dialog={dialog} filePath={filePath} />
		</>
	);
}

export default CommitWorktreeButton;
