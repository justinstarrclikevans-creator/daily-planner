import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import {
  cleanTaskTitle,
  extractHashtags,
  extractSubtasks,
  Task,
  TaskPriority,
  SunsamaChannel,
} from '@/lib/supabase';

let inMemoryCustomChannels: SunsamaChannel[] | null = null;
let lastChannelsFetch = 0;

let inMemorySheetTasks: Task[] | null = null;
let lastSheetTasksFetch = 0;

export async function getSheetDoc() {
  if (
    !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !process.env.GOOGLE_PRIVATE_KEY ||
    !process.env.GOOGLE_SHEET_ID
  ) {
    return null;
  }

  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  let sanitizedKey = rawKey.trim();
  if (
    (sanitizedKey.startsWith('"') && sanitizedKey.endsWith('"')) ||
    (sanitizedKey.startsWith("'") && sanitizedKey.endsWith("'"))
  ) {
    sanitizedKey = sanitizedKey.slice(1, -1);
  }
  sanitizedKey = sanitizedKey.replace(/\\n/g, '\n');

  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: sanitizedKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

export async function fetchCustomChannelsFromSheet(): Promise<SunsamaChannel[]> {
  const now = Date.now();
  if (inMemoryCustomChannels && now - lastChannelsFetch < 15000) {
    return inMemoryCustomChannels;
  }

  try {
    const doc = await getSheetDoc();
    if (!doc) return inMemoryCustomChannels || [];

    const settingsSheet = doc.sheetsByTitle['Settings'];
    if (settingsSheet) {
      const rows = await settingsSheet.getRows();
      const row = rows.find((r) => r.get('Key') === 'custom_channels');
      if (row && row.get('Value')) {
        const parsed = JSON.parse(row.get('Value'));
        if (Array.isArray(parsed)) {
          inMemoryCustomChannels = parsed;
          lastChannelsFetch = now;
          return inMemoryCustomChannels;
        }
      }
    }
  } catch (err) {
    console.warn('Error reading custom channels from Google Sheets:', err);
  }

  return inMemoryCustomChannels || [];
}

export async function saveCustomChannelsToSheet(channels: SunsamaChannel[]): Promise<boolean> {
  inMemoryCustomChannels = channels;
  lastChannelsFetch = Date.now();

  try {
    const doc = await getSheetDoc();
    if (!doc) return false;

    let settingsSheet = doc.sheetsByTitle['Settings'];
    if (!settingsSheet) {
      settingsSheet = await doc.addSheet({
        title: 'Settings',
        headerValues: ['Key', 'Value'],
      });
    }

    const rows = await settingsSheet.getRows();
    const row = rows.find((r) => r.get('Key') === 'custom_channels');
    const serialized = JSON.stringify(channels);

    if (row) {
      row.set('Value', serialized);
      await row.save();
    } else {
      await settingsSheet.addRow({ Key: 'custom_channels', Value: serialized });
    }
    return true;
  } catch (err) {
    console.warn('Error saving custom channels to Google Sheets:', err);
    return false;
  }
}

export async function enqueueCompletedInGoogleSheets(item: {
  id: string;
  appleReminderId?: string | null;
  title?: string;
}) {
  try {
    const doc = await getSheetDoc();
    if (!doc) return;

    let settingsSheet = doc.sheetsByTitle['Settings'];
    if (!settingsSheet) {
      settingsSheet = await doc.addSheet({
        title: 'Settings',
        headerValues: ['Key', 'Value'],
      });
    }

    const rows = await settingsSheet.getRows();
    const qRow = rows.find((r) => r.get('Key') === 'web_completed_queue');
    let queue: any[] = [];
    if (qRow && qRow.get('Value')) {
      try {
        const parsed = JSON.parse(qRow.get('Value'));
        if (Array.isArray(parsed)) queue = parsed;
      } catch {}
    }

    queue.push({
      id: item.id,
      appleReminderId: item.appleReminderId || item.id,
      title: item.title || '',
      completedAt: new Date().toISOString(),
    });

    const serialized = JSON.stringify(queue.slice(-200));
    if (qRow) {
      qRow.set('Value', serialized);
      await qRow.save();
    } else {
      await settingsSheet.addRow({ Key: 'web_completed_queue', Value: serialized });
    }
  } catch (err) {
    console.warn('Failed to enqueue completion in Google Sheets:', err);
  }
}

export async function fetchActiveRemindersFromSheet(): Promise<Task[]> {
  const now = Date.now();
  if (inMemorySheetTasks && now - lastSheetTasksFetch < 15000) {
    return inMemorySheetTasks;
  }

  try {
    const doc = await getSheetDoc();
    if (!doc) return inMemorySheetTasks || [];

    const settingsSheet = doc.sheetsByTitle['Settings'];
    if (settingsSheet) {
      const rows = await settingsSheet.getRows();
      const payloadRow = rows.find((r) => r.get('Key') === 'active_reminders_payload');
      if (payloadRow && payloadRow.get('Value')) {
        try {
          const parsed = JSON.parse(payloadRow.get('Value'));
          if (Array.isArray(parsed) && parsed.length > 0) {
            const tasks: Task[] = parsed
              .filter((item: any) => !(item.description || item.notes || '').includes('[Calendar Event]'))
              .map((item: any, idx: number) => {
                const desc = item.description || item.notes || '';
                let subs = item.subtasks;
                if (!subs || !Array.isArray(subs) || subs.length === 0) {
                  subs = extractSubtasks(desc);
                }

                let estMins = item.estimatedMinutes || item.estimated_minutes || 15;
                const durMatch = desc.match(/\[⏱\s*(\d+)m\]/);
                if (durMatch && durMatch[1]) {
                  estMins = parseInt(durMatch[1], 10);
                }

                let prio: TaskPriority = 'medium';
                if (item.priority === 'high' || item.priority === 'low') {
                  prio = item.priority;
                } else if (desc.toLowerCase().includes('[🔥 high]')) {
                  prio = 'high';
                } else if (desc.toLowerCase().includes('[🌱 low]')) {
                  prio = 'low';
                }

                const extractedTags = Array.from(
                  new Set([
                    ...(Array.isArray(item.tags) ? item.tags : []),
                    ...extractHashtags(item.title),
                    ...extractHashtags(desc),
                  ])
                );

                const taskStatus: 'pending' | 'completed' =
                  (item.status === 'completed' || item.isCompleted) ? 'completed' : 'pending';

                return {
                  id: item.id || item.appleReminderId || `sheet-${idx}`,
                  projectId: item.projectId || null,
                  title: cleanTaskTitle(item.title),
                  description: desc,
                  listName: item.listName || 'General',
                  status: taskStatus,
                  dueDate: item.dueDate || null,
                  source: 'apple_reminders',
                  appleReminderId: item.appleReminderId || item.id,
                  estimatedMinutes: estMins,
                  actualSeconds: item.actualSeconds || 0,
                  priority: prio,
                  inPlayQueue: Boolean(item.inPlayQueue),
                  subtasks: subs,
                  tags: extractedTags,
                  createdAt: item.createdAt || new Date().toISOString(),
                  completedAt: item.completedAt || null,
                };
              })
              .filter((t) => t.status !== 'completed');

            inMemorySheetTasks = tasks;
            lastSheetTasksFetch = now;
            return tasks;
          }
        } catch (e) {
          console.warn('Error parsing active_reminders_payload:', e);
        }
      }
    }
  } catch (err) {
    console.warn('Error reading active reminders from Google Sheets:', err);
  }

  return inMemorySheetTasks || [];
}
