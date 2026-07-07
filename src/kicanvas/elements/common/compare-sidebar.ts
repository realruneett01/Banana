import { html } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { compareStore } from "./compare-state.js";

export class KCCompareSidebarElement extends KCUIElement {
    private commits: Array<{ oid: string; commit: { message: string } }> = [];
    private repoPath = '';
    private selectedFile = '';
    private commitA = '';
    private commitB = '';

    constructor() {
        super();
    }

    override connectedCallback() {
        super.connectedCallback();
        compareStore.subscribe(() => this.update());
    }

    override initialContentCallback() {
        // Event delegation for all sidebar interactions
        this.renderRoot.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            if (target.closest('[data-action="load-commits"]')) {
                this.loadCommits();
                return;
            }
            if (target.closest('[data-action="start-compare"]')) {
                this.startCompare();
                return;
            }
        });

        this.renderRoot.addEventListener('input', (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (!target) return;

            if (target.name === 'repo-path') {
                this.repoPath = target.value;
            }
            if (target.name === 'file-path') {
                this.selectedFile = target.value;
            }
            if (target.name === 'commit-a') {
                this.commitA = target.value;
            }
            if (target.name === 'commit-b') {
                this.commitB = target.value;
            }
            if (target.name === 'sync-toggle') {
                compareStore.setSyncEnabled(target.checked);
            }
        });

        // Listen for git-repo-detected from the shell (Bug 4 fix)
        window.addEventListener('git-repo-detected', ((e: CustomEvent) => {
            this.repoPath = e.detail.repoPath;
            this.commits = e.detail.commits;
            this.update();
        }) as EventListener);
    }

    override render() {
        const commitOptions = this.commits.map(
            (c) => html`
                <option value="${c.oid}" ?selected="${c.oid === this.commitA || c.oid === this.commitB}">
                    ${c.commit.message.split('\n')[0]} (${c.oid.slice(0, 7)})
                </option>
            `
        );

        const canCompare = this.commitA && this.commitB && this.selectedFile;

        return html`
            <div class="compare-sidebar">
                <h3>Compare Studio</h3>

                <div class="section">
                    <label>Repo Path</label>
                    <input type="text" name="repo-path" .value="${this.repoPath}" placeholder="/absolute/path/to/repo" />
                    <button data-action="load-commits">Load Commits</button>
                </div>

                <div class="section">
                    <label>File Path</label>
                    <input type="text" name="file-path" .value="${this.selectedFile}" placeholder="relative/path/to/file.kicad_sch" />
                </div>

                <div class="section">
                    <label>Base (A)</label>
                    <select name="commit-a">
                        <option value="">Select…</option>
                        ${commitOptions}
                    </select>
                </div>

                <div class="section">
                    <label>Head (B)</label>
                    <select name="commit-b">
                        <option value="">Select…</option>
                        ${commitOptions}
                    </select>
                </div>

                <div class="section">
                    <button data-action="start-compare" ?disabled="${!canCompare}">Compare</button>
                </div>

                <div class="section sync-toggle">
                    <label>
                        <input type="checkbox" name="sync-toggle" .checked="${compareStore.syncEnabled}" />
                        Sync Viewports
                    </label>
                </div>
            </div>
        `;
    }

    async loadCommits() {
        if (!this.repoPath) return;
        const res = await fetch('/api/git/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoPath: this.repoPath }),
        });
        const data = await res.json();
        if (data.hasGit) {
            this.commits = data.commits;
            this.update();
        } else {
            alert('No .git found at that path');
        }
    }

    startCompare() {
        if (!this.commitA || !this.commitB || !this.selectedFile || !this.repoPath) return;

        compareStore.setSelection({
            repoPath: this.repoPath,
            filePath: this.selectedFile,
            commitA: this.commitA,
            commitB: this.commitB,
        });

        this.dispatchEvent(
            new CustomEvent('compare-git-commits', {
                bubbles: true,
                composed: true,
                detail: {
                    repoPath: this.repoPath,
                    filePath: this.selectedFile,
                    commitA: this.commitA,
                    commitB: this.commitB,
                },
            })
        );
    }
}