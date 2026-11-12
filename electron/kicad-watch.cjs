const fs = require("node:fs");
const path = require("node:path");

function isIgnoredFile(name) {
	if (name.startsWith("~") || name.startsWith("_autosave")) {
		return true;
	}
	return name.endsWith(".lck") || name.endsWith("-bak");
}

function isRelevantKicadFile(filename) {
	if (!filename || typeof filename !== "string") {
		return false;
	}
	const base = path.basename(filename);
	if (isIgnoredFile(base)) {
		return false;
	}
	return base.endsWith(".kicad_sch") || base.endsWith(".kicad_pcb");
}

function createKicadWatcher({
	watch = fs.watch,
	debounceMs = 600,
	onChange,
} = {}) {
	let currentWatcher = null;
	const timers = new Map();

	function stop() {
		for (const timer of timers.values()) {
			clearTimeout(timer);
		}
		timers.clear();
		if (currentWatcher) {
			try {
				currentWatcher.close();
			} catch {
				// Watch errors caught and closed silently
			}
			currentWatcher = null;
		}
	}

	function scheduleChange(projectRoot, filename) {
		const existing = timers.get(filename);
		if (existing) {
			clearTimeout(existing);
		}
		const timer = setTimeout(() => {
			timers.delete(filename);
			if (typeof onChange === "function") {
				onChange({ projectRoot, filePath: filename });
			}
		}, debounceMs);
		if (typeof timer?.unref === "function") {
			timer.unref();
		}
		timers.set(filename, timer);
	}

	function handleWatchEvent(projectRoot, filename) {
		if (!isRelevantKicadFile(filename)) {
			return;
		}
		scheduleChange(projectRoot, filename);
	}

	function watchProject(projectRoot) {
		stop();
		if (!projectRoot || typeof projectRoot !== "string") {
			return;
		}
		try {
			currentWatcher = watch(
				projectRoot,
				{ recursive: false },
				(_eventType, filename) => {
					handleWatchEvent(projectRoot, filename);
				},
			);
			if (currentWatcher && typeof currentWatcher.on === "function") {
				currentWatcher.on("error", () => {
					stop();
				});
			}
		} catch {
			// Watch errors caught and stop the watch silently
			stop();
		}
	}

	return {
		watchProject,
		stop,
	};
}

module.exports = {
	createKicadWatcher,
};
