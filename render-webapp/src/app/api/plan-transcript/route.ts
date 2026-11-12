import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Missing GEMINI_API_KEY environment variable on the server.' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const {
      transcript = '',
      mode = 'plan_day',
      projects = [],
      tasks = [],
      calendarEvents = [],
      currentTimeIso = new Date().toISOString(),
    } = body;

    if (mode === 'plan_day' && !String(transcript).trim()) {
      return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
    }

    const compactProjects = (projects || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      instructions: p.instructions || p.goal || '',
    }));

    const compactTasks = (tasks || [])
      .filter((t: any) => t.status !== 'completed')
      .map((t: any) => ({
        id: t.id,
        title: t.title,
        projectId: t.projectId || null,
        estimatedMinutes: t.estimatedMinutes || 15,
        dueDate: t.dueDate || null,
      }));

    const compactCalendar = (calendarEvents || []).map((ev: any) => ({
      title: ev.title,
      start: ev.start,
      end: ev.end,
      durationMinutes: ev.durationMinutes || 30,
    }));

    const prompt =
      mode === 'classify_only'
        ? `You are an executive assistant organizing tasks into user-defined projects using their classification instructions.

Projects & Instructions:
${JSON.stringify(compactProjects, null, 2)}

Unassigned Open Tasks (currently in General):
${JSON.stringify(compactTasks.filter((t: any) => !t.projectId), null, 2)}

Rules:
- Only assign a task to a project if it clearly matches that project's name or instructions.
- If a task does not clearly match any project, omit it so it stays in General.
- Do NOT invent hashtags or tags.

Respond with ONLY valid JSON:
{
  "summary": "Brief summary of how many tasks were classified",
  "newProjects": [],
  "taskUpdates": [
    { "taskId": "id", "projectName": "Exact Project Name" }
  ],
  "newTasks": []
}`
        : `You are an ADHD executive assistant turning Justin's pasted voice transcript into a concrete daily schedule and project-organized task list.

Current Local Reference ISO Time: ${currentTimeIso}

Existing Projects & Classification Instructions:
${JSON.stringify(compactProjects, null, 2)}

Today's Fixed Calendar Appointments (do NOT double-book over these unless Justin explicitly asks to):
${JSON.stringify(compactCalendar, null, 2)}

Open Tasks:
${JSON.stringify(compactTasks, null, 2)}

Pasted Voice Transcript:
"""
${transcript}
"""

Instructions:
1. If Justin names any NEW project in the transcript that does not exist yet, include it in "newProjects" with optional classification "instructions".
2. Match tasks mentioned in the transcript (or matching project instructions) to their project via "projectName", and time-block them into realistic 15-minute (or 5-minute) slots in ISO-8601 format around today's calendar appointments.
3. If Justin says an appointment ran over or a scheduled task was missed / needs to be moved back to the open list, set "dueDate": null for that task in "taskUpdates" (and reschedule later tasks if requested).
4. If Justin mentions brand-new action items not yet in Open Tasks, add them to "newTasks" (clean title, no #hashtags, no exclamation points).
5. Only update tasks that are relevant to the transcript or project instructions.

Respond with ONLY valid JSON:
{
  "summary": "1-2 sentence summary of the schedule & changes",
  "newProjects": [
    { "name": "Project Name", "instructions": "Classification rule if mentioned" }
  ],
  "taskUpdates": [
    {
      "taskId": "existing-task-id",
      "projectName": "General or Project Name",
      "dueDate": "2026-11-12T15:00:00.000Z or null",
      "estimatedMinutes": 30
    }
  ],
  "newTasks": [
    {
      "title": "Clean action title",
      "projectName": "General or Project Name",
      "dueDate": "2026-11-12T16:00:00.000Z or null",
      "estimatedMinutes": 15
    }
  ]
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return NextResponse.json({ error: `Gemini API error: ${errText}` }, { status: 500 });
    }

    const geminiJson = await geminiRes.json();
    const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(rawText || '{}');

    return NextResponse.json({
      success: true,
      summary: parsed.summary || 'Updated plan from transcript.',
      newProjects: Array.isArray(parsed.newProjects) ? parsed.newProjects : [],
      taskUpdates: Array.isArray(parsed.taskUpdates) ? parsed.taskUpdates : [],
      newTasks: Array.isArray(parsed.newTasks) ? parsed.newTasks : [],
    });
  } catch (e: any) {
    console.error('Error in /api/plan-transcript:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
