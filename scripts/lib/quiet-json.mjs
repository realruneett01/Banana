// Imported first by CLIs that print machine-readable output: in --json mode, library log lines go to stderr.
if (process.argv.includes("--json")) {
	console.log = (...args) => console.error(...args);
	console.info = (...args) => console.error(...args);
}
