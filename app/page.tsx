'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type KeyValue = { id: string; key: string; value: string; enabled: boolean; secret?: boolean };
type RequestConfig = {
  id: string;
  name: string;
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: string;
  auth: Auth;
  createdAt: string;
  updatedAt: string;
};
type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';
type Auth = {
  type: AuthType;
  token: string;
  username: string;
  password: string;
  key: string;
  value: string;
  addTo: 'header' | 'query';
};
type Collection = { id: string; name: string; requestIds: string[] };
type ResponseState = {
  status: number;
  statusText: string;
  duration: number;
  size: number;
  headers: KeyValue[];
  body: string;
  pretty: string;
  isJson: boolean;
  contentType: string;
};
type EditorTab = 'params' | 'auth' | 'headers' | 'body' | 'variables';
type ResponseView = 'pretty' | 'raw' | 'preview' | 'headers';
type WorkspaceData = {
  collections: Collection[];
  requests: RequestConfig[];
  variables: KeyValue[];
  openTabs: string[];
  activeId: string;
  expanded: Record<string, boolean>;
  sessionOnly: boolean;
};
type Envelope = { enc: true; v: number; salt: string; iv: string; ct: string };
type Theme = { id: string; name: string; swatch: string };

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const themes: Theme[] = [
  { id: 'midnight', name: 'Midnight', swatch: '#0b1220' },
  { id: 'graphite', name: 'Graphite', swatch: '#17181c' },
  { id: 'ocean', name: 'Ocean', swatch: '#07222b' },
  { id: 'grape', name: 'Grape', swatch: '#161031' },
  { id: 'light', name: 'Light', swatch: '#f4f6fb' },
];
const storageKey = 'post-bda-workspace-v2';
const themeKey = 'post-bda-theme';
const sidebarKey = 'post-bda-sidebar-w';
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const blankRow = (): KeyValue => ({ id: uid(), key: '', value: '', enabled: true });
const defaultAuth = (): Auth => ({ type: 'none', token: '', username: '', password: '', key: '', value: '', addTo: 'header' });

function normalizeRequest(request: RequestConfig): RequestConfig {
  return { ...request, auth: { ...defaultAuth(), ...request.auth } };
}

// Strip secret values so they are never written to storage (session-only mode).
// Structure is preserved (auth type, api-key name, variable names) — only the
// sensitive values are blanked.
function redactSecrets(ws: WorkspaceData): WorkspaceData {
  return {
    ...ws,
    requests: ws.requests.map((r) => ({ ...r, auth: { ...r.auth, token: '', username: '', password: '', value: '' } })),
    variables: ws.variables.map((v) => (v.secret ? { ...v, value: '' } : v)),
  };
}

function makeRequest(patch: Partial<RequestConfig> = {}): RequestConfig {
  return {
    id: uid(),
    name: 'New Request',
    method: 'GET',
    url: '',
    params: [blankRow()],
    headers: [{ id: uid(), key: 'Accept', value: 'application/json', enabled: true }],
    body: '',
    auth: defaultAuth(),
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
  const [respView, setRespView] = useState<ResponseView>('pretty');
  const [menu, setMenu] = useState<string>('');
  const [renaming, setRenaming] = useState<string>('');
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [salt, setSalt] = useState<Uint8Array | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockModal, setLockModal] = useState<'' | 'set' | 'change'>('');
  const [lockError, setLockError] = useState('');
  const [sessionOnly, setSessionOnly] = useState(false);
  const [theme, setTheme] = useState('midnight');
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [extractOpen, setExtractOpen] = useState(false);
  const [extractPath, setExtractPath] = useState('');
  const [extractName, setExtractName] = useState('');
  const [extractMsg, setExtractMsg] = useState('');
  const loaded = useRef(false);
  const pendingEnvelope = useRef<Envelope | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem(themeKey);
    if (savedTheme) setTheme(savedTheme);
    const savedWidth = Number(localStorage.getItem(sidebarKey));
    if (savedWidth) setSidebarWidth(Math.min(560, Math.max(210, savedWidth)));
  }, []);

  useEffect(() => {
    localStorage.setItem(sidebarKey, String(sidebarWidth));
  }, [sidebarWidth]);

  function startResize(event: React.MouseEvent) {
    event.preventDefault();
    const onMove = (e: MouseEvent) => setSidebarWidth(Math.min(560, Math.max(210, e.clientX)));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  function loadWorkspace(parsed: WorkspaceData) {
    const cols: Collection[] = parsed.collections ?? [];
    const reqs: RequestConfig[] = (parsed.requests ?? []).map(normalizeRequest);
    setCollections(cols);
    setRequests(reqs);
    setVariables(parsed.variables ?? []);
    setExpanded(parsed.expanded ?? Object.fromEntries(cols.map((c) => [c.id, true])));
    const tabs: string[] = (parsed.openTabs ?? []).filter((id: string) => reqs.some((r) => r.id === id));
    const initialTabs = tabs.length ? tabs : reqs.slice(0, 1).map((r) => r.id);
    setOpenTabs(initialTabs);
    setActiveId(parsed.activeId && initialTabs.includes(parsed.activeId) ? parsed.activeId : initialTabs[0] ?? '');
    setSessionOnly(parsed.sessionOnly ?? false);
  }

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.enc) {
          pendingEnvelope.current = parsed as Envelope;
          setLocked(true);
          return; // wait for passphrase; do not mark loaded
        }
        loadWorkspace(parsed as WorkspaceData);
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
    const workspace: WorkspaceData = { collections, requests, variables, openTabs, activeId, expanded, sessionOnly };
    const toStore = sessionOnly ? redactSecrets(workspace) : workspace;
    if (cryptoKey && salt) {
      encryptWorkspace(cryptoKey, salt, toStore)
        .then((env) => localStorage.setItem(storageKey, JSON.stringify(env)))
        .catch(() => {});
    } else {
      localStorage.setItem(storageKey, JSON.stringify(toStore));
    }
  }, [collections, requests, variables, openTabs, activeId, expanded, sessionOnly, cryptoKey, salt]);

  const active = requests.find((r) => r.id === activeId);
  const variableMap = useMemo(
    () => Object.fromEntries(variables.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value])),
    [variables],
  );
  const hydratedUrl = useMemo(() => {
    if (!active) return '';
    const params = active.params.map((p) => ({ ...p, value: applyVariables(p.value, variableMap) }));
    if (active.auth.type === 'apikey' && active.auth.addTo === 'query' && active.auth.key) {
      params.push({
        id: 'auth',
        key: applyVariables(active.auth.key, variableMap),
        value: applyVariables(active.auth.value, variableMap),
        enabled: true,
      });
    }
    return buildUrl(applyVariables(active.url, variableMap), params);
  }, [active, variableMap]);

  function requestById(id: string) {
    return requests.find((r) => r.id === id);
  }

  function updateRequest(id: string, patch: Partial<RequestConfig>) {
    setRequests((current) => current.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now() } : r)));
  }

  function updateActive(patch: Partial<RequestConfig>) {
    if (active) updateRequest(active.id, patch);
  }

  function updateAuth(patch: Partial<Auth>) {
    if (active) updateActive({ auth: { ...active.auth, ...patch } });
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

  function exportWorkspace() {
    const payload = {
      app: 'post-bda',
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: { collections, requests, variables },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `post-bda-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMenu('');
  }

  function importWorkspace(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const ws = parsed.workspace ?? parsed;
        const cols: Collection[] = ws.collections ?? [];
        const reqs: RequestConfig[] = (ws.requests ?? []).map(normalizeRequest);
        if (!cols.length && !reqs.length) throw new Error('empty');
        if (!window.confirm('Import will replace your current workspace. Continue?')) return;
        setCollections(cols);
        setRequests(reqs);
        setVariables(ws.variables ?? []);
        setExpanded(Object.fromEntries(cols.map((c) => [c.id, true])));
        const first = reqs[0]?.id ?? '';
        setOpenTabs(first ? [first] : []);
        setActiveId(first);
      } catch {
        window.alert('That file is not a valid Post-BDA workspace export.');
      }
    };
    reader.readAsText(file);
    setMenu('');
  }

  function setVariable(name: string, value: string) {
    setVariables((rows) => {
      if (rows.some((r) => r.key === name)) {
        return rows.map((r) => (r.key === name ? { ...r, value } : r));
      }
      return [...rows, { id: uid(), key: name, value, enabled: true }];
    });
  }

  function extractToVariable() {
    if (!response) return;
    const name = extractName.trim();
    if (!name) {
      setExtractMsg('Enter a variable name.');
      return;
    }
    try {
      const data = JSON.parse(response.body);
      const val = extractPath.trim() ? resolvePath(data, extractPath.trim()) : data;
      if (val === undefined) {
        setExtractMsg(`No value at "${extractPath.trim()}".`);
        return;
      }
      setVariable(name, typeof val === 'object' ? JSON.stringify(val) : String(val));
      setExtractMsg(`Saved to {{${name}}}.`);
      setExtractPath('');
      setExtractName('');
    } catch {
      setExtractMsg('Response body is not valid JSON.');
    }
  }

  async function unlockWorkspace(passphrase: string) {
    const env = pendingEnvelope.current;
    if (!env) return;
    try {
      const s = fromB64(env.salt);
      const key = await deriveKey(passphrase, s);
      const workspace = await decryptWorkspace(key, env);
      loadWorkspace(workspace);
      setCryptoKey(key);
      setSalt(s);
      setLocked(false);
      setLockError('');
      loaded.current = true;
    } catch {
      setLockError('Incorrect passphrase. Please try again.');
    }
  }

  async function applyPassphrase(passphrase: string) {
    const s = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, s);
    setSalt(s);
    setCryptoKey(key);
    setLockModal('');
  }

  function removeEncryption() {
    setCryptoKey(null);
    setSalt(null);
    // the persist effect will rewrite the workspace as plaintext
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
      applyAuth(headers, active.auth, variableMap);
      const init: RequestInit = { method: active.method, headers };
      if (!['GET', 'HEAD'].includes(active.method) && active.body.trim()) init.body = applyVariables(active.body, variableMap);
      const result = await fetch(hydratedUrl, init);
      const body = await result.text();
      let pretty = body;
      let isJson = false;
      try {
        pretty = JSON.stringify(JSON.parse(body), null, 2);
        isJson = true;
      } catch {
        /* not JSON */
      }
      setRespView('pretty');
      setResponses((r) => ({
        ...r,
        [id]: {
          status: result.status,
          statusText: result.statusText,
          duration: Math.round(performance.now() - started),
          size: new Blob([body]).size,
          headers: Array.from(result.headers.entries()).map(([key, value]) => ({ id: uid(), key, value, enabled: true })),
          body,
          pretty,
          isJson,
          contentType: result.headers.get('content-type') ?? '',
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

  if (locked) {
    return (
      <main className="lock-screen">
        <LockModal mode="unlock" error={lockError} onSubmit={unlockWorkspace} />
      </main>
    );
  }

  return (
    <main className="shell" style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }} onClick={() => setMenu('')}>
      {lockModal && (
        <LockModal
          mode={lockModal}
          error=""
          onSubmit={applyPassphrase}
          onCancel={() => setLockModal('')}
        />
      )}
      <aside className="sidebar">
        <div className="side-head">
          <span className="brand">Post-BDA</span>
          <div className="side-actions">
            <span className="dots-wrap">
              <button
                className="icon-btn"
                title="Settings"
                aria-label="Settings"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === 'settings' ? '' : 'settings');
                }}
              >
                ⚙
              </button>
              {menu === 'settings' && (
                <div className="menu settings-menu" onClick={(e) => e.stopPropagation()}>
                  <div className="menu-label">Theme</div>
                  <div className="theme-grid">
                    {themes.map((t) => (
                      <button
                        key={t.id}
                        className={theme === t.id ? 'swatch active' : 'swatch'}
                        title={t.name}
                        aria-label={t.name}
                        style={{ background: t.swatch }}
                        onClick={() => setTheme(t.id)}
                      />
                    ))}
                  </div>
                  <label className="menu-toggle">
                    <input type="checkbox" checked={sessionOnly} onChange={(e) => setSessionOnly(e.target.checked)} />
                    <span>Session-only secrets</span>
                  </label>
                  <p className="menu-note">
                    When on, tokens, passwords, API keys, and secret variables are kept only in memory and never written to
                    storage — they clear on reload.
                  </p>
                  <div className="menu-label">Workspace</div>
                  <button className="menu-item" onClick={exportWorkspace}>
                    Export to file
                  </button>
                  <button className="menu-item" onClick={() => importRef.current?.click()}>
                    Import from file
                  </button>
                </div>
              )}
            </span>
            <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importWorkspace} />
            {cryptoKey ? (
              <span className="dots-wrap">
                <button
                  className="icon-btn locked-on"
                  title="Encryption enabled"
                  aria-label="Encryption settings"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu === 'lock' ? '' : 'lock');
                  }}
                >
                  🔒
                </button>
                {menu === 'lock' && (
                  <div className="menu" onClick={(e) => e.stopPropagation()}>
                    <button className="menu-item" onClick={() => { setLockModal('change'); setMenu(''); }}>
                      Change passphrase
                    </button>
                    <button className="menu-item danger" onClick={() => { removeEncryption(); setMenu(''); }}>
                      Remove encryption
                    </button>
                  </div>
                )}
              </span>
            ) : (
              <button
                className="icon-btn"
                title="Encrypt stored secrets with a passphrase"
                aria-label="Set passphrase"
                onClick={() => setLockModal('set')}
              >
                🔓
              </button>
            )}
            <button className="icon-btn" title="New collection" onClick={addCollection} aria-label="New collection">
              +
            </button>
          </div>
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

      <div className="resizer" onMouseDown={startResize} role="separator" aria-label="Resize sidebar" aria-orientation="vertical" />

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
            <div className="request-pane">
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
              {(['params', 'auth', 'headers', 'body', 'variables'] as EditorTab[]).map((tab) => (
                <button
                  key={tab}
                  className={editorTab === tab ? 'etab active' : 'etab'}
                  onClick={() => setEditorTab(tab)}
                >
                  {tab === 'params'
                    ? 'Params'
                    : tab === 'auth'
                      ? 'Authorization'
                      : tab === 'headers'
                        ? 'Headers'
                        : tab === 'body'
                          ? 'Body'
                          : 'Variables'}
                  {tab === 'params' && countRows(active.params) > 0 && <b className="count">{countRows(active.params)}</b>}
                  {tab === 'auth' && active.auth.type !== 'none' && <b className="dot" aria-hidden />}
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
              {editorTab === 'auth' && <AuthEditor auth={active.auth} onChange={updateAuth} />}
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
                  secretable
                  onAdd={() => setVariables((rows) => [...rows, blankRow()])}
                  onChange={(id, patch) => setVariables((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))}
                  onRemove={(id) => setVariables((rows) => rows.filter((r) => r.id !== id))}
                />
              )}
            </div>
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
                    <span>{formatBytes(response.size)}</span>
                  </div>
                )}
              </div>

              {error && <p className="error">{error}</p>}

              {response && (
                <div className="response-toolbar">
                  <div className="view-switch">
                    {(['pretty', 'raw', 'preview', 'headers'] as ResponseView[]).map((view) => (
                      <button
                        key={view}
                        className={respView === view ? 'seg active' : 'seg'}
                        onClick={() => setRespView(view)}
                      >
                        {view === 'pretty' ? 'Pretty' : view === 'raw' ? 'Raw' : view === 'preview' ? 'Preview' : 'Headers'}
                        {view === 'headers' && <b className="count">{response.headers.length}</b>}
                      </button>
                    ))}
                  </div>
                  {response.isJson && respView === 'pretty' && <span className="lang-tag">JSON</span>}
                  {response.isJson && (
                    <button
                      className="copy-btn"
                      onClick={() => {
                        setExtractOpen((o) => !o);
                        setExtractMsg('');
                      }}
                    >
                      Extract → var
                    </button>
                  )}
                  <button
                    className={response.isJson ? 'copy-btn' : 'copy-btn push'}
                    onClick={() =>
                      navigator.clipboard?.writeText(respView === 'raw' ? response.body : response.pretty)
                    }
                  >
                    Copy
                  </button>
                </div>
              )}

              {response && extractOpen && (
                <div className="extract">
                  <input
                    className="extract-path"
                    value={extractPath}
                    onChange={(e) => setExtractPath(e.target.value)}
                    placeholder="Path e.g. data.token or items[0].id (blank = whole body)"
                  />
                  <input
                    className="extract-name"
                    value={extractName}
                    onChange={(e) => setExtractName(e.target.value)}
                    placeholder="Variable name"
                  />
                  <button className="send extract-save" type="button" onClick={extractToVariable}>
                    Save
                  </button>
                  {extractMsg && <span className="extract-msg">{extractMsg}</span>}
                </div>
              )}

              {response &&
                (respView === 'headers' ? (
                  <div className="header-table">
                    {response.headers.map((h) => (
                      <div className="header-row" key={h.id}>
                        <span className="h-key">{h.key}</span>
                        <span className="h-val">{h.value}</span>
                      </div>
                    ))}
                  </div>
                ) : respView === 'preview' ? (
                  <iframe className="preview-frame" title="Response preview" sandbox="" srcDoc={response.body} />
                ) : respView === 'raw' ? (
                  <pre className="response-body">{response.body}</pre>
                ) : response.isJson ? (
                  <pre className="response-body json" dangerouslySetInnerHTML={{ __html: highlightJson(response.pretty) }} />
                ) : (
                  <pre className="response-body">{response.pretty}</pre>
                ))}

              {!response && !error && (
                <p className="empty">Send a request to inspect status, headers, timing, and body.</p>
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

const authTypes: { value: AuthType; label: string }[] = [
  { value: 'none', label: 'No Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apikey', label: 'API Key' },
];

function AuthEditor({ auth, onChange }: { auth: Auth; onChange: (patch: Partial<Auth>) => void }) {
  return (
    <div className="auth">
      <label className="auth-field">
        <span>Type</span>
        <select value={auth.type} onChange={(e) => onChange({ type: e.target.value as AuthType })}>
          {authTypes.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {auth.type === 'none' && <p className="auth-hint">This request does not use any authorization.</p>}

      {auth.type === 'bearer' && (
        <label className="auth-field">
          <span>Token</span>
          <input value={auth.token} onChange={(e) => onChange({ token: e.target.value })} placeholder="{{token}} or paste token" />
        </label>
      )}

      {auth.type === 'basic' && (
        <>
          <label className="auth-field">
            <span>Username</span>
            <input value={auth.username} onChange={(e) => onChange({ username: e.target.value })} placeholder="Username" />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input value={auth.password} onChange={(e) => onChange({ password: e.target.value })} placeholder="Password" type="password" />
          </label>
        </>
      )}

      {auth.type === 'apikey' && (
        <>
          <label className="auth-field">
            <span>Key</span>
            <input value={auth.key} onChange={(e) => onChange({ key: e.target.value })} placeholder="X-API-Key" />
          </label>
          <label className="auth-field">
            <span>Value</span>
            <input value={auth.value} onChange={(e) => onChange({ value: e.target.value })} placeholder="{{apiKey}} or value" />
          </label>
          <label className="auth-field">
            <span>Add to</span>
            <select value={auth.addTo} onChange={(e) => onChange({ addTo: e.target.value as 'header' | 'query' })}>
              <option value="header">Header</option>
              <option value="query">Query Param</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}

function LockModal({
  mode,
  error,
  onSubmit,
  onCancel,
}: {
  mode: 'unlock' | 'set' | 'change';
  error: string;
  onSubmit: (passphrase: string) => void;
  onCancel?: () => void;
}) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');
  const needsConfirm = mode !== 'unlock';
  const title = mode === 'unlock' ? 'Unlock workspace' : mode === 'change' ? 'Change passphrase' : 'Set a passphrase';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (needsConfirm) {
      if (pass.length < 6) {
        setLocalError('Use at least 6 characters.');
        return;
      }
      if (pass !== confirm) {
        setLocalError('Passphrases do not match.');
        return;
      }
    } else if (!pass) {
      setLocalError('Enter your passphrase.');
      return;
    }
    onSubmit(pass);
  }

  return (
    <div className="lock-backdrop" onClick={onCancel}>
      <form className="lock-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{title}</h2>
        <p className="lock-hint">
          {mode === 'unlock'
            ? 'This workspace is encrypted. Enter your passphrase to unlock it.'
            : 'Your workspace — including tokens, passwords, API keys, and variables — is encrypted at rest with AES-GCM. If you forget this passphrase, the data cannot be recovered.'}
        </p>
        <input
          type="password"
          autoFocus
          placeholder="Passphrase"
          value={pass}
          onChange={(e) => {
            setPass(e.target.value);
            setLocalError('');
          }}
        />
        {needsConfirm && (
          <input
            type="password"
            placeholder="Confirm passphrase"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setLocalError('');
            }}
          />
        )}
        {(localError || error) && <p className="lock-error">{localError || error}</p>}
        <div className="lock-actions">
          {onCancel && (
            <button type="button" className="btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="send">
            {mode === 'unlock' ? 'Unlock' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Rows({
  rows,
  onAdd,
  onChange,
  onRemove,
  secretable,
}: {
  rows: KeyValue[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<KeyValue>) => void;
  onRemove: (id: string) => void;
  secretable?: boolean;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  return (
    <div className="rows">
      {rows.map((row) => (
        <div className={secretable ? 'row secretable' : 'row'} key={row.id}>
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onChange(row.id, { enabled: e.target.checked })}
            aria-label="Enabled"
          />
          <input value={row.key} onChange={(e) => onChange(row.id, { key: e.target.value })} placeholder="Key" />
          {secretable ? (
            <div className="value-wrap">
              <input
                type={row.secret && !revealed[row.id] ? 'password' : 'text'}
                value={row.value}
                onChange={(e) => onChange(row.id, { value: e.target.value })}
                placeholder="Value"
              />
              {row.secret && (
                <button
                  className="eye"
                  type="button"
                  title={revealed[row.id] ? 'Hide value' : 'Show value'}
                  aria-label={revealed[row.id] ? 'Hide value' : 'Show value'}
                  onClick={() => setRevealed((r) => ({ ...r, [row.id]: !r[row.id] }))}
                >
                  {revealed[row.id] ? '🙈' : '👁'}
                </button>
              )}
            </div>
          ) : (
            <input value={row.value} onChange={(e) => onChange(row.id, { value: e.target.value })} placeholder="Value" />
          )}
          {secretable && (
            <button
              className={row.secret ? 'secret-toggle on' : 'secret-toggle'}
              type="button"
              title={row.secret ? 'Secret (value masked)' : 'Mark as secret'}
              aria-label={row.secret ? 'Unmark secret' : 'Mark as secret'}
              aria-pressed={!!row.secret}
              onClick={() => onChange(row.id, { secret: !row.secret })}
            >
              {row.secret ? '🔒' : '🔓'}
            </button>
          )}
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

function applyAuth(headers: Record<string, string>, auth: Auth, variables: Record<string, string>) {
  const v = (value: string) => applyVariables(value, variables);
  if (auth.type === 'bearer' && auth.token) {
    headers['Authorization'] = `Bearer ${v(auth.token)}`;
  } else if (auth.type === 'basic' && (auth.username || auth.password)) {
    headers['Authorization'] = `Basic ${btoa(`${v(auth.username)}:${v(auth.password)}`)}`;
  } else if (auth.type === 'apikey' && auth.addTo === 'header' && auth.key) {
    headers[v(auth.key)] = v(auth.value);
  }
  // apikey + query is applied to the URL, not headers
}

// Resolve a dot/bracket path like "data.items[0].id" against a parsed JSON value.
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightJson(json: string) {
  const escaped = escapeHtml(json);
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'j-num';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'j-key' : 'j-str';
      } else if (/true|false/.test(match)) {
        cls = 'j-bool';
      } else if (/null/.test(match)) {
        cls = 'j-null';
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toB64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function fromB64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 150000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptWorkspace(key: CryptoKey, salt: Uint8Array, workspace: WorkspaceData): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(workspace));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { enc: true, v: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(cipher)) };
}

async function decryptWorkspace(key: CryptoKey, env: Envelope): Promise<WorkspaceData> {
  const iv = fromB64(env.iv);
  const cipher = fromB64(env.ct);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as WorkspaceData;
}
