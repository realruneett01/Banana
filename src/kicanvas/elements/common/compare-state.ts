export interface CompareSelection {
    repoPath: string;
    filePath: string;
    commitA: string;
    commitB: string;
}

class CompareStore {
    private static instance: CompareStore;

    selection: CompareSelection | null = null;
    syncEnabled = true;
    viewMode: 'side-by-side' | 'overlay' = 'side-by-side';
    browserFs: any = null;

    private listeners = new Set<() => void>();

    private constructor() {}

    static getInstance(): CompareStore {
        if (!CompareStore.instance) {
            CompareStore.instance = new CompareStore();
        }
        return CompareStore.instance;
    }

    setSelection(sel: CompareSelection) {
        this.selection = sel;
        this.notify();
    }

    clearSelection() {
        this.selection = null;
        this.browserFs = null;
        this.notify();
    }

    setSyncEnabled(v: boolean) {
        this.syncEnabled = v;
        this.notify();
    }

    setViewMode(mode: 'side-by-side' | 'overlay') {
        this.viewMode = mode;
        this.notify();
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private notify() {
        for (const fn of this.listeners) fn();
    }
}

export const compareStore = CompareStore.getInstance();