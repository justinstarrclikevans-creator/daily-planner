import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROJECTS, Project } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://huwattmqwiqhcfhtqely.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_secret_21i-I_QCc5xA_dPeVQPKsg_iV7ZzjQm';

let inMemoryProjects: Project[] = [...DEFAULT_PROJECTS];

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
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
    const res = await supabaseFetch('/projects?select=*&order=name.asc');
    if (res && res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        inMemoryProjects = data;
        return NextResponse.json({ projects: inMemoryProjects });
      }
    }
    return NextResponse.json({ projects: inMemoryProjects });
  } catch (e) {
    return NextResponse.json({ projects: inMemoryProjects });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const newProject: Project = {
      id: body.id || crypto.randomUUID(),
      name: body.name,
      slug: body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      color: body.color || '#6366F1',
      icon: body.icon || 'folder',
      goal: body.goal || `Focus on ${body.name}`,
      keywords: body.keywords || [],
      instructions: body.instructions || '',
    };

    // Background push to Supabase if configured
    supabaseFetch('/projects', {
      method: 'POST',
      body: JSON.stringify(newProject),
    }).catch(() => null);

    inMemoryProjects.push(newProject);
    return NextResponse.json({ success: true, project: newProject });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'Missing project id' }, { status: 400 });

    supabaseFetch(`/projects?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }).catch(() => null);

    const idx = inMemoryProjects.findIndex((p) => p.id === id);
    if (idx !== -1) {
      inMemoryProjects[idx] = { ...inMemoryProjects[idx], ...updates };
      return NextResponse.json({ success: true, project: inMemoryProjects[idx] });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
