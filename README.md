# Post-BDA

A Vercel-ready Postman-style HTTP API client built with Next.js. It lets teams configure requests, manage headers and query parameters, save a local request collection, substitute environment variables, and inspect responses.

## Features

- Create, duplicate, delete, and switch between saved HTTP requests.
- Configure method, URL, query parameters, headers, and request body.
- Define environment variables and use `{{variableName}}` placeholders in URLs, headers, parameters, and bodies.
- Send requests through a Vercel Route Handler proxy to reduce browser CORS limitations and inspect status, timing, response headers, and formatted JSON bodies.
- Group requests by collection, duplicate existing calls, delete stale requests, and persist workspace data in `localStorage` so it survives page refreshes without a database.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the workspace.

## Deploying to Vercel

Import this repository into Vercel and deploy with the default Next.js settings. No server-side environment variables are required. The included `/api/proxy` route relays configured HTTP requests from the Vercel deployment.
