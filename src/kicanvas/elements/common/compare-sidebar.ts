import { html, CSS } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { compareStore } from "./compare-state.js";

const sidebarStyles = new CSS(`
    :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: #13111c;
        color: #e2e0e7;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
    }

    .sidebar-header {
        padding: 16px 14px 12px;
        border-bottom: 1px solid #2a2833;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .sidebar-header h3 {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        margin: 0;
        color: #e2e0e7;
    }

    .sidebar-header .icon {
        width: 16px;
        height: 16px;
        color: #6366f1;
        flex-shrink: 0;
    }

    .section {
        padding: 14px;
        border-bottom: 1px solid #2a2833;
    }

    .section-label {
        font-size: 11px;
        font-weight: 500;
        color: #6b6578;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
        display: block;
    }

    .input-row {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    input[type="text"], select {
        flex: 1;
        background: #161321;
        border: 1px solid #2a2833;
        color: #e2e0e7;
        padding: 7px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
    }

    input[type="text"]:focus, select:focus {
        border-color: #6366f1;
    }

    input[type="text"]::placeholder {
        color: #6b6578;
        opacity: 0.6;
    }

    select {
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6578' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 10px center;
        padding-right: 28px;
    }

    select option {
        background: #161321;
        color: #e2e0e7;
    }

    .btn {
        padding: 7px 14px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: all 0.15s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        white-space: nowrap;
    }

    .btn-primary {
        background: #6366f1;
        color: #fff;
    }

    .btn-primary:hover:not(:disabled) {
        background: #818cf8;
    }

    .btn-primary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .btn-ghost {
        background: transparent;
        color: #6b6578;
        border: 1px solid #2a2833;
    }

    .btn-ghost:hover {
        color: #e2e0e7;
        border-color: #6b6578;
    }

    .btn-sm {
        padding: 5px 10px;
        font-size: 11px;
    }

    .file-tree {
        list-style: none;
        padding: 0;
        margin: 0;
        max-height: 200px;
        overflow-y: auto;
    }

    .file-tree li {
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: #e2e0e7;
        transition: background 0.1s;
        font-family: 'SF Mono', monospace;
    }

    .file-tree li:hover {
        background: rgba(99, 102, 241, 0.08);
    }

    .file-tree li.active {
        background: rgba(99, 102, 241, 0.15);
        color: #818cf8;
    }

    .file-tree li.empty {
        color: #6b6578;
        font-style: italic;
        cursor: default;
        font-family: inherit;
    }

    .file-tree li.empty:hover {
        background: transparent;
    }

    .file-icon {
        width: 14px;
        height: 14px;
        opacity: 0.6;
        flex-shrink: 0;
    }

    .file-tree li.active .file-icon {
        opacity: 1;
        color: #818cf8;
    }

    .compare-action {
        padding: 14px;
        margin-top: auto;
        border-top: 1px solid #2a2833;
    }

    .compare-btn {
        width: 100%;
        padding: 10px;
        font-size: 13px;
        font-weight: 600;
    }

    .compare-btn svg {
        flex-shrink: 0;
    }

    .sync-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        font-size: 12px;
        color: #6b6578;
        cursor: pointer;
        border-top: 1px solid #2a2833;
    }

    .sync-toggle input[type="checkbox"] {
        width: 14px;
        height: 14px;
        accent-color: #6366f1;
        cursor: pointer;
        margin: 0;
    }

    .commit-meta {
        font-size: 10px;
        color: #6b6578;
        margin-top: 4px;
        padding-left: 2px;
    }

    .local-repo-status {
        background: rgba(99, 102, 241, 0.04);
        border: 1px solid rgba(99, 102, 241, 0.15);
        border-radius: 8px;
        padding: 12px;
        margin: 4px 0;
    }

    .status-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        color: #818cf8;
        font-size: 12px;
        margin-bottom: 4px;
    }

    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
    }

    .status-dot.online {
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
    }

    .status-details {
        font-size: 11px;
        color: #6b6578;
        line-height: 1.4;
    }

    /* Hierarchical spacing */
    .section + .section {
        padding-top: 12px;
    }

    .input-row + .commit-meta {
        margin-top: 6px;
    }
`);

export class KCCompareSidebarElement extends KCUIElement {
    static override styles = [...KCUIElement.styles, sidebarStyles];

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

        const handleFormChange = (e: Event) => {
            const target = e.target as HTMLInputElement | HTMLSelectElement;
            if (!target) return;

            if (target.name === 'repo-path') {
                this.repoPath = (target as HTMLInputElement).value;
            }
            if (target.name === 'commit-a') {
                this.commitA = target.value;
                console.log('[compare-sidebar] commitA set to:', this.commitA);
                this.update();
            }
            if (target.name === 'commit-b') {
                this.commitB = target.value;
                console.log('[compare-sidebar] commitB set to:', this.commitB);
                this.update();
                if (this.commitB) {
                    this.scanForKicadFiles(this.commitB);
                }
            }
            if (target.name === 'sync-toggle') {
                compareStore.setSyncEnabled((target as HTMLInputElement).checked);
            }
        };
        // 'input' fires for text inputs; 'change' fires for <select> elements
        this.renderRoot.addEventListener('input', handleFormChange);
        this.renderRoot.addEventListener('change', handleFormChange);

        window.addEventListener('git-repo-detected', (async (e: CustomEvent) => {
            this.repoPath = e.detail.repoPath;
            this.commits = e.detail.commits;
            this.scanForKicadFiles();
            await this.update();
            this.populateDropdowns();
        }) as unknown as EventListener);

        window.addEventListener('open-compare-panel', () => {
            this.dispatchEvent(new CustomEvent('request-activity-change', {
                detail: { name: 'Compare' },
                bubbles: true,
                composed: true,
            }));
        });
    }

    private populateCommitDropdown(selectEl: HTMLSelectElement, selectedValue: string) {
        selectEl.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select commit...';
        selectEl.appendChild(placeholder);

        for (const c of this.commits) {
            const shortMsg = c.commit.message.split('\n')[0];
            const shortOid = c.oid.slice(0, 7);
            const opt = document.createElement('option');
            opt.value = c.oid;
            opt.textContent = `${shortMsg} (${shortOid})`;
            opt.selected = c.oid === selectedValue;
            selectEl.appendChild(opt);
        }
    }

    private populateDropdowns() {
        const selectA = this.renderRoot.querySelector('select[name="commit-a"]') as HTMLSelectElement;
        const selectB = this.renderRoot.querySelector('select[name="commit-b"]') as HTMLSelectElement;
        if (selectA) {
            this.populateCommitDropdown(selectA, this.commitA);
        }
        if (selectB) {
            this.populateCommitDropdown(selectB, this.commitB);
        }
    }

    override renderedCallback() {
        super.renderedCallback();
        this.populateDropdowns();
    }

    async scanForKicadFiles(ref: string = 'HEAD') {
        if (compareStore.browserFs) {
            this.fileList = (Array.from(compareStore.browserFs.files.keys()) as string[])
                .filter((p) => p.endsWith('.kicad_sch') || p.endsWith('.kicad_pcb'));
            if (this.fileList.length > 0 && !this.selectedFile) {
                this.selectedFile = this.fileList[0] ?? '';
            }
            this.update();
            return;
        }
        if (!this.repoPath) return;
        try {
            const res = await fetch(`/api/git/tree?repo=${encodeURIComponent(this.repoPath)}&ref=${encodeURIComponent(ref)}`);
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
            await this.update();
            this.populateDropdowns();
        }
    }

    startCompare() {
        if (!this.commitA || !this.commitB || !this.selectedFile || !this.repoPath) return;

        console.log('[compare-sidebar] selectedFile:', this.selectedFile);

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

        const fileItems = this.fileList.length
            ? this.fileList.map((path) => html`
                <li class="${path === this.selectedFile ? 'active' : ''}"
                    data-action="pick-file"
                    data-path="${path}">
                    <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    ${path.split('/').pop()}
                </li>
            `)
            : html`<li class="empty">No .kicad files found</li>`;

        const isLocalRepo = !!compareStore.browserFs;

        return html`
            <div class="compare-sidebar">
                <div class="sidebar-header">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    <h3>Compare Studio</h3>
                </div>

                <div class="section">
                    ${isLocalRepo
                        ? html`
                            <div class="local-repo-status">
                                <div class="status-header">
                                    <span class="status-dot online"></span>
                                    <span class="status-text">Local Repository connected</span>
                                </div>
                                <div class="status-details">
                                    Scanning folder picked in browser (${this.commits.length} commits found)
                                </div>
                            </div>
                          `
                        : html`
                            <label class="section-label">Repository</label>
                            <div class="input-row">
                                <input type="text" name="repo-path" .value="${this.repoPath}" placeholder="/path/to/repo" />
                                <button class="btn btn-ghost btn-sm" data-action="load-commits">Load</button>
                            </div>
                          `
                    }
                </div>

                <div class="section">
                    <label class="section-label">File</label>
                    <ul class="file-tree">
                        ${fileItems}
                    </ul>
                </div>

                <div class="section">
                    <label class="section-label">Base Commit (A)</label>
                    <select name="commit-a">
                        <option value="">Select commit...</option>
                    </select>
                </div>

                <div class="section">
                    <label class="section-label">Head Commit (B)</label>
                    <select name="commit-b">
                        <option value="">Select commit...</option>
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