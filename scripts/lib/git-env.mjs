import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let emptyConfig = null;

/**
 * Path git can use as "no configuration file". `os.devNull` works for git on Unix, but Git for Windows rejects
 * `\\.\nul` ("unable to access '//./nul'"), so Windows gets a real empty file instead.
 */
export function emptyGitConfigPath() {
	if (os.platform() !== "win32") return os.devNull;
	if (!emptyConfig || !fs.existsSync(emptyConfig)) {
		emptyConfig = path.join(
			os.tmpdir(),
			`banana-empty-gitconfig-${process.pid}`,
		);
		fs.writeFileSync(emptyConfig, "");
	}
	return emptyConfig;
}

/** Environment that makes git ignore the user's and the system's configuration. */
export function isolatedGitEnv(base = process.env) {
	const none = emptyGitConfigPath();
	return { ...base, GIT_CONFIG_GLOBAL: none, GIT_CONFIG_SYSTEM: none };
}
