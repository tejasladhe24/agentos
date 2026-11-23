import { useEffect, useState } from 'react';

/**
 * Demo portal page — works inside Shell and at the public SPA path `/p/demo`.
 * When opened with `?token=`, probes `/api/ext/demo/portal/status`.
 */
export default function Page() {
  const [status, setStatus] = useState<string>('idle');
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) {
      setStatus('no-token');
      setDetail(
        'Open /p/demo?token=… after minting via POST /api/ext/demo/links/mint',
      );
      return;
    }

    let cancelled = false;
    void (async () => {
      setStatus('loading');
      try {
        const res = await fetch('/api/ext/demo/portal/status', {
          headers: { authorization: `Bearer ${token}` },
        });
        const body = (await res.json()) as {
          ok?: boolean;
          orgId?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setStatus('error');
          setDetail(body.error ?? `HTTP ${res.status}`);
          return;
        }
        setStatus('ok');
        setDetail(`orgId=${body.orgId ?? 'null'}`);
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setDetail(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div data-demo-page style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Demo portal</h1>
      <p data-demo-status={status} style={{ fontSize: 14 }}>
        Status: {status}
      </p>
      {detail ? <p style={{ fontSize: 13, opacity: 0.8 }}>{detail}</p> : null}
    </div>
  );
}
