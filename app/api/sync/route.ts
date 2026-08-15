import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';

// End-to-end encrypted workspace sync.
// The client sends an opaque `id` (SHA-256 of the user's secret sync code) and a
// `blob` that is already AES-GCM encrypted with the user's passphrase. The server
// only ever stores ciphertext keyed by that hash — it can neither derive the sync
// code nor read the workspace.

const idPattern = /^[a-f0-9]{64}$/;

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

const createTable = `
  CREATE TABLE IF NOT EXISTS workspaces (
    sync_id text PRIMARY KEY,
    blob text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

export async function GET(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Sync is not configured (missing DATABASE_URL).' }, { status: 503 });

  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!idPattern.test(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  try {
    await sql.query(createTable);
    const rows = (await sql`SELECT blob, updated_at FROM workspaces WHERE sync_id = ${id}`) as {
      blob: string;
      updated_at: string;
    }[];
    if (!rows.length) return NextResponse.json({ error: 'No cloud data for this sync code.' }, { status: 404 });
    return NextResponse.json({ blob: JSON.parse(rows[0].blob), updatedAt: rows[0].updated_at });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sync read failed.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Sync is not configured (missing DATABASE_URL).' }, { status: 503 });

  let body: { id?: unknown; blob?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const id = String(body.id ?? '');
  if (!idPattern.test(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  if (!body.blob || typeof body.blob !== 'object') return NextResponse.json({ error: 'Invalid blob.' }, { status: 400 });

  const serialized = JSON.stringify(body.blob);
  if (serialized.length > 8_000_000) return NextResponse.json({ error: 'Workspace too large to sync.' }, { status: 413 });

  try {
    await sql.query(createTable);
    await sql`
      INSERT INTO workspaces (sync_id, blob, updated_at)
      VALUES (${id}, ${serialized}, now())
      ON CONFLICT (sync_id) DO UPDATE SET blob = EXCLUDED.blob, updated_at = now()
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sync write failed.' }, { status: 500 });
  }
}
