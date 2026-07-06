import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env in the workspace root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export interface Config {
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    GITHUB_CALLBACK_URL: string;
    SESSION_SECRET: string;
    FRONTEND_URL: string;
    PORT: number;
}

const requiredEnvVars = [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_CALLBACK_URL",
    "SESSION_SECRET",
    "FRONTEND_URL",
    "PORT",
] as const;

const missingVars: string[] = [];

for (const envVar of requiredEnvVars) {
    const val = process.env[envVar];
    if (!val || val.trim() === "" || val.startsWith("placeholder_")) {
        missingVars.push(envVar);
    }
}

if (missingVars.length > 0) {
    console.error(
        "\x1b[31m[Config Error] Missing required environment variables:\x1b[0m",
    );
    for (const missing of missingVars) {
        console.error(`  - \x1b[33m${missing}\x1b[0m`);
    }
    throw new Error(
        `Failed to start: Missing environment variables: ${missingVars.join(", ")}`,
    );
}

export const config: Config = {
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID!,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET!,
    GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL!,
    SESSION_SECRET: process.env.SESSION_SECRET!,
    FRONTEND_URL: process.env.FRONTEND_URL!,
    PORT: parseInt(process.env.PORT!, 10),
};
