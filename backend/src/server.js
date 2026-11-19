import { createApp } from "./app.js";
import { config, resolveListenHost } from "./config.js";

const app = createApp();
const PORT = config.port;
const HOST = resolveListenHost();

app.listen(PORT, HOST, () => {
	console.log(`Server running on port ${PORT} (${HOST})`);
	console.log(`KiCad CLI path: ${config.kicadCliPath}`);
});

export default app;
