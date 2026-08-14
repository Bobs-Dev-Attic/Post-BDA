'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type KeyValue = { id: string; key: string; value: string; enabled: boolean };
type RequestConfig = {
  id: string;
  collection: string;
  name: string;
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: string;
  updatedAt: string;
};
type ProxyResponse = { status: number; statusText: string; duration: number; headers: [string, string][]; body: string; error?: never } | { error: string };
type ResponseState = { status: number; statusText: string; duration: number; headers: KeyValue[]; body: string } | null;

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const storageKey = 'post-bda-workspace-v2';
const blankRow = (): KeyValue => ({ id: crypto.randomUUID(), key: '', value: '', enabled: true });

const createRequest = (overrides: Partial<RequestConfig> = {}): RequestConfig => ({
  id: crypto.randomUUID(),
  collection: 'Default collection',
  name: 'Untitled request',
  method: 'GET',
  url: '',
  params: [blankRow()],
  headers: [{ id: crypto.randomUUID(), key: 'Accept', value: 'application/json', enabled: true }],
  body: '',
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const starterRequest = () => createRequest({
  name: 'JSONPlaceholder users',
  url: 'https://jsonplaceholder.typicode.com/users',
  params: [{ id: crypto.randomUUID(), key: 'team', value: '{{team}}', enabled: true }],
});

export default function Home() {
  const [requests, setRequests] = useState<RequestConfig[]>([]);
  const [activeId, setActiveId] = useState('');
  const [variables, setVariables] = useState<KeyValue[]>([{ id: 'team-var', key: 'team', value: 'platform', enabled: true }]);
  const [response, setResponse] = useState<ResponseState>(null);
  const [responseHeadersOpen, setResponseHeadersOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = readWorkspace();
    if (saved) {
      setRequests(saved.requests);
      setVariables(saved.variables);
      setActiveId(saved.activeId || saved.requests[0]?.id || '');
      return;
    }

    const first = starterRequest();
    setRequests([first]);
    setActiveId(first.id);
  }, []);

  useEffect(() => {
    if (requests.length) localStorage.setItem(storageKey, JSON.stringify({ requests, variables, activeId }));
  }, [activeId, requests, variables]);

  const active = requests.find((request) => request.id === activeId) ?? requests[0];
  const collections = useMemo(() => [...new Set(requests.map((request) => request.collection || 'Default collection'))], [requests]);
  const variableMap = useMemo(() => Object.fromEntries(variables.filter((row) => row.enabled && row.key).map((row) => [row.key, row.value])), [variables]);
  const hydratedUrl = useMemo(() => active ? buildUrl(applyVariables(active.url, variableMap), active.params, variableMap) : '', [active, variableMap]);

  function updateActive(patch: Partial<RequestConfig>) {
    if (!active) return;
    setRequests((current) => current.map((request) => request.id === active.id ? { ...request, ...patch, updatedAt: new Date().toISOString() } : request));
  }

  function updateRow(kind: 'params' | 'headers', id: string, patch: Partial<KeyValue>) {
    if (!active) return;
    updateActive({ [kind]: active[kind].map((row) => row.id === id ? { ...row, ...patch } : row) } as Partial<RequestConfig>);
  }

  function removeRow(kind: 'params' | 'headers', id: string) {
    if (!active) return;
    const nextRows = active[kind].filter((row) => row.id !== id);
    updateActive({ [kind]: nextRows.length ? nextRows : [blankRow()] } as Partial<RequestConfig>);
  }

  function addRequest() {
    const request = createRequest();
    setRequests((current) => [request, ...current]);
    setActiveId(request.id);
    setResponse(null);
  }

  function duplicateRequest() {
    if (!active) return;
    const copy = createRequest({ ...active, id: crypto.randomUUID(), name: `${active.name} copy`, updatedAt: new Date().toISOString() });
    setRequests((current) => [copy, ...current]);
    setActiveId(copy.id);
  }

  function deleteRequest(id: string) {
    setRequests((current) => {
      const next = current.filter((request) => request.id !== id);
      if (!next.length) next.push(starterRequest());
      setActiveId(next[0].id);
      return next;
    });
    setResponse(null);
  }

  async function sendRequest(event: FormEvent) {
    event.preventDefault();
    if (!active) return;

    setIsSending(true);
    setError('');
    setResponse(null);

    try {
      const headers = Object.fromEntries(active.headers.filter((row) => row.enabled && row.key).map((row) => [row.key, applyVariables(row.value, variableMap)]));
      const requestBody = !['GET', 'HEAD'].includes(active.method) ? applyVariables(active.body, variableMap) : '';
      const result = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: active.method, url: hydratedUrl, headers, body: requestBody }),
      });
      const data = await result.json() as ProxyResponse;

      if ('error' in data) throw new Error(data.error);
      setResponse({
        status: data.status,
        statusText: data.statusText,
        duration: data.duration,
        headers: data.headers.map(([key, value]) => ({ id: crypto.randomUUID(), key, value, enabled: true })),
        body: prettyBody(data.body),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.');
    } finally {
      setIsSending(false);
    }
  }

  if (!active) return null;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span>Post-BDA</span><small>API workspace</small></div>
        <button className="primary full" onClick={addRequest}>New request</button>
        <nav className="request-list" aria-label="Saved requests">
          {collections.map((collection) => (
            <div key={collection} className="collection">
              <p>{collection}</p>
              {requests.filter((request) => request.collection === collection).map((request) => (
                <button key={request.id} className={request.id === active.id ? 'request active' : 'request'} onClick={() => setActiveId(request.id)}>
                  <b>{request.method}</b><span>{request.name}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="hero">
          <div>
            <p className="eyebrow">Postman-style API client for Vercel</p>
            <h1>Configure, save, and run HTTP calls.</h1>
          </div>
          <div className="actions"><button className="ghost" onClick={duplicateRequest}>Duplicate</button><button className="ghost danger" onClick={() => deleteRequest(active.id)}>Delete</button></div>
        </header>

        <form className="card composer" onSubmit={sendRequest}>
          <div className="meta-grid">
            <label>Request name<input value={active.name} onChange={(event) => updateActive({ name: event.target.value })} /></label>
            <label>Collection<input value={active.collection} onChange={(event) => updateActive({ collection: event.target.value || 'Default collection' })} /></label>
          </div>
          <div className="urlbar">
            <select value={active.method} onChange={(event) => updateActive({ method: event.target.value })}>{methods.map((method) => <option key={method}>{method}</option>)}</select>
            <input value={active.url} onChange={(event) => updateActive({ url: event.target.value })} placeholder="https://api.example.com/{{version}}/users" />
            <button className="primary" disabled={isSending || !hydratedUrl}>{isSending ? 'Sending…' : 'Send'}</button>
          </div>
          <small>Resolved URL: {hydratedUrl || 'Add an absolute HTTP URL to begin'}</small>
        </form>

        <div className="grid">
          <Editor title="Query parameters" rows={active.params} onAdd={() => updateActive({ params: [...active.params, blankRow()] })} onChange={(id, patch) => updateRow('params', id, patch)} onRemove={(id) => removeRow('params', id)} />
          <Editor title="Headers" rows={active.headers} onAdd={() => updateActive({ headers: [...active.headers, blankRow()] })} onChange={(id, patch) => updateRow('headers', id, patch)} onRemove={(id) => removeRow('headers', id)} />
        </div>

        <section className="card">
          <div className="section-head"><h2>Environment variables</h2><button onClick={() => setVariables((rows) => [...rows, blankRow()])}>Add variable</button></div>
          <Rows rows={variables} onChange={(id, patch) => setVariables((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))} onRemove={(id) => setVariables((rows) => rows.filter((row) => row.id !== id))} />
        </section>

        <section className="card">
          <div className="section-head"><h2>Body</h2><span>Variables are substituted before sending.</span></div>
          <textarea value={active.body} onChange={(event) => updateActive({ body: event.target.value })} placeholder='{"name":"{{userName}}"}' />
        </section>

        <section className="card response">
          <div className="section-head"><h2>Response</h2>{response && <button onClick={() => setResponseHeadersOpen((open) => !open)}>{responseHeadersOpen ? 'Hide headers' : 'Show headers'}</button>}</div>
          {error && <p className="error">{error}</p>}
          {response ? <><div className="status"><b>{response.status} {response.statusText}</b><span>{response.duration} ms</span><span>{response.headers.length} headers</span></div>{responseHeadersOpen && <Rows rows={response.headers} readOnly />}<pre>{response.body}</pre></> : <p className="empty">Send a request to inspect status, headers, timing, and body.</p>}
        </section>
      </section>
    </main>
  );
}

function Editor({ title, rows, onAdd, onChange, onRemove }: { title: string; rows: KeyValue[]; onAdd: () => void; onChange: (id: string, patch: Partial<KeyValue>) => void; onRemove: (id: string) => void }) {
  return <section className="card"><div className="section-head"><h2>{title}</h2><button onClick={onAdd}>Add row</button></div><Rows rows={rows} onChange={onChange} onRemove={onRemove} /></section>;
}

function Rows({ rows, onChange, onRemove, readOnly = false }: { rows: KeyValue[]; onChange?: (id: string, patch: Partial<KeyValue>) => void; onRemove?: (id: string) => void; readOnly?: boolean }) {
  return <div className="rows">{rows.map((row) => <div className="row" key={row.id}><input type="checkbox" checked={row.enabled} disabled={readOnly} onChange={(event) => onChange?.(row.id, { enabled: event.target.checked })} /><input value={row.key} readOnly={readOnly} onChange={(event) => onChange?.(row.id, { key: event.target.value })} placeholder="Key" /><input value={row.value} readOnly={readOnly} onChange={(event) => onChange?.(row.id, { value: event.target.value })} placeholder="Value" />{!readOnly && <button className="icon" onClick={() => onRemove?.(row.id)} aria-label="Remove row">×</button>}</div>)}</div>;
}

function readWorkspace() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as { requests?: RequestConfig[]; variables?: KeyValue[]; activeId?: string };
    if (!parsed.requests?.length) return null;
    return { requests: parsed.requests, variables: parsed.variables ?? [], activeId: parsed.activeId ?? '' };
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

function applyVariables(value: string, variables: Record<string, string>) {
  return value.replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => variables[key] ?? '');
}

function buildUrl(rawUrl: string, params: KeyValue[], variables: Record<string, string>) {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    params.filter((row) => row.enabled && row.key).forEach((row) => url.searchParams.set(row.key, applyVariables(row.value, variables)));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function prettyBody(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
