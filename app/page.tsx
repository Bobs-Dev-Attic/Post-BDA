'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type KeyValue = { id: string; key: string; value: string; enabled: boolean };
type RequestConfig = {
  id: string;
  name: string;
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: string;
  createdAt: string;
  updatedAt: string;
};
type ResponseState = { status: number; statusText: string; duration: number; headers: KeyValue[]; body: string } | null;

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const storageKey = 'post-bda-workspace';
const blankRow = (): KeyValue => ({ id: crypto.randomUUID(), key: '', value: '', enabled: true });
const sampleRequest = (): RequestConfig => ({
  id: crypto.randomUUID(),
  name: 'JSONPlaceholder users',
  method: 'GET',
  url: 'https://jsonplaceholder.typicode.com/users?team={{team}}',
  params: [blankRow()],
  headers: [{ id: crypto.randomUUID(), key: 'Accept', value: 'application/json', enabled: true }],
  body: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export default function Home() {
  const [requests, setRequests] = useState<RequestConfig[]>([]);
  const [activeId, setActiveId] = useState('');
  const [variables, setVariables] = useState<KeyValue[]>([{ id: 'team-var', key: 'team', value: 'platform', enabled: true }]);
  const [response, setResponse] = useState<ResponseState>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      setRequests(parsed.requests ?? []);
      setVariables(parsed.variables ?? []);
      setActiveId(parsed.activeId ?? parsed.requests?.[0]?.id ?? '');
      return;
    }
    const first = sampleRequest();
    setRequests([first]);
    setActiveId(first.id);
  }, []);

  useEffect(() => {
    if (requests.length) {
      localStorage.setItem(storageKey, JSON.stringify({ requests, variables, activeId }));
    }
  }, [requests, variables, activeId]);

  const active = (requests.find((request) => request.id === activeId) ?? requests[0]) as RequestConfig | undefined;
  const variableMap = useMemo(() => Object.fromEntries(variables.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value])), [variables]);
  const hydratedUrl = useMemo(() => (active ? buildUrl(applyVariables(active.url, variableMap), active.params.map((p) => ({ ...p, value: applyVariables(p.value, variableMap) }))) : ''), [active, variableMap]);

  function updateActive(patch: Partial<RequestConfig>) {
    if (!active) return;
    setRequests((current) => current.map((request) => request.id === active.id ? { ...request, ...patch, updatedAt: new Date().toISOString() } : request));
  }

  function updateRow(kind: 'params' | 'headers', id: string, patch: Partial<KeyValue>) {
    if (!active) return;
    updateActive({ [kind]: active[kind].map((row) => row.id === id ? { ...row, ...patch } : row) } as Partial<RequestConfig>);
  }

  function saveCopy() {
    if (!active) return;
    const copy = { ...active, id: crypto.randomUUID(), name: `${active.name} copy`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setRequests((current) => [copy, ...current]);
    setActiveId(copy.id);
  }

  function createRequest() {
    const request = { ...sampleRequest(), name: 'Untitled request', url: '' };
    setRequests((current) => [request, ...current]);
    setActiveId(request.id);
    setResponse(null);
  }

  function deleteRequest(id: string) {
    setRequests((current) => {
      const next = current.filter((request) => request.id !== id);
      if (!next.length) next.push(sampleRequest());
      setActiveId(next[0].id);
      return next;
    });
  }

  async function sendRequest(event: FormEvent) {
    event.preventDefault();
    setIsSending(true);
    setError('');
    setResponse(null);
    const started = performance.now();
    try {
      if (!active) return;
      const headers = Object.fromEntries(active.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, applyVariables(h.value, variableMap)]));
      const init: RequestInit = { method: active.method, headers };
      if (!['GET', 'HEAD'].includes(active.method) && active.body.trim()) init.body = applyVariables(active.body, variableMap);
      const result = await fetch(hydratedUrl, init);
      const body = await result.text();
      setResponse({
        status: result.status,
        statusText: result.statusText,
        duration: Math.round(performance.now() - started),
        headers: Array.from(result.headers.entries()).map(([key, value]) => ({ id: crypto.randomUUID(), key, value, enabled: true })),
        body: prettyBody(body),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    } finally {
      setIsSending(false);
    }
  }

  if (!active) return null;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span>Post-BDA</span><small>API workspace</small></div>
        <button className="primary full" onClick={createRequest}>New request</button>
        <div className="request-list">
          {requests.map((request) => (
            <button key={request.id} className={request.id === active.id ? 'request active' : 'request'} onClick={() => setActiveId(request.id)}>
              <b>{request.method}</b><span>{request.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="hero">
          <div>
            <p className="eyebrow">Postman-style API client for Vercel</p>
            <h1>Configure, save, and run HTTP calls.</h1>
          </div>
          <button className="ghost danger" onClick={() => deleteRequest(active.id)}>Delete</button>
        </header>

        <form className="card composer" onSubmit={sendRequest}>
          <input className="name" value={active.name} onChange={(e) => updateActive({ name: e.target.value })} aria-label="Request name" />
          <div className="urlbar">
            <select value={active.method} onChange={(e) => updateActive({ method: e.target.value })}>{methods.map((method) => <option key={method}>{method}</option>)}</select>
            <input value={active.url} onChange={(e) => updateActive({ url: e.target.value })} placeholder="https://api.example.com/{{version}}/users" />
            <button className="primary" disabled={isSending || !active.url}>{isSending ? 'Sending…' : 'Send'}</button>
          </div>
          <small>Resolved URL: {hydratedUrl || 'Add a URL to begin'}</small>
        </form>

        <div className="grid">
          <Editor title="Query parameters" rows={active.params} onAdd={() => updateActive({ params: [...active.params, blankRow()] })} onChange={(id, patch) => updateRow('params', id, patch)} />
          <Editor title="Headers" rows={active.headers} onAdd={() => updateActive({ headers: [...active.headers, blankRow()] })} onChange={(id, patch) => updateRow('headers', id, patch)} />
        </div>

        <section className="card">
          <div className="section-head"><h2>Environment variables</h2><button onClick={() => setVariables((rows) => [...rows, blankRow()])}>Add variable</button></div>
          <Rows rows={variables} onChange={(id, patch) => setVariables((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))} />
        </section>

        <section className="card">
          <div className="section-head"><h2>Body</h2><button onClick={saveCopy}>Save copy</button></div>
          <textarea value={active.body} onChange={(e) => updateActive({ body: e.target.value })} placeholder='{"name":"{{userName}}"}' />
        </section>

        <section className="card response">
          <h2>Response</h2>
          {error && <p className="error">{error}</p>}
          {response ? <><div className="status"><b>{response.status} {response.statusText}</b><span>{response.duration} ms</span><span>{response.headers.length} headers</span></div><pre>{response.body}</pre></> : <p className="empty">Send a request to inspect status, headers, timing, and body.</p>}
        </section>
      </section>
    </main>
  );
}

function Editor({ title, rows, onAdd, onChange }: { title: string; rows: KeyValue[]; onAdd: () => void; onChange: (id: string, patch: Partial<KeyValue>) => void }) {
  return <section className="card"><div className="section-head"><h2>{title}</h2><button onClick={onAdd}>Add row</button></div><Rows rows={rows} onChange={onChange} /></section>;
}

function Rows({ rows, onChange }: { rows: KeyValue[]; onChange: (id: string, patch: Partial<KeyValue>) => void }) {
  return <div className="rows">{rows.map((row) => <div className="row" key={row.id}><input type="checkbox" checked={row.enabled} onChange={(e) => onChange(row.id, { enabled: e.target.checked })} /><input value={row.key} onChange={(e) => onChange(row.id, { key: e.target.value })} placeholder="Key" /><input value={row.value} onChange={(e) => onChange(row.id, { value: e.target.value })} placeholder="Value" /></div>)}</div>;
}

function applyVariables(value: string, variables: Record<string, string>) {
  return value.replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => variables[key] ?? '');
}

function buildUrl(rawUrl: string, params: KeyValue[]) {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    params.filter((p) => p.enabled && p.key).forEach((param) => url.searchParams.set(param.key, param.value));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function prettyBody(body: string) {
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}
