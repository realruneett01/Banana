import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env with explicit error handling
const dotenvResult = dotenv.config({
    path: path.resolve(__dirname, "../.env"),
    override: true,
});

if (dotenvResult.error) {
    console.error(
        "\x1b[31m[Config Error] Failed to load .env file:\x1b[0m",
        dotenvResult.error.message,
    );
    throw new Error(
        "Failed to load .env file. Ensure .env exists at project root.",
    );
}

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

const placeholderPatterns = [
    /^placeholder_/i,
    /^YOUR_/i,
    /^xxx+$/i,
    /^changeme$/i,
    /^TODO$/i,
    /^FIXME$/i,
    /^ghp_xxxx/i,
    /^ghs_xxxx/i,
    /^gho_xxxx/i,
];

const missingVars: string[] = [];

function isValidUrl(str: string): boolean {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

for (const envVar of requiredEnvVars) {
    const val = process.env[envVar];

    if (!val || val.trim() === "") {
        missingVars.push(`${envVar} (missing or empty)`);
        continue;
    }

    const isPlaceholder = placeholderPatterns.some((re) => re.test(val));
    if (isPlaceholder) {
        missingVars.push(`${envVar} (placeholder value detected)`);
        continue;
    }

    if (
        (envVar === "GITHUB_CALLBACK_URL" || envVar === "FRONTEND_URL") &&
        !isValidUrl(val)
    ) {
        missingVars.push(`${envVar} (invalid URL format)`);
        continue;
    }

    if (envVar === "SESSION_SECRET" && val.length < 32) {
        missingVars.push(`${envVar} (must be at least 32 characters)`);
        continue;
    }

    if (envVar === "PORT") {
        const portNum = parseInt(val, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            missingVars.push(`${envVar} (must be a valid port 1-65535)`);
            continue;
        }
    }
}

if (missingVars.length > 0) {
    console.error(
        "\x1b[31m[Config Error] Invalid environment variables:\x1b[0m",
    );
    for (const missing of missingVars) {
        console.error(`  - \x1b[33m${missing}\x1b[0m`);
    }
    throw new Error(
        `Failed to start: ${missingVars.length} configuration error(s) found.`,
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