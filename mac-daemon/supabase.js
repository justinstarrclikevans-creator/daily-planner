const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log("Supabase client initialized successfully.");
    } catch (err) {
        console.error("Failed to initialize Supabase client:", err.message);
    }
} else {
    // Graceful fallback when user hasn't added keys to .env yet
    console.log("Supabase credentials not configured in .env. Skipping Supabase cloud sync.");
}

let cachedProjects = null;
let lastProjectsFetch = 0;

async function getProjects() {
    if (!supabase) return [];
    const now = Date.now();
    if (cachedProjects && (now - lastProjectsFetch < 300000)) {
        return cachedProjects;
    }
    const { data, error } = await supabase.from('projects').select('*').order('name');
    if (error) {
        console.error("Error fetching projects from Supabase:", error.message);
        return cachedProjects || [];
    }
    cachedProjects = data || [];
    lastProjectsFetch = now;
    return cachedProjects;
}

async function syncTaskToSupabase(task, appleReminderId = null) {
    if (!supabase) return null;

    try {
        // Resolve project ID by list name if possible
        let projectId = null;
        if (task.listName) {
            const listLower = task.listName.toLowerCase();
            const projects = await getProjects();
            if (projects && projects.length > 0) {
                const matched = projects.find(p => listLower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(listLower));
                if (matched) projectId = matched.id;
            }
        }

        const rawDesc = task.description || '';
        
        // Extract Tiimo metadata from description if present
        let estimatedMinutes = task.estimated_minutes || task.estimatedMinutes || 5;
        const durMatch = rawDesc.match(/\[⏱\s*(\d+)m\]/);
        if (durMatch && durMatch[1]) {
            estimatedMinutes = parseInt(durMatch[1], 10);
        }

        const inPlayQueue = task.in_play_queue ?? (rawDesc.includes('[▶️ Queue]'));
        
        let firstFiveMinutes = task.first_five_minutes || task.firstFiveMinutes || null;
        if (!firstFiveMinutes) {
            const f5Match = rawDesc.match(/⚡ First 5 Minutes:\s*(.+)/i);
            if (f5Match && f5Match[1]) {
                firstFiveMinutes = f5Match[1].trim();
            }
        }

        let subtasks = task.subtasks || [];
        if (!subtasks || subtasks.length === 0) {
            const lines = rawDesc.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('- [ ] ')) {
                    subtasks.push({ title: trimmed.substring(6).trim(), isCompleted: false });
                } else if (trimmed.toLowerCase().startsWith('- [x] ')) {
                    subtasks.push({ title: trimmed.substring(6).trim(), isCompleted: true });
                }
            }
        }

        const baseTaskPayload = {
            title: task.title,
            description: rawDesc,
            list_name: task.listName || 'Personal',
            status: task.status === 'completed' ? 'completed' : 'pending',
            due_date: task.dueDate ? new Date(task.dueDate).toISOString() : null,
            source: task.source || 'daemon',
            apple_reminder_id: appleReminderId || task.id || null,
            project_id: projectId,
            updated_at: new Date().toISOString()
        };

        // Check if task already exists by apple_reminder_id or exact title
        let query = supabase.from('tasks').select('id');
        if (appleReminderId) {
            query = query.eq('apple_reminder_id', appleReminderId);
        } else {
            query = query.eq('title', task.title);
        }

        const { data: existing } = await query;

        if (existing && existing.length > 0) {
            const { data, error } = await supabase
                .from('tasks')
                .update(baseTaskPayload)
                .eq('id', existing[0].id)
                .select();
            if (error) console.error("Error updating task in Supabase:", error.message);
            return data ? data[0] : null;
        } else {
            const { data, error } = await supabase
                .from('tasks')
                .insert([baseTaskPayload])
                .select();
            if (error) console.error("Error inserting task into Supabase:", error.message);
            return data ? data[0] : null;
        }
    } catch (err) {
        console.error("Exception syncing task to Supabase:", err.message);
        return null;
    }
}

async function getRoutines() {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase.from('routines').select('*').order('title');
        if (error) {
            console.error("Error fetching routines:", error.message);
            return [];
        }
        return data || [];
    } catch (e) {
        return [];
    }
}

async function markTaskCompletedInSupabase(appleReminderId) {
    if (!supabase || !appleReminderId) return false;
    const { error } = await supabase
        .from('tasks')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('apple_reminder_id', appleReminderId);

    if (error) {
        console.error("Error marking task completed in Supabase:", error.message);
        return false;
    }
    return true;
}

module.exports = {
    supabase,
    getProjects,
    getRoutines,
    syncTaskToSupabase,
    markTaskCompletedInSupabase
};
