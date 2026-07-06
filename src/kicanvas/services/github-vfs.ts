/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import {
    basename,
    dirname,
    extension,
    normalize_join,
    based_on,
} from "../../base/paths";
import { GitHub, GitHubUserContent, type GitHubURLInfo } from "./github";
import { FileSystemBase, type FileEntry } from "./vfs";

const gh_user_content = new GitHubUserContent();
const gh = new GitHub();

/**
 * Virtual file system for GitHub.
 */
export class GitHubFileSystem extends FileSystemBase {
    private download_urls: Map<string, URL>;

    /**
     * If the user linked directly to a single .kicad_sch/.kicad_pcb file
     * (a "blob" URL), this holds that file's path relative to the repo
     * folder we're browsing. We still enumerate that file's containing
     * directory (and recurse into any sheets it references) through the
     * GitHub API so hierarchical/child sheets can be found - we just also
     * prefetch this one file directly so it's available immediately.
     */
    public readonly initial_file?: string;

    constructor(
        url: string | URL,
        private gh_repo: GitHubURLInfo,
        initial_file?: string,
    ) {
        super();
        this.download_urls = new Map<string, URL>();
        this.initial_file = initial_file;

        // Prefetch the exact linked file directly from
        // raw.githubusercontent.com so it's available without waiting on
        // the Contents API call that enumerate() below will also make.
        if (initial_file) {
            const guc_url = gh_user_content.convert_url(url);
            this.download_urls.set(initial_file, guc_url);
        }
    }

    async load_file(path: string): Promise<File> {
        const download_url = this.download_urls.get(path);
        if (!download_url) {
            throw new Error(`File ${path} not found!`);
        }

        return await gh_user_content.get(download_url);
    }

    async enumerate(cur_dir: string): Promise<FileEntry[]> {
        const base_dir = this.gh_repo.path ?? "";
        const full_path = normalize_join(base_dir, cur_dir);

        const contents = await gh.repos_contents(
            this.gh_repo.owner,
            this.gh_repo.repo,
            full_path,
            this.gh_repo.ref,
        );

        const result: FileEntry[] = [];
        for (const it of contents) {
            if (it.type === "file" && GitHubFileSystem.is_kicad_file(it.name)) {
                const path = decodeURI(it.path);
                const file_path = based_on(base_dir, path);

                if (!this.download_urls.has(file_path)) {
                    const download_url = it.download_url
                        ? new URL(it.download_url)
                        : new URL(
                              `https://raw.githubusercontent.com/${this.gh_repo.owner}/${this.gh_repo.repo}/${this.gh_repo.ref || "HEAD"}/${it.path}`,
                          );
                    this.download_urls.set(file_path, download_url);
                }

                result.push({
                    type: "file",
                    path: file_path,
                });
            } else if (it.type === "dir") {
                const path = decodeURI(it.path);
                const dir_path = based_on(base_dir, path);

                result.push({
                    type: "directory",
                    path: dir_path,
                });
            }
        }

        return result;
    }

    public static async fromURLs(
        url: string | URL,
    ): Promise<GitHubFileSystem | null> {
        const info = GitHub.parse_url(url);

        if (!info) {
            return null;
        }

        // Link to the root of a repo, treat it as tree using HEAD
        if (info.type == "root") {
            info.ref = "HEAD";
            info.type = "tree";
        }

        // If the link points at a single kicad_sch/kicad_pcb file, remember
        // it (so it can be prefetched and later focused as the active
        // page), but still browse its containing directory via the API so
        // that any sibling/child sheets it references can be discovered
        // and loaded too - a single-file link no longer means "ignore the
        // rest of the folder".
        let initial_file: string | undefined;
        if (info.type === "blob") {
            const ext_name = extension(info.path!);
            if (["kicad_sch", "kicad_pcb"].includes(ext_name)) {
                initial_file = basename(info.path!);
                info.path = dirname(info.path!);
            } else {
                // Link to non-kicad file, try using the containing directory.
                info.type = "tree";
                if (ext_name.length !== 0) {
                    info.path = dirname(info.path!);
                }
            }
        }

        return new GitHubFileSystem(url, info, initial_file);
    }
}

/**
 * Authenticated virtual file system for GitHub.
 * Routes directory traversal and file loading securely through `/api/contents`.
 */
export class AuthenticatedGitHubFileSystem extends FileSystemBase {
    public readonly initial_file?: string;

    constructor(
        private owner: string,
        private repo: string,
        private ref: string,
        initial_file?: string,
    ) {
        super();
        this.initial_file = initial_file;
    }

    async load_file(path: string): Promise<File> {
        const params = new URLSearchParams({
            owner: this.owner,
            repo: this.repo,
            path: path,
        });
        if (this.ref) {
            params.set("ref", this.ref);
        }

        const response = await fetch(`/api/contents?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${path}`);
        }

        const blob = await response.blob();
        const fileName = basename(path) ?? "unknown";
        return new File([blob], fileName);
    }

    async enumerate(cur_dir: string): Promise<FileEntry[]> {
        const params = new URLSearchParams({
            owner: this.owner,
            repo: this.repo,
            path: cur_dir,
        });
        if (this.ref) {
            params.set("ref", this.ref);
        }

        const response = await fetch(`/api/contents?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to list directory: ${cur_dir}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
            // Expected a directory but got a file
            return [];
        }

        const result: FileEntry[] = [];
        for (const it of data) {
            if (
                it.type === "file" &&
                AuthenticatedGitHubFileSystem.is_kicad_file(it.name)
            ) {
                result.push({
                    type: "file",
                    path: decodeURI(it.path),
                });
            } else if (it.type === "dir") {
                result.push({
                    type: "directory",
                    path: decodeURI(it.path),
                });
            }
        }
        return result;
    }
}
