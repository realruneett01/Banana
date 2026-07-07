import { FileSystemBase, type FileEntry } from "./vfs.js";

export interface GitCommitVFSOptions {
    repoPath: string;
    ref: string;
    filePath?: string;
}

/**
 * Read-only VFS backed by a single commit SHA.
 * Enumerates only the selected file path to support lazy loading.
 */
export class GitCommitFileSystem extends FileSystemBase {
    readonly repoPath: string;
    readonly ref: string;
    readonly filePath?: string;

    constructor(options: GitCommitVFSOptions) {
        super();
        this.repoPath = options.repoPath;
        this.ref = options.ref;
        this.filePath = options.filePath;
    }

    override async setup(): Promise<void> {
        // Setup logic
    }

    override async enumerate(base_dir: string): Promise<FileEntry[]> {
        if (this.filePath) {
            return [{
                path: this.filePath,
                type: "file",
            }];
        }
        return [];
    }

    override async load_file(path: string): Promise<File> {
        const params = new URLSearchParams({
            repoPath: this.repoPath,
            ref: this.ref,
            filePath: path,
        });

        const res = await fetch(`/api/git/blob?${params.toString()}`);
        if (!res.ok) {
            throw new Error(
                `GitCommitFileSystem: failed to load ${path} at ${this.ref}: ${res.status}`
            );
        }
        const blob = await res.blob();
        return new File([blob], path.split("/").pop() ?? "file");
    }
}
