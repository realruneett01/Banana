#!/usr/bin/env node
/**
 * Manage Banana accounts (used when BANANA_AUTH=required).
 *   npm run user -- add <name> [--admin]      prompts for the password
 *   npm run user -- passwd <name>
 *   npm run user -- disable|enable|remove <name>
 *   npm run user -- list
 * Non-interactive: pipe the password on stdin and add --password-stdin.
 */
import path from "node:path";
import readline from "node:readline";
import { UserStore } from "../backend/src/auth/user-store.js";
import { APP_ROOT } from "../backend/src/runtime-detect.js";

const dataDir = path.resolve(
	process.env.BANANA_DATA_DIR || path.join(APP_ROOT, ".banana"),
);
const store = new UserStore(path.join(dataDir, "users.json"));

function readPassword(prompt) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			terminal: true,
		});
		const origWrite = rl._writeToOutput;
		rl._writeToOutput = (s) => {
			if (s.startsWith(prompt)) origWrite.call(rl, s);
		};
		rl.question(prompt, (answer) => {
			rl.close();
			process.stdout.write("\n");
			resolve(answer);
		});
	});
}

async function readStdin() {
	let data = "";
	for await (const chunk of process.stdin) data += chunk;
	return data.replace(/\r?\n$/, "");
}

async function newPassword(args) {
	if (args.includes("--password-stdin")) return readStdin();
	const a = await readPassword("Password: ");
	const b = await readPassword("Repeat password: ");
	if (a !== b) throw new Error("Passwords do not match");
	return a;
}

async function main() {
	const [cmd, name, ...rest] = process.argv.slice(2);
	const args = [name, ...rest].filter(Boolean);
	switch (cmd) {
		case "add":
			await store.create(
				name,
				await newPassword(args),
				args.includes("--admin") ? "admin" : "user",
			);
			console.log(
				`Created ${args.includes("--admin") ? "admin" : "user"} "${name}".`,
			);
			break;
		case "passwd":
			await store.setPassword(name, await newPassword(args));
			console.log(
				`Password changed for "${name}". Existing sessions were signed out.`,
			);
			break;
		case "disable":
		case "enable":
			store.setDisabled(name, cmd === "disable");
			console.log(`${cmd === "disable" ? "Disabled" : "Enabled"} "${name}".`);
			break;
		case "remove":
			store.remove(name);
			console.log(`Removed "${name}".`);
			break;
		case "list": {
			const rows = store.list();
			if (rows.length === 0) console.log("No accounts.");
			for (const u of rows)
				console.log(
					`${u.username.padEnd(24)} ${u.role.padEnd(6)} ${u.disabled ? "disabled" : "active"}  ${u.createdAt}`,
				);
			break;
		}
		default:
			console.log(
				"Usage: npm run user -- add|passwd|disable|enable|remove <name> [--admin] [--password-stdin]\n       npm run user -- list",
			);
			process.exit(cmd ? 1 : 0);
	}
}

main().catch((err) => {
	console.error(`Error: ${err.message}`);
	process.exit(1);
});
