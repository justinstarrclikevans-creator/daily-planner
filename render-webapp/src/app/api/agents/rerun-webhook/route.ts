import { NextRequest, NextResponse } from 'next/server';
import { supabaseFetch, isMissingRelationResponse } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const expectedSecret = (process.env.RERUN_CALLBACK_SECRET || '').trim();
    if (expectedSecret) {
      const { searchParams } = new URL(req.url);
      const provided =
        req.headers.get('x-rerun-secret') ||
        req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
        searchParams.get('secret') ||
        '';
      if (provided !== expectedSecret) {
        return NextResponse.json({ error: 'Unauthorized callback secret' }, { status: 401 });
      }
    }

    const body = await req.json();
    const mode = String(body.mode || 'approval').toLowerCase();
    const title = String(body.title || body.subject || 'Rerun Coworker Deliverable').trim();
    const content = String(body.content || body.markdown || body.summary || '').trim();
    const nowIso = new Date().toISOString();

    if (mode === 'task') {
      const taskPayload = {
        id: crypto.randomUUID(),
        project_id: body.projectId || body.project_id || null,
        title: title.replace(/!+/g, ''),
        description: content,
        list_name: String(body.listName || 'General'),
        status: 'pending',
        source: 'rerun',
        estimated_minutes: Number(body.estimatedMinutes) || 15,
        in_play_queue: false,
        subtasks: [],
        created_at: nowIso,
        updated_at: nowIso,
      };
      const res = await supabaseFetch('/tasks', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(taskPayload),
      });
      if (!res || !res.ok) {
        const errText = res ? await res.text() : 'Supabase unreachable';
        return NextResponse.json({ error: errText }, { status: res?.status || 502 });
      }
      const rows = await res.json();
      return NextResponse.json({ success: true, mode: 'task', task: Array.isArray(rows) ? rows[0] : taskPayload });
    }

    if (mode === 'note') {
      const notePayload = {
        id: crypto.randomUUID(),
        title,
        content,
        folder: String(body.folder || 'Rerun'),
        source: 'rerun',
        created_at: nowIso,
        updated_at: nowIso,
      };
      const res = await supabaseFetch('/notes', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(notePayload),
      });
      if (!res || !res.ok) {
        const errText = res ? await res.text() : 'Supabase unreachable';
        return NextResponse.json({ error: errText }, { status: res?.status || 502 });
      }
      const rows = await res.json();
      return NextResponse.json({ success: true, mode: 'note', note: Array.isArray(rows) ? rows[0] : notePayload });
    }

    // Default: drop into "Needs You" Approval Inbox as a rerun_coworker deliverable
    const jobPayload = {
      id: crypto.randomUUID(),
      venture_id: body.ventureId || body.venture_id || null,
      project_id: body.projectId || body.project_id || null,
      agent_role: String(body.agentRole || 'rerun'),
      job_type: 'rerun_coworker',
      title,
      prompt: String(body.prompt || 'Inbound deliverable pushed from Rerun Coworker'),
      status: 'needs_approval',
      output_markdown: content || JSON.stringify(body.payload || {}, null, 2),
      output_payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      created_at: nowIso,
      updated_at: nowIso,
    };

    const res = await supabaseFetch('/agent_jobs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(jobPayload),
    });

    if (!res || !res.ok) {
      const errText = res ? await res.text() : 'Supabase unreachable';
      return NextResponse.json(
        {
          error: errText,
          needsMigration: res ? isMissingRelationResponse(res.status, errText) : false,
        },
        { status: res?.status || 502 }
      );
    }

    const rows = await res.json();
    return NextResponse.json({
      success: true,
      mode: 'approval',
      job: Array.isArray(rows) ? rows[0] : jobPayload,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
