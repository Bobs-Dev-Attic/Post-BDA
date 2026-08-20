# Post-BDA

A Vercel-ready, Postman-style HTTP API client built with Next.js. Everything
runs client-side in the browser — organize requests into collections, chain
them, extract values from responses into variables, and (optionally) sync your
workspace across devices with end-to-end encryption. No backend account
required.

Live app: **https://post-bda.vercel.app**

---

## Contents

- [Quick start](#quick-start)
- [Requests & collections](#requests--collections)
- [Authorization](#authorization)
- [Variables](#variables)
- [Response viewer](#response-viewer)
- [Extracting values into variables](#extracting-values-into-variables)
- [Auto-extraction rules (response chaining)](#auto-extraction-rules-response-chaining)
- [The sequence runner & runbooks](#the-sequence-runner--runbooks)
- [cURL import](#curl-import)
- [Service templates](#service-templates)
- [History](#history)
- [Storage, security & encryption](#storage-security--encryption)
- [Cloud sync (Neon)](#cloud-sync-neon)
- [Export / import](#export--import)
- [Themes & layout](#themes--layout)
- [Mobile](#mobile)
- [MCP server](#mcp-server)
- [Local development](#local-development)
- [Deploying to Vercel](#deploying-to-vercel)
- [Environment variables](#environment-variables)
- [Architecture notes](#architecture-notes)

---

## Quick start

Open the app, then either:

- Click **✦ (New from template)** in the sidebar and pick a **Free & no-auth**
  service (e.g. *US National Weather Service*) — it creates a ready-to-run
  collection. Open a request and hit **Send**.
- Or paste a `curl` command via a collection's **⋯ → Import cURL…**.
- Or click **+** to make an empty collection and add requests by hand.

Everything you do is saved to your browser automatically (see the **Saved
&lt;time&gt;** indicator under the app title).

---

## Requests & collections

- **Collections** group requests in a tree in the left sidebar. Add a collection
  with **+**, add requests from a collection's **⋯** menu or its **+** button.
- Each request has a **method**, **URL**, **query params**, **headers**, a
  **body**, **authorization**, and **auto-extract rules**.
- Requests open in **tabs**. Rename inline (double-click), duplicate, or delete
  from the **⋯** menu.
- **Params auto-populate from the URL.** Paste a URL containing a query string
  (`?a=1&b=2`) and those pairs appear as **Params** rows automatically (on load,
  when you open the Params tab, on blur, and on send). `{{variables}}` in the
  query are preserved. The request is rebuilt from Params at send time.

---

## Authorization

Per request, on the **Authorization** tab:

- **No Auth**
- **Bearer** — `Authorization: Bearer <token>`
- **Basic** — base64 `user:password`
- **API Key** — added as a header or a query parameter

All auth fields accept `{{variables}}`.

---

## Variables

- Variables use `{{name}}` and are substituted into the URL, params, headers,
  and body at send time.
- **Collection-scoped.** Each collection keeps its own set of variables, shown
  and edited on the **Variables** tab. (Legacy global variables are migrated
  onto your collections automatically.)
- **Secret flag & masking.** Mark a variable secret (🔒) to mask its value in
  the UI; reveal per-row with the 👁 toggle.
- **Dynamic variables** resolve fresh at send time, anywhere `{{…}}` works:
  - `{{$guid}}` / `{{$randomUUID}}`
  - `{{$timestamp}}` (unix seconds)
  - `{{$isoTimestamp}}`
  - `{{$randomInt}}` or `{{$randomInt:min:max}}`

Variable names are styled distinctly (italic, framed as `{{ name }}`) in the
Variables tab.

---

## Response viewer

- **View modes:** **Pretty** (color-coded JSON), **Raw**, **Preview** (renders
  HTML in a sandboxed iframe), and **Headers** (table).
- Status, time, and size are shown; the response **header stays pinned** while
  the body scrolls in its own region.
- The response pane height is **draggable** (mouse or touch).
- **Copy** copies the raw or pretty body.

---

## Extracting values into variables

Click **Extract → var** on a JSON response to pull a value into a variable:

- **Click-to-pick.** In Pretty view the JSON becomes a clickable tree — click a
  value (or an object/array key) to fill the **Path**. Array indices are shown
  so you can target `items[0].id`.
- **Body or Header source.** Extract from a JSON body path or a response header
  (by name, with a dropdown of the response's headers).
- **Live value preview.** A read-only field shows exactly what will be saved.
- **Regex (optional).** Keep just part of a value — capture group 1 if present,
  otherwise the whole match (e.g. `Bearer (.+)`, `session=([^;]+)`). The regex
  field offers autocomplete: common patterns plus suggestions derived from the
  current value.
- **Save** writes to the active collection's variables. **Save as rule** turns
  the selection into a persistent auto-extract rule (below).

---

## Auto-extraction rules (response chaining)

On the **Auto-extract** tab, add rules that run **automatically after every
response** for that request:

- Each rule is `source (Body/Header) → path/name → variable`, with an optional
  regex and an enable toggle.
- Body rules read a JSON path; header rules read a response header by name
  (case-insensitive) and work even when the body isn't JSON.
- A note under the response toolbar reports which variables were set.

Typical flow: a login request with rule `data.token → authToken` keeps
`{{authToken}}` fresh; every other request uses `Authorization: Bearer
{{authToken}}`.

---

## The sequence runner & runbooks

Run several requests in order, threading extracted variables from each step
into the next.

- **Run in order** (a collection's **⋯** menu) runs that collection's requests
  top-to-bottom.
- **Runbooks** (sidebar **Runbooks** tab) are saved, named sequences that can
  **mix requests from any collection**. Add steps from a grouped dropdown,
  reorder them, and run with **▶**.
- **In the runner modal:** include/exclude steps, reorder with ↑/↓, set a
  **delay between steps** (ms), toggle **stop on first error**, and watch live
  per-step status (waiting / running / status code / duration / vars set).
- A **run summary** reports pass/fail/skipped counts and total time (wall-clock
  including delays, plus summed request time).

Variables extracted mid-run are written to each step's own collection and also
threaded forward, so cross-collection runbooks still chain.

---

## cURL import

A collection's **⋯ → Import cURL…** opens a modal. Paste a `curl` command from
API docs or your terminal; method, URL, headers, body, and Basic/Bearer auth
are parsed into a new request. The parser is shell-aware (quotes, escapes,
`\`-line continuations) and lifts an `Authorization: Bearer …` header into the
structured auth field.

---

## Service templates

**✦ (New from template)** opens a categorized library that creates a ready-made
collection with requests, placeholder variables, and pre-set auth.

- **Free & no-auth** (work immediately, no key): US National Weather Service
  (weather.gov), Open-Meteo, REST Countries, Open Library, OpenStreetMap /
  Nominatim, CoinGecko, PokeAPI, JSONPlaceholder, Wikipedia, Frankfurter,
  exchangerate.host, USGS Earthquakes, NASA APOD (DEMO_KEY), Open Trivia DB,
  TheMealDB, Sunrise-Sunset.
- **Popular services** (bring your own key): GitHub, OpenAI, Stripe, Slack,
  HTTPBin.

Secret variables are created **blank and marked secret** — no real credentials
ship in the templates. weather.gov and Nominatim include a `{{userAgent}}`
variable per their usage policies.

---

## History

- Every send is recorded in the **History** tab (method, URL, status, time).
- Click an entry to **replay** it (reconstructs the request as a new tab).
- Delete individual entries or **Clear history**. Capped at 100 entries.

---

## Storage, security & encryption

- The workspace is saved to `localStorage` on every change. A **Saved
  &lt;time&gt;** indicator (with a pulsing dot) shows the last local save;
  alongside it a cloud segment shows **Syncing… / Synced &lt;time&gt; / Cloud
  on / Cloud off**.
- **Passphrase encryption (optional).** Click 🔓 to set a passphrase. The
  workspace is then encrypted at rest with **AES-GCM** (key derived via
  PBKDF2-SHA-256, 150k iterations, random salt). The passphrase is never
  stored; forget it and the data can't be recovered. On reload you're prompted
  to unlock.
- **Session-only secrets** (Settings). When on, secret variable values and all
  auth secrets are kept only in memory and never written to storage or sync —
  they clear on reload.

---

## Cloud sync (Neon)

Optional cross-device sync backed by [Neon](https://neon.tech) Postgres, with
**end-to-end encryption** — the server only ever stores ciphertext.

**How it works**

- You choose a **sync code** (a shared secret). The server is keyed by
  `SHA-256(sync code)` and can neither derive the code nor read the workspace.
- The blob is AES-GCM encrypted with your **passphrase** before upload, so sync
  requires encryption to be set.
- Use the **same sync code and passphrase** on each device.

**Enable it**

1. In Settings → **Cloud sync (Neon)**, click **Generate** (or type a code).
2. Set a passphrase (🔓) if you haven't.
3. **Push** to upload, **Pull** to fetch on another device — or turn on
   **Automatic sync** to push shortly after each change and pull on load.

**Server setup** (for self-hosting the app): set the `DATABASE_URL` environment
variable to a Neon connection string. The `/api/sync` route creates its
`workspaces` table on first use. Without `DATABASE_URL`, sync is simply
disabled (the app still works fully offline/local).

---

## Export / import

Settings → **Export to file** downloads your workspace (collections, requests,
per-collection variables, history, runbooks) as JSON. **Import from file**
restores it (with a confirm). Legacy exports with global variables are migrated
onto collections on import.

---

## Themes & layout

- Eight themes in Settings: Midnight, Graphite, Ocean, Grape, Light, High
  contrast, Low light, Monotone.
- The sidebar width and the response pane height are draggable and remembered.

---

## Mobile

The layout is responsive. On phones the sidebar becomes a slide-in drawer
(hamburger in the tab strip), the URL bar and response controls use larger
touch targets, the response pane is resizable by touch, and the editor tab row
(Params / Authorization / …) scroll-swipes horizontally.

---

## MCP server

Post-BDA ships a Phase-1 "runner" **MCP server** that lets a connected LLM send
HTTP requests via a single `send_request` tool. It is inert until you set an
`MCP_TOKEN`. See **[docs/mcp-setup.md](docs/mcp-setup.md)** for the endpoint,
token setup, verification, client-connection snippets, and the SSRF/audit
notes.

---

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000. Other scripts: `npm run build`, `npm run start`,
`npm run lint`.

---

## Deploying to Vercel

Import the repository into Vercel and deploy with the default Next.js settings.
The app is fully functional with **no** environment variables (local-only
workspace). Add the optional variables below to enable sync and/or MCP.

This repo is git-connected on Vercel: **merging to `main` deploys to
production** automatically.

---

## Environment variables

| Variable       | Required | Purpose                                                                 |
| -------------- | -------- | ----------------------------------------------------------------------- |
| `DATABASE_URL` | No       | Neon Postgres connection string — enables cloud sync and the MCP audit log. |
| `MCP_TOKEN`    | No       | Bearer token that activates the MCP server (`/api/mcp`). See docs.       |

Both are optional; unset simply disables the corresponding feature. Set them in
Vercel → Settings → Environment Variables and redeploy.

---

## Architecture notes

- **Next.js (App Router)**, a single client component for the UI, plus API
  routes: `/api/sync` (E2E workspace sync), `/api/mcp` (runner MCP server), and
  a request proxy.
- Client state persists to `localStorage`; optional AES-GCM encryption via the
  Web Crypto API; optional Neon-backed E2E sync.
- No telemetry; secrets never leave the browser except as ciphertext you opt
  into syncing.
