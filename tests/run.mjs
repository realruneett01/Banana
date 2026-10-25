// Cross-version test runner (Node 20/22/24): lists test files explicitly instead of relying on glob support.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
	.readdirSync(dir)
	.filter((f) => f.endsWith(".test.js"))
	.sort()
	.map((f) => path.join(dir, f));
const extra = process.argv.slice(2);
const res = spawnSync(
	process.execPath,
	["--test", "--test-concurrency=4", ...extra, ...files],
	{ stdio: "inherit" },
);
process.exit(res.status ?? 1);
