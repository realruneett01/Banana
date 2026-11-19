const bus = new EventTarget();
const COMMIT_CREATED_EVENT = "banana:commit-created";

function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

export function emitCommitCreated(payload = {}) {
	const { repoPath, filePath, commit } = payload ?? {};
	if (!isNonEmptyString(repoPath) || !isNonEmptyString(commit)) {
		return;
	}
	const detail = { repoPath, filePath, commit };
	bus.dispatchEvent(new CustomEvent(COMMIT_CREATED_EVENT, { detail }));
}

export function onCommitCreated(handler) {
	const listener = (event) => {
		handler?.(event.detail);
	};
	bus.addEventListener(COMMIT_CREATED_EVENT, listener);
	return () => {
		bus.removeEventListener(COMMIT_CREATED_EVENT, listener);
	};
}
