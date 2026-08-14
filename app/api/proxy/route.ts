import { NextRequest, NextResponse } from 'next/server';

const blockedHeaders = new Set(['host', 'connection', 'content-length']);

export async function POST(request: NextRequest) {
  const started = Date.now();
  const payload = await request.json();
  const targetUrl = String(payload.url ?? '');

  if (!/^https?:\/\//i.test(targetUrl)) {
    return NextResponse.json({ error: 'Only absolute http:// or https:// URLs can be sent.' }, { status: 400 });
  }

  const method = String(payload.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  Object.entries((payload.headers ?? {}) as Record<string, string>).forEach(([key, value]) => {
    if (key && !blockedHeaders.has(key.toLowerCase())) headers.set(key, value);
  });

  const init: RequestInit = { method, headers, redirect: 'follow' };
  if (!['GET', 'HEAD'].includes(method) && payload.body) init.body = String(payload.body);

  try {
    const response = await fetch(targetUrl, init);
    const body = await response.text();

    return NextResponse.json({
      status: response.status,
      statusText: response.statusText,
      duration: Date.now() - started,
      headers: Array.from(response.headers.entries()),
      body,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed.' }, { status: 502 });
  }
}
