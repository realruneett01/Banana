import { Alert, AutoComplete, Button, Input, Modal, Spin, Tabs } from "antd";
import { useCallback, useEffect, useState } from "react";

const TAB_ITEMS = [
	{ key: "symbols", label: "Symbols" },
	{ key: "footprints", label: "Footprints" },
];

const PREVIEW_SVG_STYLE = Object.freeze({
	width: "100%",
	height: "100%",
	display: "block",
});

const PREVIEW_BOX_STYLE = Object.freeze({
	border: "1px solid #232836",
	borderRadius: "6px",
	background: "#0b0d12",
	height: "220px",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
});

const PREVIEW_HEADER_STYLE = Object.freeze({
	padding: "4px 8px",
	background: "#12151c",
	borderBottom: "1px solid #232836",
	fontSize: "11px",
	color: "#94a3b8",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

const PREVIEW_HINT_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
	color: "#64748b",
	fontSize: "12px",
	padding: "8px",
	textAlign: "center",
});

const RESULT_LIST_STYLE = Object.freeze({
	height: "320px",
	overflowY: "auto",
	border: "1px solid #232836",
	borderRadius: "6px",
	flex: 1,
});

const RESULT_ITEM_STYLE = Object.freeze({
	padding: "8px 12px",
	cursor: "pointer",
	borderBottom: "1px solid #1e293b",
	transition: "background 0.15s",
	outline: "none",
});

const RESULT_DESC_STYLE = Object.freeze({
	color: "#94a3b8",
	fontSize: "12px",
	marginTop: "4px",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

const TWO_PANE_STYLE = Object.freeze({
	display: "flex",
	gap: "16px",
	marginTop: "12px",
	minHeight: "320px",
});

const RIGHT_PANE_STYLE = Object.freeze({
	width: "280px",
	display: "flex",
	flexDirection: "column",
});

const LIST_CENTER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
});

function parseLibId(libId, fallbackName = "") {
	const colon = typeof libId === "string" ? libId.indexOf(":") : -1;
	const library = colon !== -1 ? libId.slice(0, colon) : "";
	const name =
		fallbackName || (colon !== -1 ? libId.slice(colon + 1) : libId || "");
	return { library, name };
}

function getPinBounds(pins) {
	if (!pins || pins.length === 0) return "-10 -10 20 20";
	const xs = pins.map((p) => p.at?.[0] ?? 0);
	const ys = pins.map((p) => -(p.at?.[1] ?? 0));
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const span = Math.max(maxX - minX, maxY - minY);
	const pad = Math.max(4, span * 0.25);
	const w = Math.max(10, maxX - minX + pad * 2);
	const h = Math.max(10, maxY - minY + pad * 2);
	return `${minX - pad} ${minY - pad} ${w} ${h}`;
}

function PinPreviewItem({ pin }) {
	const x = pin.at?.[0] ?? 0;
	const y = -(pin.at?.[1] ?? 0);
	return (
		<g key={pin.number}>
			<circle
				cx={x}
				cy={y}
				r={0.6}
				fill="#38bdf8"
				stroke="#0f172a"
				strokeWidth={0.15}
			/>
			<text x={x} y={y - 0.9} fill="#94a3b8" fontSize={0.9} textAnchor="middle">
				{pin.number}
			</text>
		</g>
	);
}

function SymbolPreviewPane({ detail, loading }) {
	if (loading) return <div style={PREVIEW_HINT_STYLE}>Loading preview...</div>;
	const pins = detail?.pins ?? [];
	if (pins.length === 0) {
		return <div style={PREVIEW_HINT_STYLE}>No pins in symbol preview</div>;
	}
	const viewBox = getPinBounds(pins);
	return (
		<svg
			viewBox={viewBox}
			style={PREVIEW_SVG_STYLE}
			aria-label="Symbol preview"
		>
			<title>Symbol Preview</title>
			{pins.map((pin) => (
				<PinPreviewItem key={pin.number || pin.name} pin={pin} />
			))}
		</svg>
	);
}

function getPadBounds(pads) {
	if (!pads || pads.length === 0) return "-10 -10 20 20";
	const xs = pads.map((p) => p.at?.[0] ?? 0);
	const ys = pads.map((p) => p.at?.[1] ?? 0);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const span = Math.max(maxX - minX, maxY - minY);
	const pad = Math.max(3, span * 0.25);
	const w = Math.max(8, maxX - minX + pad * 2);
	const h = Math.max(8, maxY - minY + pad * 2);
	return `${minX - pad} ${minY - pad} ${w} ${h}`;
}

function PadPreviewItem({ pad }) {
	const x = pad.at?.[0] ?? 0;
	const y = pad.at?.[1] ?? 0;
	const w = Math.max(0.5, pad.size?.[0] ?? 1.2);
	const h = Math.max(0.5, pad.size?.[1] ?? 1.2);
	const rot = pad.at?.[2] ?? 0;
	const transform = rot ? `rotate(${rot} ${x} ${y})` : undefined;
	const isCircle = pad.shape === "circle";
	return (
		<g key={pad.number}>
			{isCircle ? (
				<circle
					cx={x}
					cy={y}
					r={w / 2}
					fill="#ef4444"
					stroke="#991b1b"
					strokeWidth={0.1}
				/>
			) : (
				<rect
					x={x - w / 2}
					y={y - h / 2}
					width={w}
					height={h}
					rx={0.1}
					fill="#ef4444"
					stroke="#991b1b"
					strokeWidth={0.1}
					transform={transform}
				/>
			)}
			<text
				x={x}
				y={y}
				fill="#fff"
				fontSize={Math.min(w, h) * 0.5}
				textAnchor="middle"
				dominantBaseline="central"
			>
				{pad.number}
			</text>
		</g>
	);
}

function FootprintPreviewPane({ detail, loading }) {
	if (loading) return <div style={PREVIEW_HINT_STYLE}>Loading preview...</div>;
	const pads = detail?.pads ?? [];
	if (pads.length === 0) {
		return <div style={PREVIEW_HINT_STYLE}>No pads in footprint preview</div>;
	}
	const viewBox = getPadBounds(pads);
	return (
		<svg
			viewBox={viewBox}
			style={PREVIEW_SVG_STYLE}
			aria-label="Footprint preview"
		>
			<title>Footprint Preview</title>
			{pads.map((pad) => (
				<PadPreviewItem key={pad.number} pad={pad} />
			))}
		</svg>
	);
}

function PreviewSection({ activeTab, item, detail, loading }) {
	if (!item) {
		return <div style={PREVIEW_HINT_STYLE}>Select an item to preview</div>;
	}
	return (
		<section style={PREVIEW_BOX_STYLE} aria-label="Part preview">
			<div style={PREVIEW_HEADER_STYLE}>{item.name || item.libId}</div>
			{activeTab === "symbols" ? (
				<SymbolPreviewPane detail={detail} loading={loading} />
			) : (
				<FootprintPreviewPane detail={detail} loading={loading} />
			)}
		</section>
	);
}

function ResultListItem({ item, isSelected, onSelect }) {
	const { library, name } = parseLibId(item.libId, item.name);
	const bg = isSelected ? "#1e293b" : "transparent";
	const border = isSelected ? "1px solid #38bdf8" : "1px solid transparent";
	return (
		<div
			role="option"
			aria-selected={isSelected}
			tabIndex={0}
			onClick={() => onSelect(item)}
			onKeyDown={(e) => {
				if (e.key === " " || e.key === "Enter") onSelect(item);
			}}
			style={{ ...RESULT_ITEM_STYLE, background: bg, border }}
		>
			<div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
				<strong style={{ color: "#f1f5f9" }}>{name}</strong>
				<span style={{ color: "#64748b", fontSize: 11 }}>{library}</span>
			</div>
			{item.description && (
				<div style={RESULT_DESC_STYLE}>{item.description}</div>
			)}
		</div>
	);
}

function ResultList({ items, selectedId, onSelect, loading }) {
	if (loading) {
		return (
			<div style={LIST_CENTER_STYLE}>
				<Spin size="small" />
			</div>
		);
	}
	if (!items || items.length === 0) {
		return (
			<div style={LIST_CENTER_STYLE}>
				<span style={{ color: "#64748b" }}>No results found</span>
			</div>
		);
	}
	return (
		<div role="listbox" aria-label="Search results" style={RESULT_LIST_STYLE}>
			{items.map((item) => (
				<ResultListItem
					key={item.libId}
					item={item}
					isSelected={item.libId === selectedId}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}

function FootprintPickerField({ value, onChange, onSearch, options }) {
	return (
		<div style={{ marginTop: 12 }}>
			<label
				htmlFor="lib-footprint-input"
				style={{
					display: "block",
					marginBottom: 4,
					fontSize: 12,
					color: "#94a3b8",
				}}
			>
				Footprint
			</label>
			<AutoComplete
				id="lib-footprint-input"
				style={{ width: "100%" }}
				value={value}
				onChange={onChange}
				onSearch={onSearch}
				options={options}
				placeholder="Select or enter footprint (e.g. Package_SO:SOIC-8)"
				aria-label="Footprint picker"
			/>
		</div>
	);
}

function useLibrarySearch({ api, activeTab, open, query }) {
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(false);
	const [unavailable, setUnavailable] = useState(false);

	useEffect(() => {
		if (!open || !api) return;
		const trimmed = query.trim();
		if (!trimmed) {
			setItems([]);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		const searchFn =
			activeTab === "symbols" ? api.searchSymbols : api.searchFootprints;
		searchFn(trimmed, { limit: 50, signal: controller.signal })
			.then((res) => {
				if (res.status === 503) setUnavailable(true);
				if (res.ok) {
					setUnavailable(false);
					const list =
						activeTab === "symbols" ? res.data?.symbols : res.data?.footprints;
					setItems(list ?? []);
				}
			})
			.finally(() => setLoading(false));
		return () => controller.abort();
	}, [api, activeTab, open, query]);

	return { items, loading, unavailable, setUnavailable };
}

function useItemDetail({ api, activeTab, selectedItem }) {
	const [detail, setDetail] = useState(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!api || !selectedItem?.libId) {
			setDetail(null);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		const fetchFn = activeTab === "symbols" ? api.getSymbol : api.getFootprint;
		fetchFn(selectedItem.libId, { signal: controller.signal })
			.then((res) => {
				if (res.ok) {
					const d =
						activeTab === "symbols" ? res.data?.symbol : res.data?.footprint;
					setDetail(d ?? null);
				}
			})
			.finally(() => setLoading(false));
		return () => controller.abort();
	}, [api, activeTab, selectedItem?.libId]);

	return { detail, loading };
}

function useFootprintPickerOptions({ api, initialFp }) {
	const [options, setOptions] = useState([]);

	const handleSearch = useCallback(
		(q) => {
			if (!api?.searchFootprints || !q?.trim()) return;
			api.searchFootprints(q.trim(), { limit: 10 }).then((res) => {
				if (res.ok && res.data?.footprints) {
					setOptions(res.data.footprints.map((fp) => ({ value: fp.libId })));
				}
			});
		},
		[api],
	);

	useEffect(() => {
		if (initialFp) {
			setOptions([{ value: initialFp }]);
		}
	}, [initialFp]);

	return { options, handleSearch };
}

function buildPlacePayload({
	activeTab,
	selectedItem,
	selectedFootprint,
	detail,
}) {
	if (activeTab === "symbols") {
		const symbol = selectedItem.libId;
		const footprint =
			selectedFootprint ||
			selectedItem.properties?.Footprint ||
			detail?.properties?.Footprint ||
			"";
		const refProp =
			selectedItem.properties?.Reference ||
			detail?.properties?.Reference ||
			"U";
		const ref = refProp.replace(/[?#]+$/, "") || "U";
		const value =
			selectedItem.properties?.Value ||
			detail?.properties?.Value ||
			selectedItem.name ||
			"";
		return { symbol, footprint, ref, prefix: ref, value };
	}
	const footprint = selectedItem.libId;
	return {
		symbol: "",
		footprint,
		ref: "U",
		prefix: "U",
		value: selectedItem.name || "",
	};
}

function useLibraryStatus(api, open, setUnavailable) {
	useEffect(() => {
		if (!open || !api?.libraryStatus) return;
		api.libraryStatus().then((res) => {
			if (res.status === 503 || (res.ok && res.data?.available === false)) {
				setUnavailable(true);
			} else if (res.ok && res.data?.available === true) {
				setUnavailable(false);
			}
		});
	}, [api, open, setUnavailable]);
}

function useDebounce(value, delay) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}

function useFootprintState(activeTab, selectedItem, detail) {
	const [selectedFootprint, setSelectedFootprint] = useState("");
	useEffect(() => {
		if (activeTab === "symbols" && selectedItem) {
			const fp =
				selectedItem.properties?.Footprint ||
				detail?.properties?.Footprint ||
				"";
			setSelectedFootprint(fp);
		}
	}, [activeTab, selectedItem, detail]);
	return { selectedFootprint, setSelectedFootprint };
}

function usePlaceHandler({
	activeTab,
	selectedItem,
	selectedFootprint,
	detail,
	onPlace,
	onClose,
}) {
	return useCallback(() => {
		if (!selectedItem) return;
		const payload = buildPlacePayload({
			activeTab,
			selectedItem,
			selectedFootprint,
			detail,
		});
		onPlace?.(payload);
		onClose?.();
	}, [activeTab, selectedItem, selectedFootprint, detail, onPlace, onClose]);
}

function useBrowserController({ api, open, onClose, onPlace }) {
	const [searchTerm, setSearchTerm] = useState("");
	const [activeTab, setActiveTab] = useState("symbols");
	const [selectedItem, setSelectedItem] = useState(null);
	const debouncedQuery = useDebounce(searchTerm, 250);
	const { items, loading, unavailable, setUnavailable } = useLibrarySearch({
		api,
		activeTab,
		open,
		query: debouncedQuery,
	});
	useLibraryStatus(api, open, setUnavailable);
	const { detail, loading: detailLoading } = useItemDetail({
		api,
		activeTab,
		selectedItem,
	});
	const selFp = useFootprintState(activeTab, selectedItem, detail);
	const fp = useFootprintPickerOptions({
		api,
		initialFp: selFp.selectedFootprint,
	});
	const handlePlace = usePlaceHandler({
		activeTab,
		selectedItem,
		selectedFootprint: selFp.selectedFootprint,
		detail,
		onPlace,
		onClose,
	});
	useEffect(() => {
		setSelectedItem(items.length > 0 ? items[0] : null);
	}, [items]);
	return {
		searchTerm,
		setSearchTerm,
		activeTab,
		setActiveTab,
		items,
		loading,
		unavailable,
		selectedItem,
		setSelectedItem,
		detail,
		detailLoading,
		selectedFootprint: selFp.selectedFootprint,
		setSelectedFootprint: selFp.setSelectedFootprint,
		fpOptions: fp.options,
		handleFpSearch: fp.handleSearch,
		handlePlace,
	};
}

function BrowserFooter({ onClose, onPlace, hasSelection }) {
	return (
		<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
			<Button onClick={onClose} aria-label="Close">
				Cancel
			</Button>
			<Button
				type="primary"
				onClick={onPlace}
				disabled={!hasSelection}
				aria-label="Place part"
			>
				Place
			</Button>
		</div>
	);
}

function BrowserPanes({ ctrl }) {
	return (
		<div style={TWO_PANE_STYLE}>
			<ResultList
				items={ctrl.items}
				selectedId={ctrl.selectedItem?.libId}
				onSelect={ctrl.setSelectedItem}
				loading={ctrl.loading}
			/>
			<div style={RIGHT_PANE_STYLE}>
				<PreviewSection
					activeTab={ctrl.activeTab}
					item={ctrl.selectedItem}
					detail={ctrl.detail}
					loading={ctrl.detailLoading}
				/>
				{ctrl.activeTab === "symbols" && ctrl.selectedItem && (
					<FootprintPickerField
						value={ctrl.selectedFootprint}
						onChange={ctrl.setSelectedFootprint}
						onSearch={ctrl.handleFpSearch}
						options={ctrl.fpOptions}
					/>
				)}
			</div>
		</div>
	);
}

function BrowserBody({ ctrl }) {
	return (
		<section
			aria-label="Library content"
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					ctrl.handlePlace();
				}
			}}
		>
			{ctrl.unavailable && (
				<Alert
					type="warning"
					message="KiCad libraries aren't installed on this server"
					showIcon
					style={{ marginBottom: 12 }}
				/>
			)}
			<Input.Search
				placeholder="Search symbols or footprints..."
				value={ctrl.searchTerm}
				onChange={(e) => ctrl.setSearchTerm(e.target.value)}
				allowClear
				aria-label="Search parts"
			/>
			<Tabs
				activeKey={ctrl.activeTab}
				onChange={ctrl.setActiveTab}
				items={TAB_ITEMS}
				aria-label="Library tabs"
			/>
			<BrowserPanes ctrl={ctrl} />
		</section>
	);
}

export default function LibraryBrowser({ api, open, onClose, onPlace }) {
	const ctrl = useBrowserController({ api, open, onClose, onPlace });
	return (
		<Modal
			open={open}
			onCancel={onClose}
			title="Parts Library"
			width={760}
			footer={
				<BrowserFooter
					onClose={onClose}
					onPlace={ctrl.handlePlace}
					hasSelection={Boolean(ctrl.selectedItem)}
				/>
			}
			aria-label="Parts library browser"
		>
			<BrowserBody ctrl={ctrl} />
		</Modal>
	);
}
