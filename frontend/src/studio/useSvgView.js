import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

function parseViewBox(svg) {
  const m = /<svg\b[^>]*\bviewBox="([^"]+)"/.exec(svg);
  const v = m?.[1].trim().split(/\s+/).map(Number);
  return v && v.length === 4 && v.every(Number.isFinite) ? v : null;
}

/**
 * Fetches KiCad's own SVG for the board or schematic and exposes it as a blob URL. The previous picture stays
 * on screen while the next one renders, so edits never flash an empty canvas. `token` forces a refetch.
 */
export function useSvgView({ project, kind, view, rev, token, enabled = true }) {
  const [result, setResult] = useState({ url: null, vb: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const urlRef = useRef(null);
  const keyRef = useRef('');

  useEffect(() => {
    if (!enabled || !project) return undefined;
    const key = `${project}|${kind}|${view}|${rev}`;
    if (keyRef.current && keyRef.current.split('|')[0] !== project) setResult({ url: null, vb: null });
    keyRef.current = key;
    let cancelled = false;
    setLoading(true);
    api
      .viewSvg(project, kind, { view, rev })
      .then((svg) => {
        if (cancelled) return;
        const vb = parseViewBox(svg);
        if (!vb) throw new Error('KiCad returned an unreadable drawing');
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        const old = urlRef.current;
        urlRef.current = url;
        setResult({ url, vb });
        setError('');
        if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project, kind, view, rev, token, enabled]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return { ...result, loading, error };
}
