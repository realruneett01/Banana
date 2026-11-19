import { Empty, Spin, Tree } from "antd";
import { useCallback, useEffect, useState } from "react";

const TREE_BOX_STYLE = Object.freeze({
	border: "1px solid #232836",
	borderRadius: "6px",
	flex: 1,
	height: 420,
	overflow: "hidden",
});

const CENTER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
});

const ITEM_TITLE_STYLE = Object.freeze({
	display: "block",
	fontSize: 11,
	color: "#64748b",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

const LOAD_MORE_STYLE = Object.freeze({
	color: "#38bdf8",
	cursor: "pointer",
	fontSize: 12,
});

function createRootNode(lib) {
	return {
		title: `${lib.name} (${lib.count})`,
		key: `lib:${lib.name}`,
		isLeaf: false,
		libraryName: lib.name,
	};
}

function renderItemTitle(item) {
	return (
		<span title={item.description || undefined}>
			<span style={{ color: "#f1f5f9" }}>{item.name}</span>
			{item.description && (
				<span style={ITEM_TITLE_STYLE}>{item.description}</span>
			)}
		</span>
	);
}

function renderLoadMoreTitle(loading) {
	return (
		<span style={LOAD_MORE_STYLE}>
			{loading ? "Loading..." : "Load more..."}
		</span>
	);
}

function buildItemNodes(libName, items, total, offset) {
	const nodes = items.map((item) => ({
		title: renderItemTitle(item),
		key: item.libId,
		isLeaf: true,
		item,
	}));
	const nextOffset = offset + items.length;
	if (total > nextOffset) {
		nodes.push({
			title: renderLoadMoreTitle(false),
			key: `loadmore:${libName}:${nextOffset}`,
			isLeaf: true,
			isLoadMore: true,
			libraryName: libName,
			offset: nextOffset,
		});
	}
	return nodes;
}

function updateRootChildren(list, key, children) {
	return list.map((node) => (node.key === key ? { ...node, children } : node));
}

function appendRootChildren(list, libKey, newNodes) {
	return list.map((node) => {
		if (node.key !== libKey) return node;
		const prev = (node.children ?? []).filter((child) => !child.isLoadMore);
		return { ...node, children: [...prev, ...newNodes] };
	});
}

function useLibraries(api, kind) {
	const [treeData, setTreeData] = useState([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!api?.listLibraries) return;
		let active = true;
		setLoading(true);
		api
			.listLibraries(kind)
			.then((res) => {
				if (!active || !res?.ok) return;
				const libs = res.data?.libraries ?? [];
				setTreeData(libs.map(createRootNode));
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [api, kind]);

	return { treeData, setTreeData, loading };
}

function useTreeExpand(api, kind, setTreeData) {
	return useCallback(
		(node) => {
			const libName = node.libraryName;
			return api
				.listLibraryItems(kind, libName, { limit: 500, offset: 0 })
				.then((res) => {
					if (!res?.ok) return;
					const { items = [], total = 0 } = res.data ?? {};
					const children = buildItemNodes(libName, items, total, 0);
					setTreeData((prev) => updateRootChildren(prev, node.key, children));
				});
		},
		[api, kind, setTreeData],
	);
}

function useTreeLoadMore(api, kind, setTreeData) {
	const [loadingMore, setLoadingMore] = useState(false);

	const loadMore = useCallback(
		(libName, offset) => {
			if (loadingMore) return;
			setLoadingMore(true);
			api
				.listLibraryItems(kind, libName, { limit: 500, offset })
				.then((res) => {
					if (!res?.ok) return;
					const { items = [], total = 0 } = res.data ?? {};
					const nextNodes = buildItemNodes(libName, items, total, offset);
					setTreeData((prev) =>
						appendRootChildren(prev, `lib:${libName}`, nextNodes),
					);
				})
				.finally(() => setLoadingMore(false));
		},
		[api, kind, loadingMore, setTreeData],
	);

	return loadMore;
}

function useTreeSelect(onSelect, loadMore) {
	return useCallback(
		(_keys, info) => {
			const node = info?.node;
			if (!node) return;
			if (node.isLoadMore) {
				loadMore(node.libraryName, node.offset);
				return;
			}
			if (node.isLeaf && node.item) {
				onSelect?.(node.item);
			}
		},
		[onSelect, loadMore],
	);
}

function TreeStatusView({ loading }) {
	return (
		<div style={TREE_BOX_STYLE}>
			<div style={CENTER_STYLE}>
				{loading ? (
					<Spin size="small" />
				) : (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description="No libraries"
					/>
				)}
			</div>
		</div>
	);
}

export default function LibraryTree({ api, kind, selectedId, onSelect }) {
	const { treeData, setTreeData, loading } = useLibraries(api, kind);
	const onLoadData = useTreeExpand(api, kind, setTreeData);
	const loadMore = useTreeLoadMore(api, kind, setTreeData);
	const handleSelect = useTreeSelect(onSelect, loadMore);

	if (loading) return <TreeStatusView loading />;
	if (treeData.length === 0) return <TreeStatusView loading={false} />;

	return (
		<div style={TREE_BOX_STYLE}>
			<Tree
				treeData={treeData}
				loadData={onLoadData}
				height={420}
				selectedKeys={selectedId ? [selectedId] : []}
				onSelect={handleSelect}
			/>
		</div>
	);
}
