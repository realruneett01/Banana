/**
 * Input validation for values that end up in git argv, filesystem paths or
 * GitHub API URLs. Everything user-supplied goes through here first.
 */

const SAFE_REF = /^[A-Za-z0-9@_][A-Za-z0-9._/@^~{}+-]*$/;
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * A git ref/sha that cannot be mistaken for a command-line option and
 * contains no range or revision-expression separators we do not build ourselves.
 * @param {unknown} ref
 * @returns {boolean}
 */
export function isSafeRef(ref) {
	return (
		typeof ref === "string" &&
		ref.length > 0 &&
		ref.length <= 255 &&
		SAFE_REF.test(ref) &&
		!ref.includes("..") &&
		!ref.endsWith("/") &&
		!ref.endsWith(".lock")
	);
}

export function assertSafeRef(ref, label = "ref") {
	if (!isSafeRef(ref)) {
		const err = new Error(
			`Invalid git ${label}: ${JSON.stringify(String(ref).slice(0, 80))}`,
		);
		err.statusCode = 400;
		throw err;
	}
	return ref;
}

/**
 * A repository-relative path: no NUL/control chars, not absolute, no `..` segment.
 * @param {unknown} p
 * @returns {boolean}
 */
export function isSafeRelativePath(p) {
	if (typeof p !== "string" || p.length === 0 || p.length > 4096) return false;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
	if (/[\u0000-\u001f]/.test(p)) return false;
	if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p))
		return false;
	return !p.split(/[/\\]/).some((seg) => seg === "..");
}

export function assertSafeRelativePath(p, label = "file path") {
	if (!isSafeRelativePath(p)) {
		const err = new Error(
			`Invalid ${label}: ${JSON.stringify(String(p).slice(0, 80))}`,
		);
		err.statusCode = 400;
		throw err;
	}
	return p;
}

/** GitHub owner/repo names. */
export function isSafeGithubName(name) {
	return (
		typeof name === "string" &&
		name !== "." &&
		name !== ".." &&
		GITHUB_NAME.test(name)
	);
}

export function assertSafeGithubName(name, label = "name") {
	if (!isSafeGithubName(name)) {
		const err = new Error(`Invalid GitHub ${label}`);
		err.statusCode = 400;
		throw err;
	}
	return name;
}

/** Encodes each segment of a repo-relative path for use inside a URL path. */
export function encodePathSegments(p) {
	return p
		.split(/[/\\]/)
		.map((s) => encodeURIComponent(s))
		.join("/");
}
