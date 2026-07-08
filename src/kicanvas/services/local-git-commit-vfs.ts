import { FileSystemBase, type FileEntry } from "./vfs.js";
import git from "isomorphic-git";
import type { BrowserGitFs } from "./browser-git-fs.js";

export interface LocalGitCommitVFSOptions {
    browserFs: BrowserGitFs;
    ref: string;
    filePath?: string;
}

/**
 * Read-only VFS backed by a single local commit SHA using isomorphic-git in-browser.
 */
export class LocalGitCommitFileSystem extends FileSystemBase {
    readonly browserFs: BrowserGitFs;
    readonly ref: string;
    readonly filePath?: string;

    constructor(options: LocalGitCommitVFSOptions) {
        super();
        this.browserFs = options.browserFs;
        this.ref = options.ref;
        this.filePath = options.filePath;
    }

    override async setup(): Promise<void> {
        // Setup logic
    }

    /** Resolve a ref or raw OID to a commit OID. */
    private async resolveCommitOid(ref: string): Promise<string> {
        // If the ref is already a 40-char hex OID, use it directly
        if (/^[0-9a-f]{40}$/i.test(ref)) {
            return ref;
        }
        return git.resolveRef({ fs: this.browserFs.promises, dir: '', ref });
    }

    override async enumerate(base_dir: string): Promise<FileEntry[]> {
        console.log('[LGCVFS-v2] enumerate() called for ref=', this.ref);

        const commitOid = await this.resolveCommitOid(this.ref);
        const { commit } = await git.readCommit({ fs: this.browserFs.promises, dir: '', oid: commitOid });

        const entries: FileEntry[] = [];

        const walk = async (treeOid: string, prefix: string) => {
            const { tree } = await git.readTree({ fs: this.browserFs.promises, dir: '', oid: treeOid });
            for (const entry of tree) {
                const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
                if (entry.type === 'tree') {
                    await walk(entry.oid, entryPath);
                } else if (entry.type === 'blob') {
                    entries.push({ path: entryPath, type: 'file' });
                }
            }
        };

        await walk(commit.tree, '');
        console.log('[LGCVFS-v2] enumerate() found', entries.length, 'files:', entries.map(e => e.path));
        return entries;
    }

    override async load_file(path: string): Promise<File> {
        console.log('[local-git-commit-vfs] resolving ref=', this.ref);
        const commitOid = await this.resolveCommitOid(this.ref);
        console.log('[local-git-commit-vfs] resolved to commitOid=', commitOid);
        const { commit } = await git.readCommit({ fs: this.browserFs.promises, dir: '', oid: commitOid });

        let treeOid = commit.tree;
        const parts = path.split('/').filter(Boolean);

        for (let i = 0; i < parts.length; i++) {
            console.log('[local-git-commit-vfs] calling readTree with dir=', JSON.stringify(''), 'oid=', treeOid);
            const { tree } = await git.readTree({ fs: this.browserFs.promises, dir: '', oid: treeOid });
            const entry = tree.find((e) => e.path === parts[i]);
            if (!entry) {
                throw new Error(`LocalGitCommitFileSystem: Path not found: ${path} (missing ${parts[i]}) at ref ${this.ref}`);
            }
            if (i === parts.length - 1) {
                console.log('[local-git-commit-vfs] calling readBlob with dir=', JSON.stringify(''), 'oid=', entry.oid);
                const { blob } = await git.readBlob({ fs: this.browserFs.promises, dir: '', oid: entry.oid });
                return new File([blob as any], path.split("/").pop() ?? "file");
            }
            treeOid = entry.oid;
        }
        throw new Error(`LocalGitCommitFileSystem: Invalid file path: ${path}`);
    }
}
