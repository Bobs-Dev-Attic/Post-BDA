'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type KeyValue = { id: string; key: string; value: string; enabled: boolean; secret?: boolean };
type ExtractSource = 'body' | 'header';
type ExtractRule = { id: string; path: string; variable: string; enabled: boolean; source?: ExtractSource; pattern?: string };
type RequestConfig = {
  id: string;
  name: string;
  method: string;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: string;
  auth: Auth;
  extractRules?: ExtractRule[];
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
type Collection = { id: string; name: string; requestIds: string[]; variables?: KeyValue[] };
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
type ExecOutcome = {
  url: string;
  durationMs: number;
  status: number;
  error?: string;
  responseState?: ResponseState;
  headers?: Headers;
  body: string;
};
type RunnerStepStatus = { state: 'pending' | 'running' | 'ok' | 'fail'; status?: number; ms?: number; note?: string };
type EditorTab = 'params' | 'auth' | 'headers' | 'body' | 'variables' | 'extract';
type ResponseView = 'pretty' | 'raw' | 'preview' | 'headers';
type RequestSnapshot = Pick<RequestConfig, 'method' | 'url' | 'params' | 'headers' | 'body' | 'auth'>;
type HistoryEntry = {
  id: string;
  requestId: string;
  name: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  error?: string;
  durationMs: number;
  at: string;
  snapshot: RequestSnapshot;
};
type SidebarView = 'collections' | 'history' | 'runbooks';
type Runbook = { id: string; name: string; stepIds: string[] };
type WorkspaceData = {
  collections: Collection[];
  requests: RequestConfig[];
  variables?: KeyValue[]; // legacy global variables — migrated onto collections on load
  openTabs: string[];
  activeId: string;
  expanded: Record<string, boolean>;
  sessionOnly: boolean;
  history: HistoryEntry[];
  runbooks?: Runbook[];
};

const HISTORY_LIMIT = 100;
type Envelope = { enc: true; v: number; salt: string; iv: string; ct: string };
type Theme = { id: string; name: string; swatch: string };

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
// Common regex snippets offered as autocomplete when extracting part of a value.
const commonRegex = [
  'Bearer (.+)',
  'session=([^;]+)',
  '"token":"([^"]+)"',
  '([0-9a-fA-F-]{36})',
  '(\\d+)',
  '^(\\d+)',
  '(\\d+)$',
];
const themes: Theme[] = [
  { id: 'midnight', name: 'Midnight', swatch: '#0b1220' },
  { id: 'graphite', name: 'Graphite', swatch: '#17181c' },
  { id: 'ocean', name: 'Ocean', swatch: '#07222b' },
  { id: 'grape', name: 'Grape', swatch: '#161031' },
  { id: 'light', name: 'Light', swatch: '#f4f6fb' },
  { id: 'contrast', name: 'High contrast', swatch: '#000000' },
  { id: 'lowlight', name: 'Low light', swatch: '#12100b' },
  { id: 'monotone', name: 'Monotone', swatch: '#101215' },
];
const storageKey = 'post-bda-workspace-v2';
const themeKey = 'post-bda-theme';
const sidebarKey = 'post-bda-sidebar-w';
const responseKey = 'post-bda-response-h';
const syncCodeKey = 'post-bda-sync-code';
const autoSyncKey = 'post-bda-autosync';
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
  const blankAuth = <T extends { auth: Auth }>(r: T): T => ({
    ...r,
    auth: { ...r.auth, token: '', username: '', password: '', value: '' },
  });
  return {
    ...ws,
    requests: ws.requests.map(blankAuth),
    collections: ws.collections.map((c) => ({
      ...c,
      variables: (c.variables ?? []).map((v) => (v.secret ? { ...v, value: '' } : v)),
    })),
    history: ws.history.map((h) => ({ ...h, snapshot: blankAuth(h.snapshot) })),
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
    extractRules: [],
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
    collections: [
      {
        id: uid(),
        name: 'My Collection',
        requestIds: [sample.id, post.id],
        variables: [{ id: uid(), key: 'team', value: 'platform', enabled: true }],
      },
    ],
    requests: [sample, post],
  };
}

export default function Home() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [requests, setRequests] = useState<RequestConfig[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sidebarView, setSidebarView] = useState<SidebarView>('collections');
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [runnerStepIds, setRunnerStepIds] = useState<string[]>([]);
  const [runnerDisabled, setRunnerDisabled] = useState<Record<string, boolean>>({});
  const [runnerStatus, setRunnerStatus] = useState<Record<string, RunnerStepStatus>>({});
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [runnerStopOnError, setRunnerStopOnError] = useState(true);
  const [runnerTitle, setRunnerTitle] = useState('Run in order');
  const [theme, setTheme] = useState('midnight');
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [responseHeight, setResponseHeight] = useState(320);
  const [extractOpen, setExtractOpen] = useState(false);
  const [extractPath, setExtractPath] = useState('');
  const [extractName, setExtractName] = useState('');
  const [extractMsg, setExtractMsg] = useState('');
  const [extractSource, setExtractSource] = useState<ExtractSource>('body');
  const [extractPattern, setExtractPattern] = useState('');
  const [ruleMsgs, setRuleMsgs] = useState<Record<string, string>>({});
  const [syncCode, setSyncCode] = useState('');
  const [autoSync, setAutoSync] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const loaded = useRef(false);
  const pendingEnvelope = useRef<Envelope | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const passphraseRef = useRef('');
  const autoPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPulledRef = useRef(false);
  const suppressPushRef = useRef(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem(themeKey);
    if (savedTheme) setTheme(savedTheme);
    setSyncCode(localStorage.getItem(syncCodeKey) ?? '');
    setAutoSync(localStorage.getItem(autoSyncKey) === '1');
    const savedWidth = Number(localStorage.getItem(sidebarKey));
    if (savedWidth) setSidebarWidth(Math.min(560, Math.max(210, savedWidth)));
    const savedHeight = Number(localStorage.getItem(responseKey));
    if (savedHeight) setResponseHeight(Math.max(120, savedHeight));
  }, []);

  useEffect(() => {
    localStorage.setItem(sidebarKey, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(responseKey, String(responseHeight));
  }, [responseHeight]);

  function startResize(event: React.PointerEvent) {
    event.preventDefault();
    const onMove = (e: PointerEvent) => setSidebarWidth(Math.min(560, Math.max(210, e.clientX)));
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function startResizeResponse(event: React.PointerEvent) {
    event.preventDefault();
    const onMove = (e: PointerEvent) =>
      setResponseHeight(Math.min(window.innerHeight * 0.85, Math.max(120, window.innerHeight - e.clientY)));
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  function loadWorkspace(parsed: WorkspaceData) {
    const legacy = parsed.variables ?? [];
    const cols: Collection[] = (parsed.collections ?? []).map((c) => ({
      ...c,
      // migrate legacy global variables into each collection that lacks its own
      variables: c.variables ?? legacy.map((v) => ({ ...v, id: uid() })),
    }));
    const reqs: RequestConfig[] = (parsed.requests ?? []).map(normalizeRequest);
    setCollections(cols);
    setRequests(reqs);
    setExpanded(parsed.expanded ?? Object.fromEntries(cols.map((c) => [c.id, true])));
    const tabs: string[] = (parsed.openTabs ?? []).filter((id: string) => reqs.some((r) => r.id === id));
    const initialTabs = tabs.length ? tabs : reqs.slice(0, 1).map((r) => r.id);
    setOpenTabs(initialTabs);
    setActiveId(parsed.activeId && initialTabs.includes(parsed.activeId) ? parsed.activeId : initialTabs[0] ?? '');
    setSessionOnly(parsed.sessionOnly ?? false);
    setHistory(parsed.history ?? []);
    setRunbooks(parsed.runbooks ?? []);
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
    const workspace: WorkspaceData = { collections, requests, openTabs, activeId, expanded, sessionOnly, history, runbooks };
    const toStore = sessionOnly ? redactSecrets(workspace) : workspace;
    if (cryptoKey && salt) {
      encryptWorkspace(cryptoKey, salt, toStore)
        .then((env) => localStorage.setItem(storageKey, JSON.stringify(env)))
        .catch(() => {});
    } else {
      localStorage.setItem(storageKey, JSON.stringify(toStore));
    }
  }, [collections, requests, openTabs, activeId, expanded, sessionOnly, history, runbooks, cryptoKey, salt]);

  // Automatic cloud sync: debounced push whenever the workspace changes.
  useEffect(() => {
    if (!loaded.current || !autoSync) return;
    if (!syncCode.trim() || !cryptoKey || !salt) return;
    if (suppressPushRef.current) {
      suppressPushRef.current = false; // this change came from a pull — don't echo it back
      return;
    }
    if (autoPushTimer.current) clearTimeout(autoPushTimer.current);
    autoPushTimer.current = setTimeout(() => {
      pushWorkspace(true);
    }, 1500);
    return () => {
      if (autoPushTimer.current) clearTimeout(autoPushTimer.current);
    };
  }, [collections, requests, openTabs, activeId, expanded, sessionOnly, history, runbooks, autoSync, syncCode, cryptoKey, salt]);

  // Automatic cloud sync: pull the latest cloud copy once on startup (after the
  // passphrase is available), so a reload or another device picks up changes.
  useEffect(() => {
    if (!loaded.current || autoPulledRef.current || !autoSync) return;
    if (!syncCode.trim() || !passphraseRef.current) return;
    autoPulledRef.current = true;
    autoPullWorkspace();
  }, [autoSync, syncCode, cryptoKey, locked]);

  const active = requests.find((r) => r.id === activeId);
  // Variables are scoped to a collection. The active request's collection (or the
  // first collection, for loose requests) supplies the variables shown and used.
  const activeCollection = collections.find((c) => active && c.requestIds.includes(active.id)) ?? collections[0];
  const activeVariables = activeCollection?.variables ?? [];
  const variableMap = useMemo(
    () => Object.fromEntries(activeVariables.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value])),
    [activeVariables],
  );
  const hydratedUrl = useMemo(() => (active ? computeUrl(active, variableMap) : ''), [active, variableMap]);

  function requestById(id: string) {
    return requests.find((r) => r.id === id);
  }

  // Resolve the collection a request belongs to (falling back to the first), and
  // its variable map. Used so each request/step resolves against its own scope.
  function collectionIdOf(reqId: string): string {
    return (collections.find((c) => c.requestIds.includes(reqId)) ?? collections[0])?.id ?? '';
  }
  function varsForRequest(reqId: string): Record<string, string> {
    const col = collections.find((c) => c.requestIds.includes(reqId)) ?? collections[0];
    return Object.fromEntries((col?.variables ?? []).filter((v) => v.enabled && v.key).map((v) => [v.key, v.value]));
  }
  function updateCollectionVars(collectionId: string, fn: (vars: KeyValue[]) => KeyValue[]) {
    setCollections((cols) => cols.map((c) => (c.id === collectionId ? { ...c, variables: fn(c.variables ?? []) } : c)));
  }
  function setVariableIn(collectionId: string, name: string, value: string) {
    if (!collectionId) return;
    updateCollectionVars(collectionId, (vars) =>
      vars.some((r) => r.key === name)
        ? vars.map((r) => (r.key === name ? { ...r, value } : r))
        : [...vars, { id: uid(), key: name, value, enabled: true }],
    );
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
    setDrawerOpen(false); // collapse the mobile drawer once a request is opened
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
      workspace: { collections, requests, history, runbooks },
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
        const legacy = ws.variables ?? [];
        const cols: Collection[] = (ws.collections ?? []).map((c: Collection) => ({
          ...c,
          variables: c.variables ?? legacy.map((v: KeyValue) => ({ ...v, id: uid() })),
        }));
        const reqs: RequestConfig[] = (ws.requests ?? []).map(normalizeRequest);
        if (!cols.length && !reqs.length) throw new Error('empty');
        if (!window.confirm('Import will replace your current workspace. Continue?')) return;
        setCollections(cols);
        setRequests(reqs);
        setHistory(ws.history ?? []);
        setRunbooks(ws.runbooks ?? []);
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

  // Write a variable into the active request's collection (manual Extract → var).
  function setVariable(name: string, value: string) {
    if (activeCollection) setVariableIn(activeCollection.id, name, value);
  }

  // Run a request's saved extraction rules against a fresh response. Pure: it
  // returns the variable updates and a status summary rather than mutating state,
  // so both single runs and the sequence runner can decide how to apply them.
  function computeExtracted(req: RequestConfig, body: string, headers: Headers): { updates: Record<string, string>; note: string } {
    const rules = (req.extractRules ?? []).filter((r) => r.enabled && r.variable.trim());
    if (!rules.length) return { updates: {}, note: '' };
    const hasBodyRule = rules.some((r) => (r.source ?? 'body') === 'body');
    let data: unknown;
    let jsonOk = true;
    if (hasBodyRule) {
      try {
        data = JSON.parse(body);
      } catch {
        jsonOk = false;
      }
    }
    const updates: Record<string, string> = {};
    const done: string[] = [];
    const missed: string[] = [];
    for (const rule of rules) {
      let val: unknown;
      if ((rule.source ?? 'body') === 'header') {
        const hv = headers.get(rule.path.trim());
        val = hv === null ? undefined : hv;
      } else if (!jsonOk) {
        val = undefined;
      } else {
        val = rule.path.trim() ? resolvePath(data, rule.path.trim()) : data;
      }
      const final = finalizeValue(val, rule.pattern ?? '');
      if (final === undefined) {
        missed.push(rule.variable.trim());
        continue;
      }
      updates[rule.variable.trim()] = final;
      done.push(rule.variable.trim());
    }
    const parts: string[] = [];
    if (done.length) parts.push(`Set ${done.map((n) => `{{${n}}}`).join(', ')}`);
    if (missed.length) parts.push(`No match for ${missed.map((n) => `{{${n}}}`).join(', ')}`);
    return { updates, note: parts.join(' · ') };
  }

  function addRuleFromExtract() {
    if (!active) return;
    const name = extractName.trim();
    if (!name) {
      setExtractMsg('Enter a variable name to save a rule.');
      return;
    }
    const rules = active.extractRules ?? [];
    updateActive({
      extractRules: [
        ...rules,
        { id: uid(), path: extractPath.trim(), variable: name, enabled: true, source: extractSource, pattern: extractPattern.trim() },
      ],
    });
    const target =
      extractSource === 'header' ? `header "${extractPath.trim()}"` : extractPath.trim() || '(whole body)';
    setExtractMsg(`Auto-extract rule added: ${target} → {{${name}}}`);
  }

  function extractToVariable() {
    if (!response) return;
    const name = extractName.trim();
    if (!name) {
      setExtractMsg('Enter a variable name.');
      return;
    }
    if (extractSource === 'header') {
      const hname = extractPath.trim();
      const found = response.headers.find((h) => h.key.toLowerCase() === hname.toLowerCase());
      if (!hname || !found) {
        setExtractMsg(`No response header "${hname || '(name)'}".`);
        return;
      }
      const final = finalizeValue(found.value, extractPattern.trim());
      if (final === undefined) {
        setExtractMsg('Pattern matched nothing (check the regex).');
        return;
      }
      setVariable(name, final);
      setExtractMsg(`Saved header to {{${name}}}.`);
      setExtractPath('');
      setExtractName('');
      setExtractPattern('');
      return;
    }
    try {
      const data = JSON.parse(response.body);
      const val = extractPath.trim() ? resolvePath(data, extractPath.trim()) : data;
      if (val === undefined) {
        setExtractMsg(`No value at "${extractPath.trim()}".`);
        return;
      }
      const final = finalizeValue(val, extractPattern.trim());
      if (final === undefined) {
        setExtractMsg('Pattern matched nothing (check the regex).');
        return;
      }
      setVariable(name, final);
      setExtractMsg(`Saved to {{${name}}}.`);
      setExtractPath('');
      setExtractName('');
      setExtractPattern('');
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
      passphraseRef.current = passphrase;
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
    passphraseRef.current = passphrase;
    setLockModal('');
  }

  function removeEncryption() {
    setCryptoKey(null);
    setSalt(null);
    // the persist effect will rewrite the workspace as plaintext
  }

  function pushHistory(entry: HistoryEntry) {
    setHistory((h) => [entry, ...h].slice(0, HISTORY_LIMIT));
  }

  function snapshotOf(req: RequestConfig): RequestSnapshot {
    return { method: req.method, url: req.url, params: req.params, headers: req.headers, body: req.body, auth: req.auth };
  }

  // Perform one request against an explicit variable map (not React state), so a
  // sequence runner can thread freshly-extracted variables into the next step.
  async function executeRequest(req: RequestConfig, vars: Record<string, string>): Promise<ExecOutcome> {
    const url = computeUrl(req, vars);
    const started = performance.now();
    try {
      const headers = Object.fromEntries(
        req.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, applyVariables(h.value, vars)]),
      );
      applyAuth(headers, req.auth, vars);
      const init: RequestInit = { method: req.method, headers };
      if (!['GET', 'HEAD'].includes(req.method) && req.body.trim()) init.body = applyVariables(req.body, vars);
      const result = await fetch(url, init);
      const body = await result.text();
      let pretty = body;
      let isJson = false;
      try {
        pretty = JSON.stringify(JSON.parse(body), null, 2);
        isJson = true;
      } catch {
        /* not JSON */
      }
      const durationMs = Math.round(performance.now() - started);
      const responseState: ResponseState = {
        status: result.status,
        statusText: result.statusText,
        duration: durationMs,
        size: new Blob([body]).size,
        headers: Array.from(result.headers.entries()).map(([key, value]) => ({ id: uid(), key, value, enabled: true })),
        body,
        pretty,
        isJson,
        contentType: result.headers.get('content-type') ?? '',
      };
      return { url, durationMs, status: result.status, responseState, headers: result.headers, body };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Request failed';
      return { url, durationMs: Math.round(performance.now() - started), status: 0, error: message, body: '' };
    }
  }

  async function runRequest(req: RequestConfig) {
    const id = req.id;
    setSending((s) => ({ ...s, [id]: true }));
    setErrors((e) => ({ ...e, [id]: '' }));
    setResponses((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
    try {
      const exec = await executeRequest(req, varsForRequest(id));
      if (exec.error || !exec.responseState) {
        setErrors((e) => ({ ...e, [id]: exec.error ?? 'Request failed' }));
        pushHistory({
          id: uid(), requestId: id, name: req.name, method: req.method, url: exec.url,
          status: 0, ok: false, error: exec.error, durationMs: exec.durationMs, at: now(), snapshot: snapshotOf(req),
        });
        return;
      }
      setRespView('pretty');
      setResponses((r) => ({ ...r, [id]: exec.responseState! }));
      const { updates, note } = computeExtracted(req, exec.body, exec.headers!);
      const colId = collectionIdOf(id);
      Object.entries(updates).forEach(([k, v]) => setVariableIn(colId, k, v));
      setRuleMsgs((m) => ({ ...m, [id]: note }));
      pushHistory({
        id: uid(), requestId: id, name: req.name, method: req.method, url: exec.url,
        status: exec.status, ok: exec.status < 400, durationMs: exec.durationMs, at: now(), snapshot: snapshotOf(req),
      });
    } finally {
      setSending((s) => ({ ...s, [id]: false }));
    }
  }

  // Fire a list of requests in order, threading extracted variables from each
  // step into the next. Updates the same response/variable/history state a
  // single run would, plus per-step runner status.
  async function runSequence(steps: RequestConfig[]) {
    setRunnerBusy(true);
    // Values extracted during this run, threaded into later steps on top of each
    // step's own collection variables (so cross-collection runbooks still chain).
    const threaded: Record<string, string> = {};
    const results: Record<string, RunnerStepStatus> = {};
    steps.forEach((s) => (results[s.id] = { state: 'pending' }));
    setRunnerStatus({ ...results });
    for (const req of steps) {
      results[req.id] = { state: 'running' };
      setRunnerStatus({ ...results });
      setActiveId(req.id);
      setOpenTabs((tabs) => (tabs.includes(req.id) ? tabs : [...tabs, req.id]));
      const exec = await executeRequest(req, { ...varsForRequest(req.id), ...threaded });
      if (exec.error || !exec.responseState) {
        setErrors((e) => ({ ...e, [req.id]: exec.error ?? 'Request failed' }));
        pushHistory({
          id: uid(), requestId: req.id, name: req.name, method: req.method, url: exec.url,
          status: 0, ok: false, error: exec.error, durationMs: exec.durationMs, at: now(), snapshot: snapshotOf(req),
        });
        results[req.id] = { state: 'fail', note: exec.error };
        setRunnerStatus({ ...results });
        if (runnerStopOnError) break;
        continue;
      }
      setRespView('pretty');
      setResponses((r) => ({ ...r, [req.id]: exec.responseState! }));
      setErrors((e) => ({ ...e, [req.id]: '' }));
      const { updates, note } = computeExtracted(req, exec.body, exec.headers!);
      const colId = collectionIdOf(req.id);
      Object.entries(updates).forEach(([k, v]) => setVariableIn(colId, k, v)); // persist to the step's collection
      Object.assign(threaded, updates); // and thread into later steps
      setRuleMsgs((m) => ({ ...m, [req.id]: note }));
      pushHistory({
        id: uid(), requestId: req.id, name: req.name, method: req.method, url: exec.url,
        status: exec.status, ok: exec.status < 400, durationMs: exec.durationMs, at: now(), snapshot: snapshotOf(req),
      });
      results[req.id] = {
        state: exec.status < 400 ? 'ok' : 'fail',
        status: exec.status,
        ms: exec.durationMs,
        note: Object.keys(updates).length ? `→ ${Object.keys(updates).map((k) => `{{${k}}}`).join(', ')}` : undefined,
      };
      setRunnerStatus({ ...results });
      if (exec.status >= 400 && runnerStopOnError) break;
    }
    setRunnerBusy(false);
  }

  function openRunnerWithSteps(stepIds: string[], title: string) {
    setRunnerStepIds(stepIds.slice());
    setRunnerTitle(title);
    setRunnerDisabled({});
    setRunnerStatus({});
    setRunnerOpen(true);
    setMenu('');
    setDrawerOpen(false);
  }

  function openRunner(collectionId: string) {
    const col = collections.find((c) => c.id === collectionId);
    if (!col) return;
    openRunnerWithSteps(col.requestIds, `Run: ${col.name}`);
  }

  // ---- Runbooks (cross-collection saved sequences) ----
  function addRunbook() {
    const rb: Runbook = { id: uid(), name: `Runbook ${runbooks.length + 1}`, stepIds: [] };
    setRunbooks((list) => [...list, rb]);
  }
  function updateRunbook(id: string, patch: Partial<Runbook>) {
    setRunbooks((list) => list.map((rb) => (rb.id === id ? { ...rb, ...patch } : rb)));
  }
  function deleteRunbook(id: string) {
    setRunbooks((list) => list.filter((rb) => rb.id !== id));
  }
  function addRunbookStep(id: string, requestId: string) {
    if (!requestId) return;
    setRunbooks((list) => list.map((rb) => (rb.id === id ? { ...rb, stepIds: [...rb.stepIds, requestId] } : rb)));
  }
  function removeRunbookStep(id: string, index: number) {
    setRunbooks((list) =>
      list.map((rb) => (rb.id === id ? { ...rb, stepIds: rb.stepIds.filter((_, i) => i !== index) } : rb)),
    );
  }
  function moveRunbookStep(id: string, index: number, dir: -1 | 1) {
    setRunbooks((list) =>
      list.map((rb) => {
        if (rb.id !== id) return rb;
        const j = index + dir;
        if (j < 0 || j >= rb.stepIds.length) return rb;
        const next = rb.stepIds.slice();
        [next[index], next[j]] = [next[j], next[index]];
        return { ...rb, stepIds: next };
      }),
    );
  }
  function runRunbook(rb: Runbook) {
    const valid = rb.stepIds.filter((id) => requestById(id));
    if (valid.length) openRunnerWithSteps(valid, `Run: ${rb.name}`);
  }

  function moveStep(id: string, dir: -1 | 1) {
    setRunnerStepIds((ids) => {
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return ids;
      const next = ids.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function startRunner() {
    const steps = runnerStepIds
      .filter((id) => !runnerDisabled[id])
      .map((id) => requestById(id))
      .filter((r): r is RequestConfig => Boolean(r));
    if (steps.length) runSequence(steps);
  }

  function sendRequest(event: FormEvent) {
    event.preventDefault();
    if (active) runRequest(active);
  }

  function replayHistory(entry: HistoryEntry) {
    const req = makeRequest({ ...entry.snapshot, name: entry.name });
    setRequests((current) => [...current, req]);
    setOpenTabs((tabs) => [...tabs, req.id]);
    setActiveId(req.id);
    setEditorTab('params');
    setSidebarView('collections');
    runRequest(req);
  }

  function deleteHistory(id: string) {
    setHistory((h) => h.filter((entry) => entry.id !== id));
  }

  function clearHistory() {
    setHistory([]);
  }

  function updateSyncCode(code: string) {
    setSyncCode(code);
    localStorage.setItem(syncCodeKey, code);
  }

  function generateSyncCode() {
    updateSyncCode(`${uid()}-${uid().slice(0, 8)}`);
    setSyncMsg('New sync code generated — save it to link other devices.');
  }

  // Core push used by both the manual button and automatic sync. Returns true
  // on success. When silent, it avoids the chatty status messages.
  async function pushWorkspace(silent: boolean): Promise<boolean> {
    const code = syncCode.trim();
    if (!code || !cryptoKey || !salt) return false;
    try {
      const workspace: WorkspaceData = { collections, requests, openTabs, activeId, expanded, sessionOnly, history, runbooks };
      const envelope = await encryptWorkspace(cryptoKey, salt, sessionOnly ? redactSecrets(workspace) : workspace);
      const id = await sha256hex(code);
      const res = await fetch('/api/sync', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, blob: envelope }),
      });
      if (res.ok) setSyncMsg(silent ? 'Auto-synced ✓' : 'Pushed to cloud.');
      else if (!silent) setSyncMsg(`Push failed: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
      return res.ok;
    } catch (caught) {
      if (!silent) setSyncMsg(caught instanceof Error ? caught.message : 'Push failed.');
      return false;
    }
  }

  async function pushSync() {
    const code = syncCode.trim();
    if (!code) return setSyncMsg('Enter or generate a sync code first.');
    if (!cryptoKey || !salt) return setSyncMsg('Set a passphrase first (the lock icon) — sync is end-to-end encrypted.');
    setSyncBusy(true);
    setSyncMsg('');
    await pushWorkspace(false);
    setSyncBusy(false);
  }

  // Silent startup pull for automatic sync: load the cloud copy without a
  // confirm prompt, and keep local data if there is nothing to pull.
  async function autoPullWorkspace() {
    const code = syncCode.trim();
    if (!code || !passphraseRef.current) return;
    try {
      const id = await sha256hex(code);
      const res = await fetch(`/api/sync?id=${id}`);
      if (!res.ok) return; // 404 (nothing pushed yet) or transient — keep local
      const { blob } = (await res.json()) as { blob: Envelope };
      const key = await deriveKey(passphraseRef.current, fromB64(blob.salt));
      const workspace = await decryptWorkspace(key, blob);
      suppressPushRef.current = true; // don't immediately re-push what we just pulled
      loadWorkspace(workspace);
      setSyncMsg('Synced from cloud ✓');
    } catch {
      /* leave local workspace intact on any failure */
    }
  }

  async function pullSync() {
    const code = syncCode.trim();
    if (!code) return setSyncMsg('Enter your sync code first.');
    if (!passphraseRef.current) return setSyncMsg('Enter your passphrase first (set or unlock encryption).');
    setSyncBusy(true);
    setSyncMsg('');
    try {
      const id = await sha256hex(code);
      const res = await fetch(`/api/sync?id=${id}`);
      if (res.status === 404) {
        setSyncMsg('No cloud data for this sync code yet — push from another device first.');
        return;
      }
      if (!res.ok) {
        setSyncMsg(`Pull failed: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
        return;
      }
      const { blob } = (await res.json()) as { blob: Envelope };
      let workspace: WorkspaceData;
      try {
        const key = await deriveKey(passphraseRef.current, fromB64(blob.salt));
        workspace = await decryptWorkspace(key, blob);
      } catch {
        setSyncMsg('Could not decrypt — the passphrase does not match this workspace.');
        return;
      }
      if (!window.confirm('Pull will replace your current workspace with the cloud copy. Continue?')) return;
      loadWorkspace(workspace);
      setMenu('');
      setSyncMsg('Pulled from cloud.');
    } catch (caught) {
      setSyncMsg(caught instanceof Error ? caught.message : 'Pull failed.');
    } finally {
      setSyncBusy(false);
    }
  }

  const response = active ? responses[active.id] : undefined;
  const error = active ? errors[active.id] : '';
  const isSending = active ? sending[active.id] : false;
  const nowMs = Date.now();

  // Live preview of the value the current path/source would capture, so a click
  // in the JSON body (or a typed path/header) shows what will be saved.
  const extractPreview = useMemo((): { text: string; ok: boolean } => {
    if (!response || !extractOpen) return { text: '', ok: false };
    if (extractSource === 'header') {
      const hname = extractPath.trim();
      if (!hname) return { text: '', ok: false };
      const found = response.headers.find((h) => h.key.toLowerCase() === hname.toLowerCase());
      if (!found) return { text: 'No response header by that name', ok: false };
      const final = finalizeValue(found.value, extractPattern.trim());
      return final === undefined
        ? { text: 'Pattern matched nothing', ok: false }
        : { text: final, ok: true };
    }
    if (!response.isJson) return { text: '', ok: false };
    let data: unknown;
    try {
      data = JSON.parse(response.body);
    } catch {
      return { text: '', ok: false };
    }
    const val = extractPath.trim() ? resolvePath(data, extractPath.trim()) : data;
    if (val === undefined) return { text: 'No value at this path', ok: false };
    const final = finalizeValue(val, extractPattern.trim());
    return final === undefined ? { text: 'Pattern matched nothing', ok: false } : { text: final, ok: true };
  }, [response, extractOpen, extractSource, extractPath, extractPattern]);

  // Autocomplete suggestions for the regex field: patterns derived from the
  // current raw value (before the regex) plus a handful of common ones.
  const regexOptions = useMemo(() => {
    const opts: string[] = [];
    let raw: string | undefined;
    if (response && extractOpen) {
      if (extractSource === 'header') {
        const found = response.headers.find((h) => h.key.toLowerCase() === extractPath.trim().toLowerCase());
        raw = found?.value;
      } else if (response.isJson) {
        try {
          const data = JSON.parse(response.body);
          const val = extractPath.trim() ? resolvePath(data, extractPath.trim()) : data;
          if (val !== undefined) raw = typeof val === 'object' ? JSON.stringify(val) : String(val);
        } catch {
          /* ignore */
        }
      }
    }
    if (raw) {
      if (/bearer\s+/i.test(raw)) opts.push('Bearer (.+)');
      const kv = raw.match(/([A-Za-z0-9_.-]+)=([^;]+)/);
      if (kv) opts.push(`${kv[1]}=([^;]+)`);
      if (/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(raw)) opts.push('([0-9a-fA-F-]{36})');
      if (/^\s*-?\d/.test(raw)) opts.push('(\\d+)');
    }
    for (const r of commonRegex) if (!opts.includes(r)) opts.push(r);
    return opts;
  }, [response, extractOpen, extractSource, extractPath]);

  if (locked) {
    return (
      <main className="lock-screen">
        <LockModal mode="unlock" error={lockError} onSubmit={unlockWorkspace} />
      </main>
    );
  }

  return (
    <main
      className={drawerOpen ? 'shell drawer-open' : 'shell'}
      style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }}
      onClick={() => setMenu('')}
    >
      <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      {lockModal && (
        <LockModal
          mode={lockModal}
          error=""
          onSubmit={applyPassphrase}
          onCancel={() => setLockModal('')}
        />
      )}
      {runnerOpen && (
        <div className="lock-backdrop" onClick={() => !runnerBusy && setRunnerOpen(false)}>
          <div className="runner-card" onClick={(e) => e.stopPropagation()}>
            <div className="runner-head">
              <h2>{runnerTitle}</h2>
              <button className="icon-btn" onClick={() => !runnerBusy && setRunnerOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <p className="lock-hint">
              Requests run top-to-bottom. Variables extracted by each step (auto-extract rules) are threaded into the
              steps below it — so a login step can set a token the rest reuse.
            </p>
            <div className="runner-steps">
              {runnerStepIds.map((id, i) => {
                const req = requestById(id);
                if (!req) return null;
                const st = runnerStatus[id];
                const off = !!runnerDisabled[id];
                return (
                  <div className={`runner-step ${st?.state ?? ''}${off ? ' off' : ''}`} key={id}>
                    <input
                      type="checkbox"
                      checked={!off}
                      disabled={runnerBusy}
                      aria-label="Include step"
                      onChange={(e) => setRunnerDisabled((d) => ({ ...d, [id]: !e.target.checked }))}
                    />
                    <span className="runner-idx">{i + 1}</span>
                    <span className={`method m-${req.method}`}>{req.method}</span>
                    <span className="runner-name">{req.name}</span>
                    <span className="runner-state">
                      {st?.state === 'running' && <span className="runner-spin">running…</span>}
                      {st?.state === 'ok' && <b className="ok">{st.status}</b>}
                      {st?.state === 'fail' && <b className="bad">{st.status ?? '✕'}</b>}
                      {st?.ms != null && <span className="runner-ms">{st.ms} ms</span>}
                      {st?.note && <span className="runner-note">{st.note}</span>}
                    </span>
                    <span className="runner-move">
                      <button
                        className="icon-btn"
                        disabled={runnerBusy || i === 0}
                        onClick={() => moveStep(id, -1)}
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        className="icon-btn"
                        disabled={runnerBusy || i === runnerStepIds.length - 1}
                        onClick={() => moveStep(id, 1)}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                    </span>
                  </div>
                );
              })}
              {runnerStepIds.length === 0 && <div className="tree-empty">This collection has no requests.</div>}
            </div>
            <label className="menu-toggle">
              <input
                type="checkbox"
                checked={runnerStopOnError}
                disabled={runnerBusy}
                onChange={(e) => setRunnerStopOnError(e.target.checked)}
              />
              <span>Stop on first error (status ≥ 400 or network failure)</span>
            </label>
            <div className="runner-actions">
              <button className="btn-ghost" onClick={() => !runnerBusy && setRunnerOpen(false)}>
                Close
              </button>
              <button className="send" onClick={startRunner} disabled={runnerBusy || runnerStepIds.length === 0}>
                {runnerBusy ? 'Running…' : 'Run sequence'}
              </button>
            </div>
          </div>
        </div>
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

                  <div className="menu-label">Cloud sync (Neon)</div>
                  <input
                    className="sync-code"
                    value={syncCode}
                    onChange={(e) => updateSyncCode(e.target.value)}
                    placeholder="Sync code"
                    spellCheck={false}
                  />
                  <div className="sync-actions">
                    <button className="menu-item" onClick={generateSyncCode} disabled={syncBusy}>
                      Generate
                    </button>
                    <button className="menu-item" onClick={pushSync} disabled={syncBusy}>
                      Push
                    </button>
                    <button className="menu-item" onClick={pullSync} disabled={syncBusy}>
                      Pull
                    </button>
                  </div>
                  <label className="menu-toggle">
                    <input
                      type="checkbox"
                      checked={autoSync}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setAutoSync(on);
                        localStorage.setItem(autoSyncKey, on ? '1' : '0');
                        autoPulledRef.current = false; // allow a fresh pull when turning it on
                        if (on && (!syncCode.trim() || !cryptoKey)) {
                          setSyncMsg('Set a sync code and passphrase to finish enabling automatic sync.');
                        }
                      }}
                    />
                    <span>Automatic sync</span>
                  </label>
                  <p className="menu-note">
                    End-to-end encrypted with your passphrase — set the lock first. Use the same sync code and passphrase on
                    each device. With <b>Automatic sync</b> on, changes push to the cloud shortly after you make them and
                    pull on load.
                  </p>
                  {syncMsg && <p className="menu-note sync-msg">{syncMsg}</p>}
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

        <div className="side-tabs">
          <button
            className={sidebarView === 'collections' ? 'stab active' : 'stab'}
            onClick={() => setSidebarView('collections')}
          >
            Collections
          </button>
          <button
            className={sidebarView === 'runbooks' ? 'stab active' : 'stab'}
            onClick={() => setSidebarView('runbooks')}
          >
            Runbooks{runbooks.length > 0 && <b className="count">{runbooks.length}</b>}
          </button>
          <button
            className={sidebarView === 'history' ? 'stab active' : 'stab'}
            onClick={() => setSidebarView('history')}
          >
            History{history.length > 0 && <b className="count">{history.length}</b>}
          </button>
        </div>

        {sidebarView === 'collections' ? (
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
                      { label: 'Run in order', onClick: () => openRunner(collection.id) },
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
        ) : sidebarView === 'runbooks' ? (
          <div className="runbook-list">
            <button className="rb-new" onClick={addRunbook}>
              + New runbook
            </button>
            {runbooks.length === 0 && (
              <div className="tree-empty">No runbooks yet — create one to chain requests from any collection.</div>
            )}
            {runbooks.map((rb) => (
              <div className="rb-card" key={rb.id}>
                <div className="rb-head">
                  <input
                    className="rb-name"
                    value={rb.name}
                    spellCheck={false}
                    aria-label="Runbook name"
                    onChange={(e) => updateRunbook(rb.id, { name: e.target.value })}
                  />
                  <button
                    className="icon-btn rb-run"
                    title="Run runbook"
                    aria-label="Run runbook"
                    disabled={rb.stepIds.length === 0}
                    onClick={() => runRunbook(rb)}
                  >
                    ▶
                  </button>
                  <button className="icon-btn" title="Delete runbook" aria-label="Delete runbook" onClick={() => deleteRunbook(rb.id)}>
                    ×
                  </button>
                </div>
                <div className="rb-steps">
                  {rb.stepIds.length === 0 && <div className="tree-empty">No steps yet</div>}
                  {rb.stepIds.map((sid, i) => {
                    const req = requestById(sid);
                    return (
                      <div className="rb-step" key={`${sid}-${i}`}>
                        <span className="rb-idx">{i + 1}</span>
                        {req ? (
                          <>
                            <span className={`method m-${req.method}`}>{req.method}</span>
                            <span className="rb-step-name">{req.name}</span>
                          </>
                        ) : (
                          <span className="rb-step-name rb-missing">(deleted request)</span>
                        )}
                        <span className="rb-step-actions">
                          <button className="icon-btn" disabled={i === 0} onClick={() => moveRunbookStep(rb.id, i, -1)} aria-label="Move up">
                            ↑
                          </button>
                          <button
                            className="icon-btn"
                            disabled={i === rb.stepIds.length - 1}
                            onClick={() => moveRunbookStep(rb.id, i, 1)}
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                          <button className="icon-btn" onClick={() => removeRunbookStep(rb.id, i)} aria-label="Remove step">
                            ×
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <select
                  className="rb-add"
                  value=""
                  aria-label="Add step to runbook"
                  onChange={(e) => addRunbookStep(rb.id, e.target.value)}
                >
                  <option value="">+ Add step…</option>
                  {collections.map((col) => (
                    <optgroup key={col.id} label={col.name}>
                      {col.requestIds.map((rid) => {
                        const r = requestById(rid);
                        return r ? (
                          <option key={rid} value={rid}>
                            {r.method} · {r.name}
                          </option>
                        ) : null;
                      })}
                    </optgroup>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ) : (
          <div className="history-list">
            {history.length === 0 && <div className="tree-empty">No requests sent yet</div>}
            {history.length > 0 && (
              <button className="clear-history" onClick={clearHistory}>
                Clear history
              </button>
            )}
            {history.map((entry) => (
              <div className="hist-row" key={entry.id} onClick={() => replayHistory(entry)} title="Replay this request">
                <span className={`method m-${entry.method}`}>{entry.method}</span>
                <span className="hist-main">
                  <span className="hist-url">{entry.url || entry.name}</span>
                  <span className="hist-meta">
                    <b className={entry.ok ? 'ok' : 'bad'}>{entry.error ? 'ERR' : entry.status}</b>
                    <span>{entry.durationMs} ms</span>
                    <span>{timeAgo(entry.at, nowMs)}</span>
                  </span>
                </span>
                <button
                  className="icon-btn"
                  title="Delete entry"
                  aria-label="Delete history entry"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteHistory(entry.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      <div className="resizer" onPointerDown={startResize} role="separator" aria-label="Resize sidebar" aria-orientation="vertical" />

      <section className="workspace">
        <div className="tabstrip">
          <button
            className="drawer-toggle"
            title="Menu"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            onClick={(e) => {
              e.stopPropagation();
              setDrawerOpen((v) => !v);
            }}
          >
            ☰
          </button>
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
          <div className="panel" style={{ ['--response-h' as string]: `${responseHeight}px` }}>
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
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                />
                <button className="send" disabled={isSending || !active.url}>
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </div>
              <small className="resolved">{hydratedUrl || 'Add a URL to begin'}</small>
            </form>

            <div className="editor-tabs">
              {(['params', 'auth', 'headers', 'body', 'variables', 'extract'] as EditorTab[]).map((tab) => (
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
                          : tab === 'variables'
                            ? 'Variables'
                            : 'Auto-extract'}
                  {tab === 'params' && countRows(active.params) > 0 && <b className="count">{countRows(active.params)}</b>}
                  {tab === 'auth' && active.auth.type !== 'none' && <b className="dot" aria-hidden />}
                  {tab === 'headers' && countRows(active.headers) > 0 && <b className="count">{countRows(active.headers)}</b>}
                  {tab === 'variables' && countRows(activeVariables) > 0 && <b className="count">{countRows(activeVariables)}</b>}
                  {tab === 'extract' && (active.extractRules ?? []).some((r) => r.enabled && r.variable.trim()) && (
                    <b className="count">{(active.extractRules ?? []).filter((r) => r.enabled && r.variable.trim()).length}</b>
                  )}
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
              {editorTab === 'variables' &&
                (activeCollection ? (
                  <>
                    <p className="auth-hint">
                      Variables are scoped to the <b>{activeCollection.name}</b> collection — each collection keeps its
                      own set, and extraction writes here.
                    </p>
                    <Rows
                      rows={activeVariables}
                      secretable
                      onAdd={() => updateCollectionVars(activeCollection.id, (rows) => [...rows, blankRow()])}
                      onChange={(id, patch) =>
                        updateCollectionVars(activeCollection.id, (rows) =>
                          rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
                        )
                      }
                      onRemove={(id) => updateCollectionVars(activeCollection.id, (rows) => rows.filter((r) => r.id !== id))}
                    />
                  </>
                ) : (
                  <p className="auth-hint">Create a collection to add variables.</p>
                ))}
              {editorTab === 'extract' && (
                <div className="rules">
                  <p className="auth-hint">
                    After every response, each enabled rule reads a value from the JSON <b>body</b> (by path) or a
                    response <b>header</b> (by name) and writes it into the named variable — so a login token can refresh
                    itself with no clicks. Add an optional <b>regex</b> to keep just part of the value (capture group 1, or
                    the whole match) — e.g. <code>session=([^;]+)</code> from a cookie. Tip: open <b>Extract → var</b> on a
                    response and use <b>Save as rule</b>.
                  </p>
                  <datalist id="regex-suggestions-static">
                    {commonRegex.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                  {(active.extractRules ?? []).map((rule) => (
                    <div className="rule-row" key={rule.id}>
                      <div className="rule-main">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        aria-label="Enable rule"
                        onChange={(e) =>
                          updateActive({
                            extractRules: (active.extractRules ?? []).map((r) =>
                              r.id === rule.id ? { ...r, enabled: e.target.checked } : r,
                            ),
                          })
                        }
                      />
                      <select
                        className="rule-source"
                        value={rule.source ?? 'body'}
                        aria-label="Rule source"
                        onChange={(e) =>
                          updateActive({
                            extractRules: (active.extractRules ?? []).map((r) =>
                              r.id === rule.id ? { ...r, source: e.target.value as ExtractSource } : r,
                            ),
                          })
                        }
                      >
                        <option value="body">Body</option>
                        <option value="header">Header</option>
                      </select>
                      <input
                        className="rule-path"
                        value={rule.path}
                        placeholder={
                          (rule.source ?? 'body') === 'header'
                            ? 'Header name e.g. x-request-id'
                            : 'Path e.g. data.token (blank = whole body)'
                        }
                        spellCheck={false}
                        onChange={(e) =>
                          updateActive({
                            extractRules: (active.extractRules ?? []).map((r) =>
                              r.id === rule.id ? { ...r, path: e.target.value } : r,
                            ),
                          })
                        }
                      />
                      <span className="rule-arrow" aria-hidden>
                        →
                      </span>
                      <input
                        className="rule-var"
                        value={rule.variable}
                        placeholder="variable"
                        spellCheck={false}
                        onChange={(e) =>
                          updateActive({
                            extractRules: (active.extractRules ?? []).map((r) =>
                              r.id === rule.id ? { ...r, variable: e.target.value } : r,
                            ),
                          })
                        }
                      />
                      <button
                        className="row-del"
                        aria-label="Delete rule"
                        onClick={() =>
                          updateActive({ extractRules: (active.extractRules ?? []).filter((r) => r.id !== rule.id) })
                        }
                      >
                        ×
                      </button>
                      </div>
                      <div className="rule-extra">
                        <span className="rule-extra-label">regex</span>
                        <input
                          className="rule-pattern"
                          value={rule.pattern ?? ''}
                          placeholder="optional — capture group 1 or whole match, e.g. Bearer (.+)"
                          spellCheck={false}
                          list="regex-suggestions-static"
                          onChange={(e) =>
                            updateActive({
                              extractRules: (active.extractRules ?? []).map((r) =>
                                r.id === rule.id ? { ...r, pattern: e.target.value } : r,
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    className="add-row"
                    onClick={() =>
                      updateActive({
                        extractRules: [...(active.extractRules ?? []), { id: uid(), path: '', variable: '', enabled: true }],
                      })
                    }
                  >
                    + Add rule
                  </button>
                </div>
              )}
            </div>
            </div>

            <div className="h-resizer" onPointerDown={startResizeResponse} role="separator" aria-label="Resize response" aria-orientation="horizontal" />

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
                  <select
                    className="extract-source"
                    value={extractSource}
                    onChange={(e) => setExtractSource(e.target.value as ExtractSource)}
                    aria-label="Extract source"
                  >
                    <option value="body">Body</option>
                    <option value="header">Header</option>
                  </select>
                  {extractSource === 'header' ? (
                    <input
                      className="extract-path"
                      value={extractPath}
                      onChange={(e) => setExtractPath(e.target.value)}
                      placeholder="Header name e.g. x-request-id"
                      list="resp-header-names"
                      spellCheck={false}
                    />
                  ) : (
                    <input
                      className="extract-path"
                      value={extractPath}
                      onChange={(e) => setExtractPath(e.target.value)}
                      placeholder="Path e.g. data.token or items[0].id (blank = whole body)"
                    />
                  )}
                  <datalist id="resp-header-names">
                    {response.headers.map((h) => (
                      <option key={h.id} value={h.key} />
                    ))}
                  </datalist>
                  <input
                    className="extract-pattern"
                    value={extractPattern}
                    onChange={(e) => setExtractPattern(e.target.value)}
                    placeholder="Regex (optional) e.g. session=([^;]+)"
                    spellCheck={false}
                    list="regex-suggestions"
                    title="Optional regex. Uses capture group 1 if present, else the whole match — handy for stripping a prefix like 'Bearer '."
                  />
                  <datalist id="regex-suggestions">
                    {regexOptions.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                  <input
                    className="extract-name"
                    value={extractName}
                    onChange={(e) => setExtractName(e.target.value)}
                    placeholder="Variable name"
                  />
                  <label className="extract-preview-wrap">
                    <span className="extract-preview-label">Value</span>
                    <input
                      className={extractPreview.ok ? 'extract-preview' : 'extract-preview miss'}
                      readOnly
                      value={extractPreview.text}
                      title={extractPreview.text}
                      placeholder={
                        extractSource === 'header'
                          ? 'Pick or type a header name to preview its value'
                          : 'Click a value in the body (or type a path) to preview it'
                      }
                    />
                  </label>
                  <button className="send extract-save" type="button" onClick={extractToVariable}>
                    Save
                  </button>
                  <button className="btn-ghost extract-rule" type="button" onClick={addRuleFromExtract}>
                    Save as rule
                  </button>
                  {extractMsg && <span className="extract-msg">{extractMsg}</span>}
                </div>
              )}

              {response && active && ruleMsgs[active.id] && (
                <p className="auto-extract-note">⚡ {ruleMsgs[active.id]}</p>
              )}

              <div className="response-scroll">
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
                    extractOpen && extractSource === 'body' ? (
                      <ExtractTree
                        body={response.body}
                        pretty={response.pretty}
                        selected={extractPath.trim()}
                        onPick={(p) => {
                          setExtractPath(p);
                          setExtractMsg('');
                        }}
                      />
                    ) : (
                      <pre className="response-body json" dangerouslySetInnerHTML={{ __html: highlightJson(response.pretty) }} />
                    )
                  ) : (
                    <pre className="response-body">{response.pretty}</pre>
                  ))}

                {!response && !error && (
                  <p className="empty">Send a request to inspect status, headers, timing, and body.</p>
                )}
              </div>
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
          {secretable ? (
            <span className="var-key-wrap">
              <input
                className="var-key"
                value={row.key}
                onChange={(e) => onChange(row.id, { key: e.target.value })}
                placeholder="name"
                spellCheck={false}
              />
            </span>
          ) : (
            <input value={row.key} onChange={(e) => onChange(row.id, { key: e.target.value })} placeholder="Key" />
          )}
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

function computeUrl(req: RequestSnapshot, variables: Record<string, string>) {
  const params = req.params.map((p) => ({ ...p, value: applyVariables(p.value, variables) }));
  if (req.auth.type === 'apikey' && req.auth.addTo === 'query' && req.auth.key) {
    params.push({
      id: 'auth',
      key: applyVariables(req.auth.key, variables),
      value: applyVariables(req.auth.value, variables),
      enabled: true,
    });
  }
  return buildUrl(applyVariables(req.url, variables), params);
}

function timeAgo(iso: string, nowMs: number) {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Resolve a dot/bracket path like "data.items[0].id" against a parsed JSON value.
// Apply an optional regex to a string value. With a capture group, returns
// group 1; otherwise the whole match. Empty pattern passes the value through;
// an invalid regex or no match returns undefined (treated as "no value").
function applyPattern(value: string, pattern: string): string | undefined {
  const p = pattern.trim();
  if (!p) return value;
  let re: RegExp;
  try {
    re = new RegExp(p);
  } catch {
    return undefined;
  }
  const m = re.exec(value);
  if (!m) return undefined;
  return m[1] !== undefined ? m[1] : m[0];
}

// Turn a resolved value into the string to store, applying the optional pattern.
function finalizeValue(val: unknown, pattern: string): string | undefined {
  if (val === undefined) return undefined;
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  return applyPattern(str, pattern);
}

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

// Interactive JSON path-picker shown while "Extract → var" is open: clicking a
// value fills the Path field; clicking an object/array row picks that node.
function ExtractTree({
  body,
  pretty,
  selected,
  onPick,
}: {
  body: string;
  pretty: string;
  selected: string;
  onPick: (path: string) => void;
}) {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return <pre className="response-body json" dangerouslySetInnerHTML={{ __html: highlightJson(pretty) }} />;
  }
  return (
    <div className="response-body json jp-tree">
      <p className="jp-help">
        Click a value to set the Path. Click an object/array’s key to pick that whole node. Leave Path blank for the
        entire body.
      </p>
      <JsonTree value={data} path="" selected={selected} onPick={onPick} />
    </div>
  );
}

function JsonTree({
  value,
  path,
  keyLabel,
  isIndex,
  selected,
  onPick,
}: {
  value: unknown;
  path: string;
  keyLabel?: string;
  isIndex?: boolean;
  selected: string;
  onPick: (path: string) => void;
}) {
  const isSel = path !== '' && path === selected;
  const label =
    keyLabel !== undefined ? (
      <>
        <span className={isIndex ? 'jp-index' : 'j-key'}>{isIndex ? keyLabel : `"${keyLabel}"`}</span>
        <span className="jp-colon">: </span>
      </>
    ) : null;

  if (value !== null && typeof value === 'object') {
    const isArr = Array.isArray(value);
    const entries: [string, unknown][] = isArr
      ? (value as unknown[]).map((v, i) => [String(i), v])
      : Object.entries(value as Record<string, unknown>);
    const open = isArr ? '[' : '{';
    const close = isArr ? ']' : '}';
    return (
      <div className="jp-node">
        <div className={isSel ? 'jp-line sel' : 'jp-line'}>
          {label && (
            <span className="jp-pick" onClick={() => path && onPick(path)} title={path ? `Pick ${path}` : undefined}>
              {label}
            </span>
          )}
          <span className="jp-brace">{open}</span>
          {entries.length === 0 && <span className="jp-brace">{close}</span>}
        </div>
        {entries.length > 0 && (
          <div className="jp-children">
            {entries.map(([k, v]) => (
              <JsonTree
                key={k}
                value={v}
                path={isArr ? `${path}[${k}]` : path ? `${path}.${k}` : k}
                keyLabel={k}
                isIndex={isArr}
                selected={selected}
                onPick={onPick}
              />
            ))}
          </div>
        )}
        {entries.length > 0 && <div className="jp-brace jp-close">{close}</div>}
      </div>
    );
  }

  const cls =
    typeof value === 'string'
      ? 'j-str'
      : typeof value === 'number'
        ? 'j-num'
        : typeof value === 'boolean'
          ? 'j-bool'
          : 'j-null';
  const text = typeof value === 'string' ? `"${value}"` : String(value);
  return (
    <div className={isSel ? 'jp-line sel' : 'jp-line'}>
      <span className="jp-pick" onClick={() => onPick(path)} title={`Pick ${path || '(whole body)'}`}>
        {label}
        <span className={cls}>{text}</span>
      </span>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
