/**
 * Hierarchical sheet navigation utilities for schematic editor.
 * Pure functional state management for sheet hierarchy stack and tree traversal.
 */

export function createNavState(rootName = "Root") {
	const name = rootName || "Root";
	return {
		stack: [
			{
				name,
				file: "",
				path: `/${name}`,
			},
		],
	};
}

export function enterSheet(state, sheet) {
	const currentStack = state?.stack ?? [];
	const current = currentStack[currentStack.length - 1];
	const name = sheet?.name || "Sheet";
	const file = sheet?.file || "";
	const parentPath = current ? current.path : "";
	const path = parentPath ? `${parentPath}/${name}` : `/${name}`;
	const item = {
		name,
		file,
		path,
		...(sheet?.id ? { id: sheet.id } : {}),
	};
	return {
		...state,
		stack: [...currentStack, item],
	};
}

export function leaveSheet(state) {
	if (!state?.stack || state.stack.length <= 1) {
		return state ?? createNavState();
	}
	return {
		...state,
		stack: state.stack.slice(0, -1),
	};
}

export function jumpTo(state, index) {
	if (!state?.stack || state.stack.length === 0) {
		return state ?? createNavState();
	}
	const maxIdx = state.stack.length - 1;
	const safeIdx = Math.max(0, Math.min(index, maxIdx));
	return {
		...state,
		stack: state.stack.slice(0, safeIdx + 1),
	};
}

export function breadcrumb(state) {
	if (!state?.stack) return [];
	return state.stack.map((item, index) => ({
		label: item.name || "Root",
		index,
	}));
}

function resolveSubIr(loadIr, file, sheet) {
	if (typeof loadIr === "function") {
		return loadIr(file, sheet);
	}
	if (loadIr && typeof loadIr === "object") {
		return loadIr[file] ?? null;
	}
	return null;
}

function shouldSkipRecursion(file, subIr, ctx) {
	if (ctx.depth >= 16) return true;
	if (!file || ctx.visitedFiles.has(file)) return true;
	if (!subIr || ctx.visitedIrs.has(subIr)) return true;
	return false;
}

function buildChildren(subIr, path, ctx) {
	const rawSheets = Array.isArray(subIr?.sheets) ? subIr.sheets : [];
	return rawSheets.map((child) =>
		buildChildNode(child, path, {
			...ctx,
			depth: ctx.depth + 1,
		}),
	);
}

function buildChildNode(sheet, parentPath, ctx) {
	const name = sheet?.name || sheet?.id || "Sheet";
	const file = sheet?.file || "";
	const path = `${parentPath}/${name}`;
	const node = {
		id: sheet?.id || path,
		name,
		file,
		path,
		children: [],
	};
	const subIr = resolveSubIr(ctx.loadIr, file, sheet);
	if (shouldSkipRecursion(file, subIr, ctx)) {
		return node;
	}
	const nextCtx = {
		...ctx,
		visitedFiles: new Set(ctx.visitedFiles).add(file),
		visitedIrs: new Set(ctx.visitedIrs).add(subIr),
	};
	node.children = buildChildren(subIr, path, nextCtx);
	return node;
}

export function sheetTree(ir, loadIr) {
	const rootName = ir?.name || "Root";
	const rootFile = ir?.file || "";
	const rootPath = `/${rootName}`;
	const ctx = {
		loadIr,
		depth: 0,
		visitedFiles: new Set(rootFile ? [rootFile] : []),
		visitedIrs: new Set(ir ? [ir] : []),
	};
	const rootNode = {
		id: ir?.id || "root",
		name: rootName,
		file: rootFile,
		path: rootPath,
		children: [],
	};
	rootNode.children = buildChildren(ir, rootPath, ctx);
	return rootNode;
}
