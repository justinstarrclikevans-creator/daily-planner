import { NextRequest, NextResponse } from 'next/server';
import { supabaseFetch, isMissingRelationResponse } from '@/lib/supabaseServer';

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
    const res = await supabaseFetch('/agent_settings?id=eq.default&limit=1');
    if (!res) {
      return NextResponse.json({ settings: DEFAULT_SETTINGS, error: 'Supabase unreachable' }, { status: 502 });
    }
    if (!res.ok) {
      const errText = await res.text();
      if (isMissingRelationResponse(res.status, errText)) {
        return NextResponse.json({ settings: DEFAULT_SETTINGS, needsMigration: true });
      }
      return NextResponse.json({ settings: DEFAULT_SETTINGS, error: errText }, { status: res.status });
    }

    const rows = await res.json();
    return NextResponse.json({
      settings: Array.isArray(rows) && rows[0] ? rows[0] : DEFAULT_SETTINGS,
      needsMigration: false,
    });
  } catch (e) {
    return NextResponse.json({ settings: DEFAULT_SETTINGS, error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const payload: Record<string, unknown> = {
      id: 'default',
      updated_at: new Date().toISOString(),
    };

    if (body.default_rerun_webhook_url !== undefined || body.defaultRerunWebhookUrl !== undefined) {
      payload.default_rerun_webhook_url = String(
        body.default_rerun_webhook_url ?? body.defaultRerunWebhookUrl ?? ''
      ).trim();
    }
    if (body.rerun_coworkers !== undefined || body.rerunCoworkers !== undefined) {
      payload.rerun_coworkers = body.rerun_coworkers ?? body.rerunCoworkers ?? [];
    }
    if (body.default_from_email !== undefined || body.defaultFromEmail !== undefined) {
      payload.default_from_email = String(body.default_from_email ?? body.defaultFromEmail ?? '').trim();
    }
    if (body.auto_send_on_approve !== undefined || body.autoSendOnApprove !== undefined) {
      payload.auto_send_on_approve = Boolean(body.auto_send_on_approve ?? body.autoSendOnApprove);
    }

    const res = await supabaseFetch('/agent_settings?on_conflict=id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
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

    const rows = await res.json();
    return NextResponse.json({
      success: true,
      settings: Array.isArray(rows) && rows[0] ? rows[0] : payload,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
