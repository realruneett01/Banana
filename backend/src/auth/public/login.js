(function () {
	var form = document.getElementById("form");
	var err = document.getElementById("error");
	var btn = document.getElementById("submit");
	var pw = document.getElementById("password");

	// Only same-site paths: "//evil.example" and "https://..." must never become a redirect target.
	function safeNext() {
		var next = new URLSearchParams(location.search).get("next") || "/";
		return /^\/(?![\/\\])/.test(next) ? next : "/";
	}
	function show(msg) {
		err.textContent = msg;
		err.hidden = !msg;
	}

	document.getElementById("toggle").addEventListener("click", function (e) {
		var show = pw.type === "password";
		pw.type = show ? "text" : "password";
		e.target.textContent = show ? "Hide" : "Show";
		e.target.setAttribute(
			"aria-label",
			show ? "Hide password" : "Show password",
		);
	});

	fetch("/api/session", { credentials: "same-origin" })
		.then(function (r) {
			return r.json();
		})
		.then(function (s) {
			if (s.authenticated) location.replace(safeNext());
			if (s.setupRequired) document.getElementById("setup").hidden = false;
		})
		.catch(function () {});

	form.addEventListener("submit", function (e) {
		e.preventDefault();
		show("");
		var username = form.username.value.trim();
		if (!username || !pw.value)
			return show("Enter your username and password.");
		btn.disabled = true;
		btn.textContent = "Signing in…";
		fetch("/api/session/login", {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: username, password: pw.value }),
		})
			.then(function (r) {
				return r.json().then(function (b) {
					return { ok: r.ok, body: b };
				});
			})
			.then(function (res) {
				if (res.ok) return location.replace(safeNext());
				show(res.body.error || "Sign in failed.");
			})
			.catch(function () {
				show("Cannot reach the server.");
			})
			.then(function () {
				btn.disabled = false;
				btn.textContent = "Sign in";
			});
	});
})();
