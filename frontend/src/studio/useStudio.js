import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { api } from './api.js';

const STORAGE_KEY = 'banana:studio:project';
const read = (k) => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

/** Everything the Studio shows and does for the active project. The server stays the source of truth. */
export function useStudio() {
  const [projects, setProjects] = useState([]);
  const [project, setProjectName] = useState(() => read(STORAGE_KEY));
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [checks, setChecks] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const fail = useCallback((err) => {
    const text = err?.message || String(err);
    setError(text);
    message.error(text, 6);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const refresh = useCallback(async (name = projectRef.current) => {
    if (!name) return null;
    try {
      const [s, h] = await Promise.all([api.state(name), api.tool('history', { project: name, limit: 50 })]);
      if (projectRef.current !== name) return null;
      setState(s);
      setHistory(h.commits);
      setError('');
      return s;
    } catch (e) {
      if (projectRef.current === name) {
        setState(null);
        setError(e.message);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    setSelected(null);
    setChecks(null);
    setSimulation(null);
    setState(null);
    setHistory([]);
    if (project) {
      write(STORAGE_KEY, project);
      refresh(project);
    }
  }, [project, refresh]);

  const setProject = useCallback((name) => setProjectName(name || ''), []);

  const guarded = useCallback(
    async (label, fn) => {
      setBusy(label);
      try {
        return await fn();
      } catch (e) {
        fail(e);
        return null;
      } finally {
        setBusy('');
      }
    },
    [fail],
  );

  const createProject = useCallback(
    (name, title) =>
      guarded('Creating project', async () => {
        await api.tool('create_project', { project: name, title: title || undefined });
        await refreshProjects();
        setProjectName(name);
        return name;
      }),
    [guarded, refreshProjects],
  );

  /** Applies edit operations and saves them as one build (one undo step). */
  const edit = useCallback(
    (operations, commitMessage, { reroute = false } = {}) =>
      guarded('Applying edit', async () => {
        const name = projectRef.current;
        await api.tool('edit', { project: name, operations, ...(reroute ? {} : { build: commitMessage }) });
        if (reroute) {
          await api.tool('autoroute', { project: name, tryAlternateOrder: true });
          await api.tool('build', { project: name, message: commitMessage });
        }
        await refresh(name);
        return true;
      }),
    [guarded, refresh],
  );

  const movePart = useCallback(
    (ref, x, y, rot) => {
      const routed = (state?.routing?.tracks ?? 0) > 0;
      const ops = [{ op: 'place', ref, x, y, rot }];
      if (routed) ops.push({ op: 'clear_routing' });
      return edit(ops, `Move ${ref}`, { reroute: routed });
    },
    [edit, state],
  );

  const autoroute = useCallback(
    () =>
      guarded('Routing', async () => {
        const name = projectRef.current;
        const r = await api.tool('autoroute', { project: name, tryAlternateOrder: true });
        await api.tool('build', { project: name, message: 'Auto-route' });
        await refresh(name);
        if (r.failedNets?.length) message.warning(`Could not route: ${r.failedNets.join(', ')}`);
        else message.success('All nets routed');
        return r;
      }),
    [guarded, refresh],
  );

  const runChecks = useCallback(
    () =>
      guarded('Running checks', async () => {
        const name = projectRef.current;
        const r = await api.tool('run_checks', { project: name });
        setChecks(r);
        await refresh(name);
        return r;
      }),
    [guarded, refresh],
  );

  const runSimulation = useCallback(
    () =>
      guarded('Simulating', async () => {
        const r = await api.tool('run_simulation', { project: projectRef.current });
        setSimulation(r);
        return r;
      }),
    [guarded],
  );

  const undo = useCallback(
    () =>
      guarded('Undoing', async () => {
        await api.undo(projectRef.current);
        await refresh();
      }),
    [guarded, refresh],
  );

  const redo = useCallback(
    () =>
      guarded('Redoing', async () => {
        await api.redo(projectRef.current);
        await refresh();
      }),
    [guarded, refresh],
  );

  return {
    projects,
    project,
    setProject,
    createProject,
    refreshProjects,
    state,
    history,
    busy,
    error,
    selected,
    setSelected,
    checks,
    simulation,
    refresh,
    edit,
    movePart,
    autoroute,
    runChecks,
    runSimulation,
    undo,
    redo,
  };
}
