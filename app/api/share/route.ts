import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';

// End-to-end encrypted collection sharing.
// The client uploads a `blob` that is already AES-GCM encrypted with a share
// passphrase, keyed by `id` = SHA-256 of a random share code. The server only
// ever stores ciphertext: it can neither derive the share code nor read the
// collection. A recipient needs both the share code (→ id) and the passphrase.

const idPattern = /^[a-f0-9]{64}$/;

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

const createTable = `
  CREATE TABLE IF NOT EXISTS shares (
    share_id text PRIMARY KEY,
    blob text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`;

export async function GET(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Sharing is not configured (missing DATABASE_URL).' }, { status: 503 });

  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!idPattern.test(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  try {
    await sql.query(createTable);
    const rows = (await sql`SELECT blob FROM shares WHERE share_id = ${id}`) as { blob: string }[];
    if (!rows.length) return NextResponse.json({ error: 'No shared collection for this code.' }, { status: 404 });
    return NextResponse.json({ blob: JSON.parse(rows[0].blob) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Share read failed.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Sharing is not configured (missing DATABASE_URL).' }, { status: 503 });

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
  if (serialized.length > 4_000_000) return NextResponse.json({ error: 'Collection too large to share.' }, { status: 413 });

  try {
    await sql.query(createTable);
    await sql`
      INSERT INTO shares (share_id, blob, created_at)
      VALUES (${id}, ${serialized}, now())
      ON CONFLICT (share_id) DO UPDATE SET blob = EXCLUDED.blob, created_at = now()
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Share write failed.' }, { status: 500 });
  }
}
