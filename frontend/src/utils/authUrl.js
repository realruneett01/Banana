/**
 * Reads the GitHub login result from the URL. The backend returns it in the fragment
 * (#github_token=...), which is never sent to a server; the query string is still read
 * so links issued by an older backend keep working.
 */
export function parseAuthParams(hash, search) {
	const fromHash = new URLSearchParams(String(hash || "").replace(/^#/, ""));
	const fromSearch = new URLSearchParams(String(search || ""));
	const pick = (k) => fromHash.get(k) || fromSearch.get(k) || null;
	return { token: pick("github_token"), error: pick("github_error") };
}

/** The current location without the login parameters, preserving any other query parameters. */
export function cleanAuthUrl(pathname, search) {
	const params = new URLSearchParams(String(search || ""));
	params.delete("github_token");
	params.delete("github_error");
	const rest = params.toString();
	return rest ? `${pathname}?${rest}` : pathname;
}
