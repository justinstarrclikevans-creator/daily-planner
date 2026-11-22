export const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://irlqhowgimaxmnpiocmp.supabase.co';

export const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_jpHLDOeJ9TqWdA-esBVqyA_v3u9C7Ay';

export async function supabaseFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs = 8000
): Promise<Response | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

export function isMissingRelationResponse(status: number, text: string): boolean {
  const lower = (text || '').toLowerCase();
  return (
    status === 404 ||
    lower.includes('42p01') ||
    lower.includes('pgrst205') ||
    lower.includes('could not find the table') ||
    lower.includes('does not exist')
  );
}

export function slugifyText(input: string): string {
  return (
    String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `venture-${Date.now()}`
  );
}
