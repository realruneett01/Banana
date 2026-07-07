import { html } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { compareStore } from "./compare-state.js";

export class KCCompareSidebarElement extends KCUIElement {
    private commits: Array<{ oid: string; commit: { message: string } }> = [];
    private repoPath = '';
    private selectedFile = '';
    private commitA = '';
    private commitB = '';
    private fileList: string[] = [];

    constructor() {
        super();
    }

    override connectedCallback() {
        super.connectedCallback();
        compareStore.subscribe(() => this.update());
    }

    override initialContentCallback() {
        // Event delegation for clicks
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
            if (target.closest('[data-action="pick-file"]')) {
                const path = (target.closest('[data-action="pick-file"]') as HTMLElement).dataset['path'];
                if (path) {
                    this.selectedFile = path;
                    this.update();
                }
                return;
            }
        });

        // Event delegation for inputs
        this.renderRoot.addEventListener('input', (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (!target) return;

            if (target.name === 'repo-path') {
                this.repoPath = target.value;
            }
            if (target.name === 'commit-a') {
                this.commitA = target.value;
                this.update();
            }
            if (target.name === 'commit-b') {
                this.commitB = target.value;
                this.update();
            }
            if (target.name === 'sync-toggle') {
                compareStore.setSyncEnabled(target.checked);
            }
        });

        // Listen for git detection from shell (cross-DOM)
        window.addEventListener('git-repo-detected', ((e: CustomEvent) => {
            this.repoPath = e.detail.repoPath;
            this.commits = e.detail.commits;
            // Auto-scan for .kicad files in the repo
            this.scanForKicadFiles();
            this.update();
        }) as EventListener);

        window.addEventListener('open-compare-panel', () => {
            this.dispatchEvent(new CustomEvent('request-activity-change', {
                detail: { name: 'Compare' },
                bubbles: true,
                composed: true,
            }));
        });
    }

    async scanForKicadFiles() {
        if (!this.repoPath) return;
        try {
            const res = await fetch(`/api/git/tree?repo=${encodeURIComponent(this.repoPath)}&ref=HEAD`);
            const data = await res.json();
            if (Array.isArray(data)) {
                this.fileList = data
                    .filter((e: any) => e.type === 'blob')
                    .map((e: any) => e.path)
                    .filter((p: string) => p.endsWith('.kicad_sch') || p.endsWith('.kicad_pcb'));
                if (this.fileList.length > 0 && !this.selectedFile) {
                    this.selectedFile = this.fileList[0] ?? '';
                }
            }
        } catch (e) {
            console.error('Failed to scan repo:', e);
        }
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
            await this.scanForKicadFiles();
            this.update();
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

    override render() {
        const canCompare = this.commitA && this.commitB && this.selectedFile;

        const fileItems = this.fileList.map((path) => html`
            <li class="${path === this.selectedFile ? 'active' : ''}"
                data-action="pick-file"
                data-path="${path}">
                <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                ${path.split('/').pop()}
            </li>
        `);

        const commitOptions = this.commits.map((c) => {
            const shortMsg = c.commit.message.split('\n')[0];
            const shortOid = c.oid.slice(0, 7);
            return html`
                <option value="${c.oid}" ?selected="${c.oid === this.commitA || c.oid === this.commitB}">
                    ${shortMsg} (${shortOid})
                </option>
            `;
        });

        return html`
            <div class="compare-sidebar">
                <div class="sidebar-header">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    <h3>Compare Studio</h3>
                </div>

                <div class="section">
                    <label class="section-label">Repository</label>
                    <div class="input-row">
                        <input type="text" name="repo-path" .value="${this.repoPath}" placeholder="/path/to/repo" />
                        <button class="btn btn-ghost btn-sm" data-action="load-commits">Load</button>
                    </div>
                </div>

                <div class="section">
                    <label class="section-label">File</label>
                    <ul class="file-tree">
                        ${fileItems.length ? fileItems : html`<li style="color:var(--muted);font-style:italic;">No .kicad files found</li>`}
                    </ul>
                </div>

                <div class="section">
                    <label class="section-label">Base Commit (A)</label>
                    <select name="commit-a">
                        <option value="">Select commit...</option>
                        ${commitOptions}
                    </select>
                </div>

                <div class="section">
                    <label class="section-label">Head Commit (B)</label>
                    <select name="commit-b">
                        <option value="">Select commit...</option>
                        ${commitOptions}
                    </select>
                </div>

                <div class="compare-action">
                    <button class="btn btn-primary compare-btn" data-action="start-compare" ?disabled="${!canCompare}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                        Compare Versions
                    </button>
                </div>

                <label class="sync-toggle">
                    <input type="checkbox" name="sync-toggle" .checked="${compareStore.syncEnabled}" />
                    Sync Viewports
                </label>
            </div>
        `;
    }
}

customElements.define('kc-compare-sidebar', KCCompareSidebarElement);