import { NextRequest, NextResponse } from 'next/server';
import {
  supabaseFetch,
  isMissingRelationResponse,
  slugifyText,
} from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const DEFAULT_SETTINGS = {
  id: 'default',
  default_rerun_webhook_url: '',
  rerun_coworkers: [],
  default_from_email: '',
  auto_send_on_approve: true,
  daemon_heartbeat_at: null,
  daemon_capabilities: {},
};

export async function GET() {
  try {
    const [venturesRes, settingsRes] = await Promise.all([
      supabaseFetch('/agent_ventures?select=*&order=created_at.desc'),
      supabaseFetch('/agent_settings?id=eq.default&limit=1'),
    ]);

    if (!venturesRes) {
      return NextResponse.json(
        { ventures: [], settings: DEFAULT_SETTINGS, needsMigration: false, error: 'Supabase unreachable' },
        { status: 502 }
      );
    }

    if (!venturesRes.ok) {
      const errText = await venturesRes.text();
      if (isMissingRelationResponse(venturesRes.status, errText)) {
        return NextResponse.json({
          ventures: [],
          settings: DEFAULT_SETTINGS,
          needsMigration: true,
        });
      }
      return NextResponse.json(
        { ventures: [], settings: DEFAULT_SETTINGS, needsMigration: false, error: errText },
        { status: venturesRes.status }
      );
    }

    const ventures = await venturesRes.json();
    let settings = DEFAULT_SETTINGS;
    if (settingsRes && settingsRes.ok) {
      const sRows = await settingsRes.json();
      if (Array.isArray(sRows) && sRows[0]) {
        settings = sRows[0];
      }
    }

    return NextResponse.json({
      ventures: Array.isArray(ventures) ? ventures : [],
      settings,
      needsMigration: false,
    });
  } catch (e) {
    return NextResponse.json(
      { ventures: [], settings: DEFAULT_SETTINGS, needsMigration: false, error: String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || '').trim();
    const ideaPrompt = String(body.ideaPrompt || body.idea_prompt || '').trim();
    const targetAudience = String(body.targetAudience || body.target_audience || '').trim();
    const icpQuery = String(body.icpQuery || body.icp_query || '').trim();
    const rerunWebhookUrl = String(body.rerunWebhookUrl || body.rerun_webhook_url || '').trim();
    const createLinkedProject = body.createLinkedProject !== false;

    if (!name) {
      return NextResponse.json({ error: 'Venture / Project name is required.' }, { status: 400 });
    }

    let projectId: string | null = body.projectId || body.project_id || null;
    let createdProject: Record<string, unknown> | null = null;

    if (!projectId && createLinkedProject) {
      const baseSlug = slugifyText(name);
      const existingProjRes = await supabaseFetch(
        `/projects?slug=eq.${encodeURIComponent(baseSlug)}&select=*&limit=1`
      );
      let existingProj = null;
      if (existingProjRes && existingProjRes.ok) {
        const rows = await existingProjRes.json();
        if (Array.isArray(rows) && rows[0]) existingProj = rows[0];
      }

      if (existingProj) {
        projectId = existingProj.id;
        createdProject = existingProj;
      } else {
        const palette = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#3B82F6', '#8B5CF6', '#14B8A6'];
        const newProjPayload = {
          id: crypto.randomUUID(),
          name,
          slug: baseSlug,
          color: palette[Math.floor(Math.random() * palette.length)],
          icon: 'sparkles',
          goal: ideaPrompt || `AI CEO venture for ${name}`,
          instructions: targetAudience
            ? `Tasks related to ${name} (${targetAudience}).`
            : `Tasks related to ${name}.`,
        };
        const projRes = await supabaseFetch('/projects', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(newProjPayload),
        });
        if (projRes && projRes.ok) {
          const pRows = await projRes.json();
          createdProject = Array.isArray(pRows) ? pRows[0] : newProjPayload;
          projectId = String((createdProject as any).id || newProjPayload.id);
        }
      }
    }

    const baseVentureSlug = slugifyText(name);
    const uniqueSlug = `${baseVentureSlug}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    const venturePayload = {
      id: crypto.randomUUID(),
      project_id: projectId,
      name,
      slug: uniqueSlug,
      idea_prompt: ideaPrompt || name,
      target_audience: targetAudience,
      icp_query: icpQuery,
      stage: 'planning',
      autopilot_enabled: body.autopilotEnabled !== false,
      strategy_markdown: '',
      rerun_webhook_url: rerunWebhookUrl,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const ventureRes = await supabaseFetch('/agent_ventures', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(venturePayload),
    });

    if (!ventureRes) {
      return NextResponse.json({ error: 'Supabase unreachable' }, { status: 502 });
    }

    if (!ventureRes.ok) {
      const errText = await ventureRes.text();
      return NextResponse.json(
        {
          error: errText,
          needsMigration: isMissingRelationResponse(ventureRes.status, errText),
        },
        { status: ventureRes.status }
      );
    }

    const vRows = await ventureRes.json();
    const venture = Array.isArray(vRows) ? vRows[0] : venturePayload;

    // Immediately queue the initial AI CEO planning job
    const jobPayload = {
      id: crypto.randomUUID(),
      venture_id: venture.id,
      project_id: projectId,
      agent_role: 'ceo',
      job_type: 'plan_venture',
      title: `AI CEO Launch Plan: ${name}`,
      prompt: ideaPrompt || `Build an execution strategy, human checklist, and agent workflow for ${name}.`,
      status: 'queued',
      created_at: nowIso,
      updated_at: nowIso,
    };

    const jobRes = await supabaseFetch('/agent_jobs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(jobPayload),
    });

    let initialJob = null;
    if (jobRes && jobRes.ok) {
      const jRows = await jobRes.json();
      initialJob = Array.isArray(jRows) ? jRows[0] : jobPayload;
    }

    return NextResponse.json({
      success: true,
      venture,
      project: createdProject,
      initialJob,
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
      return NextResponse.json({ error: 'Venture id is required.' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.ideaPrompt !== undefined || body.idea_prompt !== undefined) {
      patch.idea_prompt = String(body.ideaPrompt ?? body.idea_prompt ?? '');
    }
    if (body.targetAudience !== undefined || body.target_audience !== undefined) {
      patch.target_audience = String(body.targetAudience ?? body.target_audience ?? '');
    }
    if (body.icpQuery !== undefined || body.icp_query !== undefined) {
      patch.icp_query = String(body.icpQuery ?? body.icp_query ?? '');
    }
    if (body.stage !== undefined) patch.stage = String(body.stage);
    if (body.autopilotEnabled !== undefined || body.autopilot_enabled !== undefined) {
      patch.autopilot_enabled = Boolean(body.autopilotEnabled ?? body.autopilot_enabled);
    }
    if (body.strategyMarkdown !== undefined || body.strategy_markdown !== undefined) {
      patch.strategy_markdown = String(body.strategyMarkdown ?? body.strategy_markdown ?? '');
    }
    if (body.rerunWebhookUrl !== undefined || body.rerun_webhook_url !== undefined) {
      patch.rerun_webhook_url = String(body.rerunWebhookUrl ?? body.rerun_webhook_url ?? '').trim();
    }

    const res = await supabaseFetch(`/agent_ventures?id=eq.${encodeURIComponent(id)}`, {
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
      venture: Array.isArray(updated) ? updated[0] : null,
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
      return NextResponse.json({ error: 'Venture id is required.' }, { status: 400 });
    }

    const res = await supabaseFetch(`/agent_ventures?id=eq.${encodeURIComponent(id)}`, {
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
