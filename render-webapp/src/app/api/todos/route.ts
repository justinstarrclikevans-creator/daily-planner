import { NextRequest, NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://huwattmqwiqhcfhtqely.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_secret_21i-I_QCc5xA_dPeVQPKsg_iV7ZzjQm';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6IcCg0ZHzgemvtrQ-8oyseoCX5QSMOxKBT_aCyMXrHd6w';

// Helper for Supabase PostgREST queries
async function supabaseFetch(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

// Google Sheets helper for backwards compatibility
async function getSheetDoc() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
    return null;
  }

  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  let sanitizedKey = rawKey.trim();
  if (sanitizedKey.startsWith('"') && sanitizedKey.endsWith('"')) {
    sanitizedKey = sanitizedKey.slice(1, -1);
  } else if (sanitizedKey.startsWith("'") && sanitizedKey.endsWith("'")) {
    sanitizedKey = sanitizedKey.slice(1, -1);
  }
  
  if (!sanitizedKey.includes('-----BEGIN PRIVATE KEY-----')) {
    try {
      sanitizedKey = Buffer.from(sanitizedKey, 'base64').toString('ascii');
    } catch (e) {
      // ignore
    }
  }

  sanitizedKey = sanitizedKey.replace(/\\n/g, '\n');
  if (!sanitizedKey.includes('\n') && sanitizedKey.includes('-----BEGIN PRIVATE KEY-----')) {
    const middle = sanitizedKey
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s+/g, '');
    const chunked = middle.match(/.{1,64}/g)?.join('\n') || middle;
    sanitizedKey = `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----\n`;
  }
  
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: sanitizedKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo(); 
  return doc;
}

export async function GET() {
  try {
    // 1. Fetch live projects, tasks, ideas, and routines from Supabase
    const [projRes, taskRes, ideasRes, routinesRes] = await Promise.all([
      supabaseFetch('/projects?select=*&order=name.asc'),
      supabaseFetch('/tasks?select=*&order=created_at.desc'),
      supabaseFetch('/ideas?select=*&order=created_at.desc'),
      supabaseFetch('/routines?select=*&order=created_at.asc')
    ]);

    let projects = [];
    if (projRes.ok) {
      projects = await projRes.json();
    }
    
    let routines = [];
    if (routinesRes && routinesRes.ok) {
      routines = await routinesRes.json();
    }
    
    // Default fallback projects if table empty
    if (!projects || projects.length === 0) {
      projects = [
        { id: '23f5cfa3-61bc-4886-8206-f75218981310', name: 'First Shift', slug: 'first-shift', color: '#EF4444', icon: 'briefcase', goal: 'Re-entry employment program operations' },
        { id: '1ca4c9ae-855d-42b6-b317-d8bcc74d77bf', name: 'Albertine Initiative', slug: 'albertine', color: '#3B82F6', icon: 'video', goal: 'Community outreach and media initiatives' },
        { id: 'b883937b-8b4a-4031-b783-9ea5a9ed82fe', name: 'Football / 843', slug: 'football-843', color: '#10B981', icon: 'activity', goal: 'Rec training, coaching drills, and youth leagues' },
        { id: '77b31dd7-4425-4c9b-804d-e8901217279c', name: 'Personal', slug: 'personal', color: '#8B5CF6', icon: 'user', goal: 'Personal life, health, appointments, and family errands' }
      ];
    }

    let tasks = [];
    if (taskRes.ok) {
      tasks = await taskRes.json();
    }

    let ideas = [];
    if (ideasRes.ok) {
      ideas = await ideasRes.json();
    }

    // 2. Fetch optional Google Sheets data (reminders, letterly, dailySummary)
    let letterly: any[] = [];
    let dailySummary = null;
    try {
      const doc = await getSheetDoc();
      if (doc) {
        const letterlySheet = doc.sheetsByTitle['Letterly'];
        if (letterlySheet) {
          const rows = await letterlySheet.getRows();
          rows.forEach(row => {
            letterly.push({
              rowNumber: row.rowNumber,
              id: row.get('ID'),
              timestamp: row.get('Timestamp'),
              original: row.get('Original Text'),
              summary: row.get('Summary')
            });
          });
        }
        const dailySummarySheet = doc.sheetsByTitle['DailySummary'];
        if (dailySummarySheet) {
          const rows = await dailySummarySheet.getRows();
          if (rows.length > 0) {
            const lastRow = rows[rows.length - 1];
            dailySummary = {
              date: lastRow.get('Date'),
              summary: lastRow.get('Summary')
            };
          }
        }
      }
    } catch (sheetErr) {
      console.warn("Google Sheets fetch skipped:", sheetErr);
    }

    return NextResponse.json({
      projects,
      tasks,
      ideas,
      routines,
      letterly,
      dailySummary
    });
  } catch (e: any) {
    console.error("API GET error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // --- SUPABASE ACTIONS ---
    if (action === 'create_task') {
      const { title, description, list_name, project_id, estimated_minutes, in_play_queue, first_five_minutes, subtasks } = body;
      
      // Build serialized description
      let finalDescription = description || '';
      const tags: string[] = [];
      if (estimated_minutes) tags.push(`[⏱ ${estimated_minutes}m]`);
      if (in_play_queue) tags.push('[▶️ Queue]');
      
      const parts: string[] = [];
      if (tags.length > 0) parts.push(tags.join(' '));
      if (first_five_minutes) parts.push(`⚡ First 5 Minutes: ${first_five_minutes}`);
      if (finalDescription) parts.push(finalDescription);
      if (Array.isArray(subtasks) && subtasks.length > 0) {
        const steps = subtasks.map(s => `- [${s.isCompleted ? 'x' : ' '}] ${s.title}`);
        parts.push(steps.join('\n'));
      }
      finalDescription = parts.join('\n');

      const payload = {
        title,
        description: finalDescription,
        list_name: list_name || 'Personal',
        project_id: project_id || null,
        status: 'pending',
        source: 'web',
        created_at: new Date().toISOString()
      };

      const res = await supabaseFetch('/tasks', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json({ error: errText }, { status: res.status });
      }

      const created = await res.json();
      return NextResponse.json({ success: true, task: created[0] });
    }

    if (action === 'update_task') {
      const { id, title, description, status, list_name, project_id } = body;
      const patch: any = { updated_at: new Date().toISOString() };
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (status !== undefined) patch.status = status;
      if (list_name !== undefined) patch.list_name = list_name;
      if (project_id !== undefined) patch.project_id = project_id;

      const res = await supabaseFetch(`/tasks?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(patch)
      });

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: err }, { status: res.status });
      }

      const updated = await res.json();
      return NextResponse.json({ success: true, task: updated[0] });
    }

    if (action === 'toggle_task') {
      const { id, currentStatus } = body;
      const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';

      const res = await supabaseFetch(`/tasks?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
      });

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: err }, { status: res.status });
      }

      const updated = await res.json();
      return NextResponse.json({ success: true, task: updated[0], newStatus });
    }

    if (action === 'delete_task') {
      const { id } = body;
      const res = await supabaseFetch(`/tasks?id=eq.${id}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: err }, { status: res.status });
      }

      return NextResponse.json({ success: true });
    }

    if (action === 'toggle_play_queue') {
      const { id, currentInQueue } = body;
      const newInQueue = !currentInQueue;
      const res = await supabaseFetch(`/tasks?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          in_play_queue: newInQueue,
          updated_at: new Date().toISOString()
        })
      });
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: err }, { status: res.status });
      }
      const updated = await res.json();
      return NextResponse.json({ success: true, task: updated[0], in_play_queue: newInQueue });
    }

    if (action === 'insert_routine') {
      const { routine_id, routine_name } = body;
      let routine = null;
      if (routine_id) {
        const rRes = await supabaseFetch(`/routines?id=eq.${routine_id}`);
        if (rRes.ok) {
          const list = await rRes.json();
          routine = list[0];
        }
      }
      if (!routine && routine_name) {
        const rRes = await supabaseFetch(`/routines?title=ilike.*${encodeURIComponent(routine_name)}*`);
        if (rRes.ok) {
          const list = await rRes.json();
          routine = list[0];
        }
      }
      if (!routine) {
        return NextResponse.json({ error: 'Routine not found' }, { status: 404 });
      }

      const items = routine.items || [];
      const createdTasks = [];
      for (const item of items) {
        const payload = {
          title: item.title,
          description: `[⏱ ${item.estimatedMinutes || 10}m] [▶️ Queue]\n${item.description || ''}`,
          estimated_minutes: item.estimatedMinutes || 10,
          in_play_queue: true,
          list_name: routine.title.includes('Shift') ? 'First shift' : (routine.title.includes('Football') ? 'Football' : 'Personal'),
          project_id: routine.project_id || null,
          status: 'pending',
          source: 'web_routine',
          created_at: new Date().toISOString()
        };
        const cRes = await supabaseFetch('/tasks', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(payload)
        });
        if (cRes.ok) {
          const created = await cRes.json();
          createdTasks.push(created[0]);
        }
      }
      return NextResponse.json({ success: true, count: createdTasks.length, tasks: createdTasks });
    }

    // --- GEMINI AI BREAKDOWN ---
    if (action === 'ai_breakdown') {
      const { title, context, detailLevel } = body;
      
      let stepGuide = "4 to 5 clear, sequential steps";
      if (detailLevel === 'quick') stepGuide = "exactly 3 high-level, punchy steps";
      if (detailLevel === 'micro') stepGuide = "6 to 8 tiny, zero-friction physical micro-steps (under 2 minutes each) for ADHD paralysis";

      const prompt = `You are an expert ADHD executive coach helping Justin start and finish a task.
Task Title: "${title}"
Context: "${context || 'None'}"
Requested Granularity: ${stepGuide}

Generate:
1. firstFiveMinutes: A single, ultra-specific, low-barrier physical action Justin can do in the next 60 seconds to break initiation paralysis.
2. estimatedMinutes: Realistic total duration in minutes (5, 10, 15, 25, 30, 45, or 60).
3. steps: An array of ${stepGuide} walking from start to finish. Keep each step concise (under 10 words).

Respond with ONLY valid JSON:
{
  "firstFiveMinutes": "Smallest immediate physical starter action",
  "estimatedMinutes": 15,
  "steps": ["Step 1", "Step 2", "Step 3"]
}`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!geminiRes.ok) {
        const err = await geminiRes.text();
        return NextResponse.json({ error: `Gemini API error: ${err}` }, { status: 500 });
      }

      const geminiJson = await geminiRes.json();
      const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(rawText || '{}');

      return NextResponse.json({ success: true, breakdown: parsed });
    }

    // --- GEMINI PROMOTE IDEA TO TASKS ---
    if (action === 'promote_idea') {
      const { idea, project, detailLevel } = body;
      const projectName = project?.name || 'Personal';
      
      let stepGuide = "4 to 5 clear sequential steps";
      if (detailLevel === 'quick') stepGuide = "exactly 3 quick steps";
      if (detailLevel === 'micro') stepGuide = "6 to 8 micro-steps";

      const prompt = `You are Justin's ADHD executive assistant. Convert the following saved voice brainstorm idea into concrete actionable tasks for project "${projectName}" (${project?.goal || ''}).

Idea Summary: "${idea.summary}"
Original Transcript: "${idea.rawTranscript || idea.raw_transcript || ''}"
Granularity Mode: ${stepGuide}

Create 1 to 4 actionable tasks. For each task include:
- title: Clear action-verb title
- description: Brief context
- listName: "${projectName.includes('First Shift') ? 'First shift' : (projectName.includes('Football') ? 'Football' : 'Personal')}"
- estimatedMinutes: Realistic duration in minutes (5, 10, 15, 30)
- firstFiveMinutes: 1-sentence immediate physical action to start
- subtasks: Array of ${stepGuide}

Respond with ONLY valid JSON:
{
  "tasks": [
    {
      "title": "Action title",
      "description": "Context",
      "listName": "List Name",
      "estimatedMinutes": 15,
      "firstFiveMinutes": "First 5-minute starter action",
      "subtasks": ["Subtask 1", "Subtask 2"]
    }
  ]
}`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!geminiRes.ok) {
        const err = await geminiRes.text();
        return NextResponse.json({ error: `Gemini API error: ${err}` }, { status: 500 });
      }

      const geminiJson = await geminiRes.json();
      const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(rawText || '{"tasks":[]}');

      // Create each task in Supabase
      const createdTasks = [];
      for (const t of (parsed.tasks || [])) {
        const subtaskItems = (t.subtasks || []).map((step: string) => `- [ ] ${step}`).join('\n');
        const descParts = [
          `[⏱ ${t.estimatedMinutes || 15}m]`,
          `⚡ First 5 Minutes: ${t.firstFiveMinutes || ''}`,
          t.description || '',
          subtaskItems
        ].filter(Boolean);

        const payload = {
          title: t.title,
          description: descParts.join('\n'),
          list_name: t.listName || 'Personal',
          project_id: project?.id || null,
          status: 'pending',
          source: 'web_ai_promotion',
          created_at: new Date().toISOString()
        };

        const res = await supabaseFetch('/tasks', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const inserted = await res.json();
          createdTasks.push(inserted[0]);
        }
      }

      return NextResponse.json({ success: true, tasks: createdTasks });
    }

    // --- LEGACY GOOGLE SHEETS HANDLERS ---
    const doc = await getSheetDoc();
    if (doc) {
      const { rowNumber, newStatus, title } = body;
      if (action === 'delete_todo') {
        const sheet = doc.sheetsByTitle['Reminders'];
        if (sheet) {
          const rows = await sheet.getRows();
          const row = rows.find(r => r.rowNumber === rowNumber);
          if (row) {
            await row.delete();
            return NextResponse.json({ success: true });
          }
        }
      }
      if (action === 'delete_letterly') {
        const sheet = doc.sheetsByTitle['Letterly'];
        if (sheet) {
          const rows = await sheet.getRows();
          const row = rows.find(r => r.rowNumber === rowNumber);
          if (row) {
            await row.delete();
            return NextResponse.json({ success: true });
          }
        }
      }
      if (action === 'create_todo') {
        let sheet = doc.sheetsByTitle['Reminders'];
        if (!sheet) {
          sheet = await doc.addSheet({ title: 'Reminders', headerValues: ['ID', 'Title', 'Description', 'Due Date', 'Status'] });
        }
        await sheet.addRow({
          ID: 'web_' + Date.now(),
          Title: title,
          Description: '',
          'Due Date': '',
          Status: 'Pending'
        });
        return NextResponse.json({ success: true });
      }
      if (action === 'update_todo_status') {
        const sheet = doc.sheetsByTitle['Reminders'];
        if (sheet) {
          const rows = await sheet.getRows();
          const row = rows.find(r => r.rowNumber === rowNumber);
          if (row) {
            row.set('Status', newStatus);
            await row.save();
            return NextResponse.json({ success: true });
          }
        }
      }
    }

    return NextResponse.json({ error: "Action not recognized or handled" }, { status: 400 });
  } catch (e: any) {
    console.error("API POST error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
