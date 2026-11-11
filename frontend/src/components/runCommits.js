import { useEffect, useState } from "react";

function extractSha(run) {
	const commit = run?.commit;
	if (typeof commit === "string" && commit.trim().length > 0) {
		return commit.trim();
	}
	const sha = run?.sha;
	if (typeof sha === "string" && sha.trim().length > 0) {
		return sha.trim();
	}
	return null;
}

export function commitsFromRuns(runs) {
	if (!Array.isArray(runs)) {
		return [];
	}
	const seen = new Set();
	const commits = [];
	for (const run of runs) {
		const sha = extractSha(run);
		if (sha && !seen.has(sha)) {
			seen.add(sha);
			commits.push({ sha });
		}
	}
	return commits;
}

function extractRunsFromResponse(res) {
	if (!res?.ok) {
		return [];
	}
	if (Array.isArray(res.data?.runs)) {
		return res.data.runs;
	}
	if (Array.isArray(res.data)) {
		return res.data;
	}
	return [];
}

async function loadRunsSafely(api, signal) {
	try {
		if (typeof api?.listRuns !== "function") {
			return [];
		}
		const res = await api.listRuns({}, { signal });
		const runs = extractRunsFromResponse(res);
		return commitsFromRuns(runs);
	} catch (_err) {
		// Broad catch to guarantee hook never throws on fetch or network error
		return [];
	}
}

export function useRunCommits({ api, open } = {}) {
	const [commits, setCommits] = useState([]);

	useEffect(() => {
		if (!open || typeof api?.listRuns !== "function") {
			setCommits([]);
			return;
		}

		let active = true;
		const controller = new AbortController();
		setCommits([]);

		loadRunsSafely(api, controller.signal)
			.then((items) => {
				if (active) {
					setCommits(items);
				}
			})
			.catch(() => {
				// Fallback safety to ensure commits is reset and hook never throws
				if (active) {
					setCommits([]);
				}
			});

		return () => {
			active = false;
			controller.abort();
		};
	}, [api, open]);

	return commits;
}
