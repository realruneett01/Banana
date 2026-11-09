import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();
const PORT = config.port;

app.listen(PORT, "0.0.0.0", () => {
	console.log(`Server running on port ${PORT}`);
	console.log(`KiCad CLI path: ${config.kicadCliPath}`);
});

export default app;
