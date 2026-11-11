import { NextRequest, NextResponse } from 'next/server';
import { SUNSAMA_CHANNELS, CHANNEL_COLORS, SunsamaChannel } from '@/lib/supabase';
import { fetchCustomChannelsFromSheet, saveCustomChannelsToSheet } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

export async function GET() {
  const custom = await fetchCustomChannelsFromSheet();
  const allChannels: SunsamaChannel[] = [...SUNSAMA_CHANNELS, ...custom];
  return NextResponse.json({ channels: allChannels });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const label = (body.label || '').trim();
    if (!label) {
      return NextResponse.json({ error: 'Channel name is required' }, { status: 400 });
    }

    let tag = (body.tag || '')
      .toLowerCase()
      .replace(/^#/, '')
      .replace(/[^a-z0-9_-]/g, '')
      .trim();

    if (!tag) {
      tag = label
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .trim();
    }

    if (!tag) {
      return NextResponse.json({ error: 'Invalid channel tag' }, { status: 400 });
    }

    const custom = await fetchCustomChannelsFromSheet();
    const existing = [...SUNSAMA_CHANNELS, ...custom];

    if (existing.some((c) => c.tag.toLowerCase() === tag.toLowerCase())) {
      return NextResponse.json(
        { error: `Channel #${tag} already exists` },
        { status: 400 }
      );
    }

    const color =
      body.color ||
      CHANNEL_COLORS[(existing.length + 3) % CHANNEL_COLORS.length];

    const newChannel: SunsamaChannel = {
      tag,
      label,
      color,
      isCustom: true,
    };

    const nextCustom = [...custom, newChannel];
    await saveCustomChannelsToSheet(nextCustom);

    return NextResponse.json({
      success: true,
      channel: newChannel,
      channels: [...SUNSAMA_CHANNELS, ...nextCustom],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tag = (searchParams.get('tag') || '').toLowerCase().trim();
    if (!tag) {
      return NextResponse.json({ error: 'Missing channel tag' }, { status: 400 });
    }

    // Protect built-in channels
    if (SUNSAMA_CHANNELS.some((c) => c.tag.toLowerCase() === tag)) {
      return NextResponse.json(
        { error: 'Cannot delete built-in system channels' },
        { status: 400 }
      );
    }

    const custom = await fetchCustomChannelsFromSheet();
    const nextCustom = custom.filter((c) => c.tag.toLowerCase() !== tag);

    await saveCustomChannelsToSheet(nextCustom);

    return NextResponse.json({
      success: true,
      channels: [...SUNSAMA_CHANNELS, ...nextCustom],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
