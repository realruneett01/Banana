import { FileSystemBase, type FileEntry } from "./vfs.js";

export interface LocalGitVFSOptions {
    repoPath: string;
}

/**
 * VFS that reads the working tree / HEAD via the backend.
 * Used for browsing before a specific commit is selected.
 */
export class LocalGitFileSystem extends FileSystemBase {
    readonly repoPath: string;

    constructor(options: LocalGitVFSOptions) {
        super();
        this.repoPath = options.repoPath;
    }

    override async setup(): Promise<void> {
        // Setup logic
    }

    override async enumerate(base_dir: string): Promise<FileEntry[]> {
        // Enumeration not supported without a full tree walk.
        return [];
    }

    override async load_file(path: string): Promise<File> {
        const params = new URLSearchParams({
            repoPath: this.repoPath,
            ref: "HEAD",
            filePath: path,
        });
        const res = await fetch(`/api/git/blob?${params.toString()}`);
        if (!res.ok) {
            throw new Error(
                `LocalGitFileSystem: failed to load ${path}: ${res.status}`
            );
        }
        const blob = await res.blob();
        return new File([blob], path.split("/").pop() ?? "file");
    }
}