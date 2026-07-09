export class BrowserGitFs {
    public files: Map<string, File>;
    private cache: Map<string, Uint8Array> = new Map();
    readonly instanceId = Math.floor(Math.random() * 100000);

    constructor(files: Map<string, File>) {
        this.files = files;
        console.log(`[BrowserGitFs] Constructed instance #${this.instanceId} with files map size:`, files.size);
        // Log a sample of .git/ paths to verify git objects are present
        const gitPaths = Array.from(files.keys()).filter(k => k.startsWith('.git/')).slice(0, 20);
        console.log(`[BrowserGitFs #${this.instanceId}] Sample .git/ paths:`, gitPaths);
    }

    private normalize(filepath: string): string {
        if (typeof filepath !== "string") {
            console.error("BrowserGitFs.normalize: got non-string input:", filepath, new Error().stack);
            throw new TypeError(`BrowserGitFs.normalize expected a string path, got ${typeof filepath}`);
        }
        return filepath.replace(/^\.?\/+/, "");
    }

    private async readBytes(path: string): Promise<Uint8Array> {
        const norm = this.normalize(path);
        if (this.cache.has(norm)) return this.cache.get(norm)!;
        const file = this.files.get(norm);
        if (!file) {
            console.log(`[BrowserGitFs #${this.instanceId}] MISS:`, JSON.stringify(norm));
            const err: any = new Error(`ENOENT: ${path}`);
            err.code = "ENOENT";
            throw err;
        }
        console.log(`[BrowserGitFs #${this.instanceId}] calling file.arrayBuffer() for:`, norm);
        try {
            const arrBuf = await file.arrayBuffer();
            console.log(`[BrowserGitFs #${this.instanceId}] file.arrayBuffer() resolved for:`, norm, "size:", arrBuf.byteLength);
            const buf = new Uint8Array(arrBuf);
            this.cache.set(norm, buf);
            return buf;
        } catch (e: any) {
            console.error(`[BrowserGitFs #${this.instanceId}] file.arrayBuffer() rejected for:`, norm, e.message);
            throw e;
        }
    }

    promises = {
        readFile: async (filepath: string | undefined, opts?: any): Promise<Uint8Array | string> => {
            console.log(`[BrowserGitFs #${this.instanceId}.readFile] called with:`, JSON.stringify(filepath), opts);
            console.trace(`[BrowserGitFs #${this.instanceId}.readFile] stack`);
            
            // Defensive check: if filepath is undefined, null, or empty, throw immediately
            if (filepath === undefined || filepath === null || filepath === '') {
                const err: any = new Error(`BrowserGitFs.readFile: invalid filepath: ${filepath}`);
                err.code = "EINVAL";
                console.error(`[BrowserGitFs #${this.instanceId}.readFile] INVALID PATH:`, filepath);
                throw err;
            }
            
            try {
                const bytes = await this.readBytes(filepath);
                let result: Uint8Array | string = bytes;
                if (opts && (opts.encoding === "utf8" || opts === "utf8")) {
                    result = new TextDecoder().decode(bytes);
                }
                console.log(`[BrowserGitFs #${this.instanceId}.readFile] success:`, JSON.stringify(filepath), "returned type:", typeof result, "length:", result.length);
                return result;
            } catch (err: any) {
                console.error(`[BrowserGitFs #${this.instanceId}.readFile] failed:`, JSON.stringify(filepath), err.message);
                throw err;
            }
        },

        writeFile: async () => {
            throw new Error("BrowserGitFs is read-only");
        },

        unlink: async () => {
            throw new Error("BrowserGitFs is read-only");
        },

        readdir: async (dirpath: string | undefined): Promise<string[]> => {
            console.log(`[BrowserGitFs #${this.instanceId}.readdir] called with:`, JSON.stringify(dirpath));
            console.trace(`[BrowserGitFs #${this.instanceId}.readdir] stack`);
            
            // Defensive check
            if (dirpath === undefined || dirpath === null) {
                const err: any = new Error(`BrowserGitFs.readdir: invalid dirpath: ${dirpath}`);
                err.code = "EINVAL";
                console.error(`[BrowserGitFs #${this.instanceId}.readdir] INVALID PATH:`, dirpath);
                throw err;
            }
            
            try {
                const norm = this.normalize(dirpath);
                const prefix = norm === "" ? "" : norm.replace(/\/$/, "") + "/";
                const names = new Set<string>();
                for (const key of this.files.keys()) {
                    if (!key.startsWith(prefix)) continue;
                    const rest = key.slice(prefix.length);
                    const firstSegment = rest.split("/")[0];
                    if (firstSegment) names.add(firstSegment);
                }
                if (names.size === 0) {
                    const err: any = new Error(`ENOENT: ${dirpath}`);
                    err.code = "ENOENT";
                    throw err;
                }
                const result = Array.from(names);
                console.log(`[BrowserGitFs #${this.instanceId}.readdir] success:`, JSON.stringify(dirpath), "returned:", result);
                return result;
            } catch (err: any) {
                console.error(`[BrowserGitFs #${this.instanceId}.readdir] failed:`, JSON.stringify(dirpath), err.message);
                throw err;
            }
        },

        mkdir: async () => { /* no-op: read-only, directories are implicit */ },

        rmdir: async () => {
            throw new Error("BrowserGitFs is read-only");
        },

        stat: async (filepath: string | undefined) => {
            console.log(`[BrowserGitFs #${this.instanceId}.stat] called with:`, JSON.stringify(filepath));
            console.trace(`[BrowserGitFs #${this.instanceId}.stat] stack`);
            
            // Defensive check
            if (filepath === undefined || filepath === null) {
                const err: any = new Error(`BrowserGitFs.stat: invalid filepath: ${filepath}`);
                err.code = "EINVAL";
                console.error(`[BrowserGitFs #${this.instanceId}.stat] INVALID PATH:`, filepath);
                throw err;
            }
            
            try {
                const result = await this.statImpl(filepath);
                console.log(`[BrowserGitFs #${this.instanceId}.stat] success:`, JSON.stringify(filepath), "isFile:", result.isFile(), "isDir:", result.isDirectory());
                return result;
            } catch (err: any) {
                console.error(`[BrowserGitFs #${this.instanceId}.stat] failed:`, JSON.stringify(filepath), err.message);
                throw err;
            }
        },

        lstat: async (filepath: string | undefined) => {
            console.log(`[BrowserGitFs #${this.instanceId}.lstat] called with:`, JSON.stringify(filepath));
            console.trace(`[BrowserGitFs #${this.instanceId}.lstat] stack`);
            
            // Defensive check
            if (filepath === undefined || filepath === null) {
                const err: any = new Error(`BrowserGitFs.lstat: invalid filepath: ${filepath}`);
                err.code = "EINVAL";
                console.error(`[BrowserGitFs #${this.instanceId}.lstat] INVALID PATH:`, filepath);
                throw err;
            }
            
            try {
                const result = await this.statImpl(filepath);
                console.log(`[BrowserGitFs #${this.instanceId}.lstat] success:`, JSON.stringify(filepath), "isFile:", result.isFile(), "isDir:", result.isDirectory());
                return result;
            } catch (err: any) {
                console.error(`[BrowserGitFs #${this.instanceId}.lstat] failed:`, JSON.stringify(filepath), err.message);
                throw err;
            }
        },

        readlink: async () => {
            throw new Error("BrowserGitFs: symlinks not supported");
        },

        symlink: async () => {
            throw new Error("BrowserGitFs is read-only");
        },
    };

    private async statImpl(filepath: string) {
        const norm = this.normalize(filepath);
        const isFile = this.files.has(norm);
        const prefix = norm === "" ? "" : norm.replace(/\/$/, "") + "/";
        const isDir = !isFile && Array.from(this.files.keys()).some((k) => k.startsWith(prefix));
        if (!isFile && !isDir) {
            const err: any = new Error(`ENOENT: ${filepath}`);
            err.code = "ENOENT";
            throw err;
        }
        const size = isFile ? (this.files.get(norm) as File).size : 0;
        return {
            isFile: () => isFile,
            isDirectory: () => isDir,
            isSymbolicLink: () => false,
            size,
            mtimeMs: isFile ? (this.files.get(norm) as File).lastModified : 0,
            mode: 0o644,
        };
    }
}
