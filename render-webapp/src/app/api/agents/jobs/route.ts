import { NextRequest, NextResponse } from 'next/server';
import { supabaseFetch, isMissingRelationResponse } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ventureId = searchParams.get('ventureId');
    const status = searchParams.get('status');

    const filters = ['select=*', 'order=created_at.desc', 'limit=100'];
    if (ventureId) filters.push(`venture_id=eq.${encodeURIComponent(ventureId)}`);
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);

    const res = await supabaseFetch(`/agent_jobs?${filters.join('&')}`);
    if (!res) {
      return NextResponse.json({ jobs: [], needsMigration: false, error: 'Supabase unreachable' }, { status: 502 });
    }

    if (!res.ok) {
      const errText = await res.text();
      if (isMissingRelationResponse(res.status, errText)) {
        return NextResponse.json({ jobs: [], needsMigration: true });
      }
      return NextResponse.json({ jobs: [], needsMigration: false, error: errText }, { status: res.status });
    }

    const jobs = await res.json();
    return NextResponse.json({
      jobs: Array.isArray(jobs) ? jobs : [],
      needsMigration: false,
    });
  } catch (e) {
    return NextResponse.json({ jobs: [], needsMigration: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Direct Rerun webhook test ping from Connections tab
    if (body.testWebhook === true) {
      const webhookUrl = String(body.webhookUrl || '').trim();
      let parsed: URL;
      try {
        parsed = new URL(webhookUrl);
      } catch {
        return NextResponse.json({ ok: false, error: 'Invalid webhook URL format.' }, { status: 400 });
      }

      const isHttps = parsed.protocol === 'https:';
      const isLocalHttp =
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

      if (!isHttps && !isLocalHttp) {
        return NextResponse.json(
          { ok: false, error: 'Webhook URL must use https:// (or http://localhost).' },
          { status: 400 }
        );
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      const secret = (process.env.RERUN_CALLBACK_SECRET || '').trim();
      if (secret) headers['X-Rerun-Secret'] = secret;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      try {
        const pingRes = await fetch(parsed.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source: 'todo-companion-ai-ceo',
            event: 'test_ping',
            coworkerName: body.coworkerName || 'Rerun Coworker',
            timestamp: new Date().toISOString(),
            message: 'Test webhook ping from ToDo Webapp AI CEO.',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const text = await pingRes.text();
        if (!pingRes.ok) {
          return NextResponse.json(
            {
              ok: false,
              status: pingRes.status,
              error: `Webhook returned HTTP ${pingRes.status}${text ? `: ${text.slice(0, 180)}` : ''}`,
            },
            { status: 200 }
          );
        }
        return NextResponse.json({
          ok: true,
          status: pingRes.status,
          responsePreview: text.slice(0, 240),
        });
      } catch (err: any) {
        clearTimeout(timeoutId);
        return NextResponse.json(
          {
            ok: false,
            status: 0,
            error: err?.name === 'AbortError' ? 'Webhook timed out after 12s.' : err?.message || String(err),
          },
          { status: 200 }
        );
      }
    }

    const title = String(body.title || '').trim();
    if (!title) {
      return NextResponse.json({ error: 'Job title is required.' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const jobType = String(body.jobType || body.job_type || 'market_research');
    let requestedStatus = String(body.status || 'queued');
    // Strict 1-tap approval: outbound email / Slack jobs can only be created as drafts.
    // They reach 'approved' exclusively via the PATCH 'approve' action (Justin's tap).
    const OUTBOUND_JOB_TYPES = ['email_outreach', 'slack_message', 'task_assist'];
    if (OUTBOUND_JOB_TYPES.includes(jobType) && !['queued', 'needs_approval'].includes(requestedStatus)) {
      requestedStatus = 'queued';
    }
    const payload = {
      id: body.id || crypto.randomUUID(),
      venture_id: body.ventureId || body.venture_id || null,
      project_id: body.projectId || body.project_id || null,
      source_task_id: body.sourceTaskId || body.source_task_id || null,
      agent_role: String(body.agentRole || body.agent_role || 'researcher'),
      job_type: jobType,
      title,
      prompt: String(body.prompt || ''),
      status: requestedStatus,
      output_markdown: String(body.outputMarkdown || body.output_markdown || ''),
      output_payload: body.outputPayload || body.output_payload || {},
      revision_feedback: '',
      execution_result: {},
      execution_error: '',
      created_at: nowIso,
      updated_at: nowIso,
    };

    const res = await supabaseFetch('/agent_jobs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
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

    const created = await res.json();
    return NextResponse.json({
      success: true,
      job: Array.isArray(created) ? created[0] : payload,
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
      return NextResponse.json({ error: 'Job id is required.' }, { status: 400 });
    }

    const action = String(body.action || '').trim();
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.outputMarkdown !== undefined || body.output_markdown !== undefined) {
      patch.output_markdown = String(body.outputMarkdown ?? body.output_markdown ?? '');
    }
    if (body.outputPayload !== undefined || body.output_payload !== undefined) {
      patch.output_payload = body.outputPayload ?? body.output_payload ?? {};
    }
    if (body.revisionFeedback !== undefined || body.revision_feedback !== undefined) {
      patch.revision_feedback = String(body.revisionFeedback ?? body.revision_feedback ?? '');
    }

    switch (action) {
      case 'approve':
        patch.status = 'approved';
        patch.execution_error = '';
        break;
      case 'revise':
        patch.status = 'queued';
        patch.execution_error = '';
        break;
      case 'reject':
        patch.status = 'rejected';
        break;
      case 'retry':
        patch.status = body.retryMode === 'execute' ? 'approved' : 'queued';
        patch.execution_error = '';
        break;
      default:
        if (body.status) patch.status = String(body.status);
        break;
    }

    const res = await supabaseFetch(`/agent_jobs?id=eq.${encodeURIComponent(id)}`, {
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
      job: Array.isArray(updated) ? updated[0] : null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Job id is required.' }, { status: 400 });
    }

    const res = await supabaseFetch(`/agent_jobs?id=eq.${encodeURIComponent(id)}`, {
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
