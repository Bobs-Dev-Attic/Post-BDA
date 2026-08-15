'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

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
type Collection = { id: string; name: string; requestIds: string[] };
type ResponseState = { status: number; statusText: string; duration: number; headers: KeyValue[]; body: string };
type EditorTab = 'params' | 'headers' | 'body' | 'variables';

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const storageKey = 'post-bda-workspace-v2';
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const blankRow = (): KeyValue => ({ id: uid(), key: '', value: '', enabled: true });

function makeRequest(patch: Partial<RequestConfig> = {}): RequestConfig {
  return {
    id: uid(),
    name: 'New Request',
    method: 'GET',
    url: '',
    params: [blankRow()],
    headers: [{ id: uid(), key: 'Accept', value: 'application/json', enabled: true }],
    body: '',
    createdAt: now(),
    updatedAt: now(),
    ...patch,
  };
}

function seed(): { collections: Collection[]; requests: RequestConfig[] } {
  const sample = makeRequest({
    name: 'List users',
    url: 'https://jsonplaceholder.typicode.com/users?team={{team}}',
  });
  const post = makeRequest({
    name: 'Create post',
    method: 'POST',
    url: 'https://jsonplaceholder.typicode.com/posts',
    body: '{\n  "title": "{{team}}",\n  "body": "hello"\n}',
  });
  return {
    collections: [{ id: uid(), name: 'My Collection', requestIds: [sample.id, post.id] }],
    requests: [sample, post],
  };
}

export default function Home() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [requests, setRequests] = useState<RequestConfig[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [variables, setVariables] = useState<KeyValue[]>([{ id: 'team-var', key: 'team', value: 'platform', enabled: true }]);
  const [responses, setResponses] = useState<Record<string, ResponseState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [editorTab, setEditorTab] = useState<EditorTab>('params');
  const [menu, setMenu] = useState<string>('');
  const [renaming, setRenaming] = useState<string>('');
  const loaded = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const cols: Collection[] = parsed.collections ?? [];
        const reqs: RequestConfig[] = parsed.requests ?? [];
        setCollections(cols);
        setRequests(reqs);
        setVariables(parsed.variables ?? []);
        setExpanded(parsed.expanded ?? Object.fromEntries(cols.map((c) => [c.id, true])));
        const tabs: string[] = (parsed.openTabs ?? []).filter((id: string) => reqs.some((r) => r.id === id));
        const initialTabs = tabs.length ? tabs : reqs.slice(0, 1).map((r) => r.id);
        setOpenTabs(initialTabs);
        setActiveId(parsed.activeId && initialTabs.includes(parsed.activeId) ? parsed.activeId : initialTabs[0] ?? '');
        loaded.current = true;
        return;
      } catch {
        /* fall through to seed */
      }
    }
    const s = seed();
    setCollections(s.collections);
    setRequests(s.requests);
    setExpanded(Object.fromEntries(s.collections.map((c) => [c.id, true])));
    setOpenTabs([s.requests[0].id]);
    setActiveId(s.requests[0].id);
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    localStorage.setItem(storageKey, JSON.stringify({ collections, requests, variables, openTabs, activeId, expanded }));
  }, [collections, requests, variables, openTabs, activeId, expanded]);

  const active = requests.find((r) => r.id === activeId);
  const variableMap = useMemo(
    () => Object.fromEntries(variables.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value])),
    [variables],
  );
  const hydratedUrl = useMemo(
    () =>
      active
        ? buildUrl(
            applyVariables(active.url, variableMap),
            active.params.map((p) => ({ ...p, value: applyVariables(p.value, variableMap) })),
          )
        : '',
    [active, variableMap],
  );

  function requestById(id: string) {
    return requests.find((r) => r.id === id);
  }

  function updateRequest(id: string, patch: Partial<RequestConfig>) {
    setRequests((current) => current.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now() } : r)));
  }

  function updateActive(patch: Partial<RequestConfig>) {
    if (active) updateRequest(active.id, patch);
  }

  function updateRow(kind: 'params' | 'headers', rowId: string, patch: Partial<KeyValue>) {
    if (!active) return;
    updateActive({ [kind]: active[kind].map((row) => (row.id === rowId ? { ...row, ...patch } : row)) } as Partial<RequestConfig>);
  }

  function openRequest(id: string) {
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    setActiveId(id);
    setEditorTab('params');
  }

  function closeTab(id: string) {
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== id);
      if (id === activeId) setActiveId(next[next.length - 1] ?? '');
      return next;
    });
  }

  function addRequest(collectionId: string) {
    const request = makeRequest();
    setRequests((current) => [...current, request]);
    setCollections((cols) => cols.map((c) => (c.id === collectionId ? { ...c, requestIds: [...c.requestIds, request.id] } : c)));
    setExpanded((e) => ({ ...e, [collectionId]: true }));
    openRequest(request.id);
    setRenaming(request.id);
  }

  function addCollection() {
    const collection: Collection = { id: uid(), name: 'New Collection', requestIds: [] };
    setCollections((cols) => [...cols, collection]);
    setExpanded((e) => ({ ...e, [collection.id]: true }));
    setRenaming(collection.id);
    return collection;
  }

  function newRequestForTab() {
    const target = collections[0] ?? addCollection();
    addRequest(target.id);
  }

  function duplicateRequest(id: string) {
    const source = requestById(id);
    if (!source) return;
    const copy = makeRequest({ ...source, id: uid(), name: `${source.name} copy`, createdAt: now(), updatedAt: now() });
    setRequests((current) => [...current, copy]);
    setCollections((cols) =>
      cols.map((c) => (c.requestIds.includes(id) ? { ...c, requestIds: [...c.requestIds, copy.id] } : c)),
    );
    openRequest(copy.id);
  }

  function deleteRequest(id: string) {
    setRequests((current) => current.filter((r) => r.id !== id));
    setCollections((cols) => cols.map((c) => ({ ...c, requestIds: c.requestIds.filter((rid) => rid !== id) })));
    closeTab(id);
  }

  function deleteCollection(id: string) {
    const collection = collections.find((c) => c.id === id);
    if (!collection) return;
    setRequests((current) => current.filter((r) => !collection.requestIds.includes(r.id)));
    collection.requestIds.forEach(closeTab);
    setCollections((cols) => cols.filter((c) => c.id !== id));
  }

  function renameCollection(id: string, name: string) {
    setCollections((cols) => cols.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  async function sendRequest(event: FormEvent) {
    event.preventDefault();
    if (!active) return;
    const id = active.id;
    setSending((s) => ({ ...s, [id]: true }));
    setErrors((e) => ({ ...e, [id]: '' }));
    setResponses((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
    const started = performance.now();
    try {
      const headers = Object.fromEntries(
        active.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, applyVariables(h.value, variableMap)]),
      );
      const init: RequestInit = { method: active.method, headers };
      if (!['GET', 'HEAD'].includes(active.method) && active.body.trim()) init.body = applyVariables(active.body, variableMap);
      const result = await fetch(hydratedUrl, init);
      const body = await result.text();
      setResponses((r) => ({
        ...r,
        [id]: {
          status: result.status,
          statusText: result.statusText,
          duration: Math.round(performance.now() - started),
          headers: Array.from(result.headers.entries()).map(([key, value]) => ({ id: uid(), key, value, enabled: true })),
          body: prettyBody(body),
        },
      }));
    } catch (caught) {
      setErrors((e) => ({ ...e, [id]: caught instanceof Error ? caught.message : 'Request failed' }));
    } finally {
      setSending((s) => ({ ...s, [id]: false }));
    }
  }

  const response = active ? responses[active.id] : undefined;
  const error = active ? errors[active.id] : '';
  const isSending = active ? sending[active.id] : false;

  return (
    <main className="shell" onClick={() => setMenu('')}>
      <aside className="sidebar">
        <div className="side-head">
          <span className="brand">Post-BDA</span>
          <button className="icon-btn" title="New collection" onClick={addCollection} aria-label="New collection">
            +
          </button>
        </div>

        <div className="tree">
          {collections.map((collection) => (
            <div className="tree-collection" key={collection.id}>
              <div className="tree-row collection-row">
                <button
                  className="caret"
                  onClick={() => setExpanded((e) => ({ ...e, [collection.id]: !e[collection.id] }))}
                  aria-label={expanded[collection.id] ? 'Collapse' : 'Expand'}
                >
                  {expanded[collection.id] ? '▾' : '▸'}
                </button>
                <span className="tree-icon">📁</span>
                {renaming === collection.id ? (
                  <input
                    className="rename"
                    autoFocus
                    defaultValue={collection.name}
                    onBlur={(e) => {
                      renameCollection(collection.id, e.target.value.trim() || collection.name);
                      setRenaming('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming('');
                    }}
                  />
                ) : (
                  <span className="tree-label" onDoubleClick={() => setRenaming(collection.id)}>
                    {collection.name}
                  </span>
                )}
                <span className="tree-actions">
                  <button className="icon-btn" title="Add request" onClick={() => addRequest(collection.id)} aria-label="Add request">
                    +
                  </button>
                  <Dots
                    open={menu === collection.id}
                    onToggle={(e) => {
                      e.stopPropagation();
                      setMenu(menu === collection.id ? '' : collection.id);
                    }}
                    items={[
                      { label: 'Add request', onClick: () => addRequest(collection.id) },
                      { label: 'Rename', onClick: () => setRenaming(collection.id) },
                      { label: 'Delete', danger: true, onClick: () => deleteCollection(collection.id) },
                    ]}
                  />
                </span>
              </div>

              {expanded[collection.id] && (
                <div className="tree-children">
                  {collection.requestIds.length === 0 && <div className="tree-empty">No requests yet</div>}
                  {collection.requestIds.map((rid) => {
                    const request = requestById(rid);
                    if (!request) return null;
                    return (
                      <div
                        key={rid}
                        className={rid === activeId ? 'tree-row request-row active' : 'tree-row request-row'}
                        onClick={() => openRequest(rid)}
                      >
                        <span className={`method m-${request.method}`}>{request.method}</span>
                        {renaming === rid ? (
                          <input
                            className="rename"
                            autoFocus
                            defaultValue={request.name}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              updateRequest(rid, { name: e.target.value.trim() || request.name });
                              setRenaming('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setRenaming('');
                            }}
                          />
                        ) : (
                          <span className="tree-label" onDoubleClick={() => setRenaming(rid)}>
                            {request.name}
                          </span>
                        )}
                        <span className="tree-actions">
                          <Dots
                            open={menu === rid}
                            onToggle={(e) => {
                              e.stopPropagation();
                              setMenu(menu === rid ? '' : rid);
                            }}
                            items={[
                              { label: 'Open', onClick: () => openRequest(rid) },
                              { label: 'Rename', onClick: () => setRenaming(rid) },
                              { label: 'Duplicate', onClick: () => duplicateRequest(rid) },
                              { label: 'Delete', danger: true, onClick: () => deleteRequest(rid) },
                            ]}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <div className="tabstrip">
          {openTabs.map((id) => {
            const request = requestById(id);
            if (!request) return null;
            return (
              <div key={id} className={id === activeId ? 'tab active' : 'tab'} onClick={() => setActiveId(id)}>
                <span className={`method m-${request.method}`}>{request.method}</span>
                <span className="tab-name">{request.name}</span>
                <button
                  className="tab-close"
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            className="tab-add"
            title="New request"
            aria-label="New request"
            onClick={newRequestForTab}
          >
            +
          </button>
        </div>

        {active ? (
          <div className="panel">
            <form className="composer" onSubmit={sendRequest}>
              <div className="urlbar">
                <select value={active.method} onChange={(e) => updateActive({ method: e.target.value })} className={`method-select m-${active.method}`}>
                  {methods.map((method) => (
                    <option key={method}>{method}</option>
                  ))}
                </select>
                <input
                  value={active.url}
                  onChange={(e) => updateActive({ url: e.target.value })}
                  placeholder="https://api.example.com/{{version}}/users"
                />
                <button className="send" disabled={isSending || !active.url}>
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </div>
              <small className="resolved">{hydratedUrl || 'Add a URL to begin'}</small>
            </form>

            <div className="editor-tabs">
              {(['params', 'headers', 'body', 'variables'] as EditorTab[]).map((tab) => (
                <button
                  key={tab}
                  className={editorTab === tab ? 'etab active' : 'etab'}
                  onClick={() => setEditorTab(tab)}
                >
                  {tab === 'params' ? 'Params' : tab === 'headers' ? 'Headers' : tab === 'body' ? 'Body' : 'Variables'}
                  {tab === 'params' && countRows(active.params) > 0 && <b className="count">{countRows(active.params)}</b>}
                  {tab === 'headers' && countRows(active.headers) > 0 && <b className="count">{countRows(active.headers)}</b>}
                </button>
              ))}
            </div>

            <div className="editor-body">
              {editorTab === 'params' && (
                <Rows
                  rows={active.params}
                  onAdd={() => updateActive({ params: [...active.params, blankRow()] })}
                  onChange={(id, patch) => updateRow('params', id, patch)}
                  onRemove={(id) => updateActive({ params: active.params.filter((r) => r.id !== id) })}
                />
              )}
              {editorTab === 'headers' && (
                <Rows
                  rows={active.headers}
                  onAdd={() => updateActive({ headers: [...active.headers, blankRow()] })}
                  onChange={(id, patch) => updateRow('headers', id, patch)}
                  onRemove={(id) => updateActive({ headers: active.headers.filter((r) => r.id !== id) })}
                />
              )}
              {editorTab === 'body' && (
                <textarea
                  value={active.body}
                  onChange={(e) => updateActive({ body: e.target.value })}
                  placeholder='{"name":"{{userName}}"}'
                />
              )}
              {editorTab === 'variables' && (
                <Rows
                  rows={variables}
                  onAdd={() => setVariables((rows) => [...rows, blankRow()])}
                  onChange={(id, patch) => setVariables((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))}
                  onRemove={(id) => setVariables((rows) => rows.filter((r) => r.id !== id))}
                />
              )}
            </div>

            <div className="response">
              <div className="response-head">
                <h2>Response</h2>
                {response && (
                  <div className="status">
                    <b className={response.status < 400 ? 'ok' : 'bad'}>
                      {response.status} {response.statusText}
                    </b>
                    <span>{response.duration} ms</span>
                    <span>{response.headers.length} headers</span>
                  </div>
                )}
              </div>
              {error && <p className="error">{error}</p>}
              {response ? (
                <pre>{response.body}</pre>
              ) : (
                !error && <p className="empty">Send a request to inspect status, headers, timing, and body.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="blank">
            <p>Open a request from the sidebar, or create one with the + button.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function Dots({
  open,
  onToggle,
  items,
}: {
  open: boolean;
  onToggle: (e: React.MouseEvent) => void;
  items: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  return (
    <span className="dots-wrap">
      <button className="icon-btn dots" onClick={onToggle} title="More" aria-label="More options">
        ⋯
      </button>
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          {items.map((item) => (
            <button
              key={item.label}
              className={item.danger ? 'menu-item danger' : 'menu-item'}
              onClick={() => {
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function Rows({
  rows,
  onAdd,
  onChange,
  onRemove,
}: {
  rows: KeyValue[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<KeyValue>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rows">
      {rows.map((row) => (
        <div className="row" key={row.id}>
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onChange(row.id, { enabled: e.target.checked })}
            aria-label="Enabled"
          />
          <input value={row.key} onChange={(e) => onChange(row.id, { key: e.target.value })} placeholder="Key" />
          <input value={row.value} onChange={(e) => onChange(row.id, { value: e.target.value })} placeholder="Value" />
          <button className="row-del" onClick={() => onRemove(row.id)} aria-label="Remove row" type="button">
            ×
          </button>
        </div>
      ))}
      <button className="add-row" onClick={onAdd} type="button">
        + Add row
      </button>
    </div>
  );
}

function countRows(rows: KeyValue[]) {
  return rows.filter((r) => r.enabled && r.key).length;
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
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
