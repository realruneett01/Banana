(function () {
	"use strict";

	// ---- before/after slider ----
	var range = document.getElementById("compare");
	var rect = document.getElementById("revealRect");
	var divider = document.getElementById("divider");
	function setPos(pct) {
		var x = (560 * pct) / 100;
		rect.setAttribute("width", String(x));
		divider.setAttribute("x1", String(x));
		divider.setAttribute("x2", String(x));
	}
	if (range) {
		range.addEventListener("input", function () {
			setPos(Number(range.value));
		});
		setPos(Number(range.value));
		var reduce =
			window.matchMedia &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (!reduce) {
			// One gentle intro sweep so the interaction is discoverable; stops on first touch.
			var t0 = null,
				stopped = false,
				from = 12,
				to = Number(range.value);
			range.addEventListener("pointerdown", function () {
				stopped = true;
			});
			(function frame(ts) {
				if (stopped) return;
				if (t0 === null) t0 = ts;
				var p = Math.min(1, (ts - t0) / 1400);
				var v = from + (to - from) * (1 - Math.pow(1 - p, 3));
				range.value = String(v);
				setPos(v);
				if (p < 1) requestAnimationFrame(frame);
			})(performance.now());
		}
	}

	// ---- OS detection + tabs ----
	function detectOs() {
		var ua =
			(navigator.userAgentData && navigator.userAgentData.platform) ||
			navigator.platform ||
			navigator.userAgent ||
			"";
		ua = ua.toLowerCase();
		if (ua.indexOf("win") > -1) return "windows";
		if (
			ua.indexOf("mac") > -1 ||
			ua.indexOf("iphone") > -1 ||
			ua.indexOf("ipad") > -1
		)
			return "macos";
		if (
			ua.indexOf("linux") > -1 ||
			ua.indexOf("x11") > -1 ||
			ua.indexOf("android") > -1
		)
			return "linux";
		return null;
	}
	var NAMES = { windows: "Windows", macos: "macOS", linux: "Linux" };
	var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
	function selectTab(tab, focus) {
		tabs.forEach(function (t) {
			var on = t === tab;
			t.setAttribute("aria-selected", String(on));
			t.tabIndex = on ? 0 : -1;
			document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
		});
		if (focus) tab.focus();
	}
	tabs.forEach(function (tab, i) {
		tab.addEventListener("click", function () {
			selectTab(tab);
		});
		tab.addEventListener("keydown", function (e) {
			var n = null;
			if (e.key === "ArrowRight") n = tabs[(i + 1) % tabs.length];
			else if (e.key === "ArrowLeft")
				n = tabs[(i - 1 + tabs.length) % tabs.length];
			else if (e.key === "Home") n = tabs[0];
			else if (e.key === "End") n = tabs[tabs.length - 1];
			if (n) {
				e.preventDefault();
				selectTab(n, true);
			}
		});
	});
	var os = detectOs();
	var osEl = document.getElementById("dl-os");
	if (os) {
		selectTab(document.querySelector('.tab[data-os="' + os + '"]'));
		osEl.textContent = "Detected: " + NAMES[os];
	} else {
		osEl.textContent = "Works on Windows, macOS and Linux";
	}

	// ---- release info + gated download ----
	var buttons = document.getElementById("dl-buttons");
	var meta = document.getElementById("dl-meta");
	var title = document.getElementById("dl-title");
	var notice = document.getElementById("dl-notice");
	var terms = document.getElementById("terms");
	var links = [];

	function mb(bytes) {
		return (bytes / 1048576).toFixed(1) + " MB";
	}

	var DEFAULT_ARCH = { windows: "x64", macos: "arm64", linux: "x64" };

	function pickPrimary(assets) {
		var universal =
			assets.filter(function (a) {
				return a.os === "any";
			})[0] ||
			assets.filter(function (a) {
				return /\.zip$/.test(a.name);
			})[0];
		if (!os) return universal;
		var mine = assets.filter(function (a) {
			return a.os === os;
		});
		return (
			mine.filter(function (a) {
				return a.arch === DEFAULT_ARCH[os];
			})[0] ||
			mine[0] ||
			universal
		);
	}

	function addLink(asset, label, primary) {
		var a = document.createElement("a");
		a.className = "btn " + (primary ? "btn-primary" : "btn-ghost");
		a.href = "downloads/" + encodeURIComponent(asset.name);
		a.setAttribute("download", asset.name);
		a.textContent = label;
		a.dataset.href = a.getAttribute("href");
		links.push(a);
		return a;
	}

	function render(release) {
		var assets = release.assets;
		var main = pickPrimary(assets);
		var sums = assets.filter(function (a) {
			return a.name === "SHA256SUMS";
		})[0];
		var rest = assets.filter(function (a) {
			return a !== main && a.name !== "SHA256SUMS";
		});
		var label = main.label || "Portable";
		title.textContent = "Banana " + release.version + " \u2014 " + label;
		meta.textContent =
			"Released " +
			release.released +
			" \u00b7 " +
			mb(main.bytes) +
			(main.bundlesNode
				? " \u00b7 includes Node.js"
				: " \u00b7 needs Node.js 20.11+ installed");
		buttons.textContent = "";
		links = [];
		buttons.appendChild(
			addLink(
				main,
				"Download for " + (main.os === "any" ? "any system" : label),
				true,
			),
		);
		if (os === "macos") {
			var alt = assets.filter(function (a) {
				return a.os === "macos" && a !== main;
			})[0];
			if (alt)
				buttons.appendChild(addLink(alt, "Download " + alt.label, false));
		}
		var h = document.createElement("div");
		h.className = "hash";
		h.textContent = "SHA-256 of " + main.name + ":";
		var c = document.createElement("code");
		c.textContent = main.sha256;
		h.appendChild(c);
		buttons.parentNode.insertBefore(h, notice);

		if (rest.length || sums) {
			var d = document.createElement("details");
			d.className = "terms-detail more";
			var sm = document.createElement("summary");
			sm.textContent = "Other systems and files";
			d.appendChild(sm);
			var row = document.createElement("div");
			row.className = "dl-buttons";
			rest.forEach(function (a) {
				row.appendChild(addLink(a, a.label || a.name, false));
			});
			if (sums) row.appendChild(addLink(sums, "SHA256SUMS", false));
			d.appendChild(row);
			buttons.parentNode.insertBefore(d, notice);
		}

		// Make the install snippets use the real file name.
		document.querySelectorAll("code.copy").forEach(function (el) {
			el.textContent = el.textContent.replace(
				/banana-<version>-portable\.zip/g,
				main.name,
			);
			el.dataset.copy = el.dataset.copy.replace(
				/banana-portable\.zip/g,
				main.name,
			);
		});
		applyGate();
	}

	function applyGate() {
		var ok = terms.checked;
		links.forEach(function (a) {
			if (ok) {
				a.removeAttribute("aria-disabled");
				a.setAttribute("href", a.dataset.href);
				a.removeAttribute("tabindex");
			} else {
				a.setAttribute("aria-disabled", "true");
				a.removeAttribute("href");
				a.setAttribute("role", "link");
				a.tabIndex = 0;
			}
		});
		notice.hidden = ok || links.length === 0;
		notice.textContent = "Tick the box above to enable the download.";
	}
	buttons.addEventListener("click", function (e) {
		var a = e.target.closest("a");
		if (a && a.getAttribute("aria-disabled") === "true") {
			e.preventDefault();
			terms.focus();
		}
	});
	terms.addEventListener("change", applyGate);

	function unavailable(reason) {
		title.textContent = "Banana";
		meta.textContent = reason;
		buttons.textContent = "";
		var a = document.createElement("span");
		a.className = "btn btn-primary";
		a.setAttribute("aria-disabled", "true");
		a.textContent = "Not available yet";
		buttons.appendChild(a);
		notice.hidden = true;
		terms.disabled = true;
	}

	fetch("releases.json", { cache: "no-cache" })
		.then(function (r) {
			if (!r.ok) throw new Error(String(r.status));
			return r.json();
		})
		.then(function (rel) {
			if (
				!rel ||
				!Array.isArray(rel.assets) ||
				!rel.assets.length ||
				!/^[0-9A-Za-z.+-]+$/.test(String(rel.version))
			)
				throw new Error("bad manifest");
			// Only plain file names with a checksum are ever turned into links.
			rel.assets = rel.assets.filter(function (a) {
				return (
					a &&
					typeof a.name === "string" &&
					/^[A-Za-z0-9._-]+$/.test(a.name) &&
					typeof a.sha256 === "string" &&
					/^[0-9a-f]{64}$/.test(a.sha256)
				);
			});
			if (!rel.assets.length) throw new Error("no usable assets");
			render(rel);
		})
		.catch(function () {
			unavailable("No release has been published to this site yet.");
		});

	// ---- copy-on-click for command snippets ----
	document.addEventListener("click", function (e) {
		var el = e.target.closest("code.copy");
		if (!el || !navigator.clipboard) return;
		navigator.clipboard
			.writeText(el.dataset.copy || el.textContent)
			.then(function () {
				var old = el.textContent;
				el.textContent = "Copied ✓";
				setTimeout(function () {
					el.textContent = old;
				}, 1200);
			})
			.catch(function () {});
	});

	var termsLink = document.getElementById("terms-link");
	if (termsLink)
		termsLink.addEventListener("click", function () {
			document.getElementById("terms-detail").open = true;
		});
})();
