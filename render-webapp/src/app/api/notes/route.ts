import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://irlqhowgimaxmnpiocmp.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_jpHLDOeJ9TqWdA-esBVqyA_v3u9C7Ay';

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    return null;
  }
}

export async function GET() {
  try {
    const res = await supabaseFetch('/notes?select=*&order=updated_at.desc');
    if (!res) {
      return NextResponse.json({ notes: [], error: 'Supabase unreachable' }, { status: 502 });
    }
    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ notes: [], error: errText }, { status: res.status });
    }
    const notes = await res.json();
    return NextResponse.json({ notes: Array.isArray(notes) ? notes : [] });
  } catch (e) {
    return NextResponse.json({ notes: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = String(body.title || '').trim() || 'Untitled Note';
    const content = String(body.content || '');
    const folder = String(body.folder || 'Notes').trim() || 'Notes';
    const now = new Date().toISOString();

    const payload = {
      id: body.id || crypto.randomUUID(),
      title,
      content,
      folder,
      apple_note_id: body.apple_note_id || null,
      source: body.source || 'webapp',
      created_at: now,
      updated_at: now,
    };

    const res = await supabaseFetch('/notes', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });

    if (!res || !res.ok) {
      const errText = res ? await res.text() : 'Supabase unreachable';
      return NextResponse.json({ error: errText }, { status: res?.status || 502 });
    }

    const created = await res.json();
    return NextResponse.json({
      success: true,
      note: Array.isArray(created) ? created[0] : payload,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Note id is required' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.title !== undefined) {
      patch.title = String(body.title).trim() || 'Untitled Note';
    }
    if (body.content !== undefined) {
      patch.content = String(body.content);
    }
    if (body.folder !== undefined) {
      patch.folder = String(body.folder).trim() || 'Notes';
    }

    const res = await supabaseFetch(`/notes?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });

    if (!res || !res.ok) {
      const errText = res ? await res.text() : 'Supabase unreachable';
      return NextResponse.json({ error: errText }, { status: res?.status || 502 });
    }

    const updated = await res.json();
    return NextResponse.json({
      success: true,
      note: Array.isArray(updated) && updated[0] ? updated[0] : { id, ...patch },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Note id is required' }, { status: 400 });
    }

    const res = await supabaseFetch(`/notes?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    if (!res || !res.ok) {
      const errText = res ? await res.text() : 'Supabase unreachable';
      return NextResponse.json({ error: errText }, { status: res?.status || 502 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
