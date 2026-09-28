const rawApiUrl = import.meta.env.VITE_API_URL;
export const API_BASE_URL =
	rawApiUrl !== undefined && rawApiUrl !== null && rawApiUrl.trim() !== ""
		? rawApiUrl.trim().replace(/\/+$/, "")
		: import.meta.env.PROD
			? ""
			: "http://localhost:5000";
