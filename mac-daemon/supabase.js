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

async function getProjects() {
    if (!supabase) return [];
    const { data, error } = await supabase.from('projects').select('*').order('name');
    if (error) {
        console.error("Error fetching projects from Supabase:", error.message);
        return [];
    }
    return data || [];
}

async function syncTaskToSupabase(task, appleReminderId = null) {
    if (!supabase) return null;

    try {
        // Resolve project ID by list name if possible
        let projectId = null;
        if (task.listName) {
            const listLower = task.listName.toLowerCase();
            const { data: projects } = await supabase.from('projects').select('id, name');
            if (projects && projects.length > 0) {
                const matched = projects.find(p => listLower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(listLower));
                if (matched) projectId = matched.id;
            }
        }

        const taskPayload = {
            title: task.title,
            description: task.description || '',
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
                .update(taskPayload)
                .eq('id', existing[0].id)
                .select();
            if (error) console.error("Error updating task in Supabase:", error.message);
            return data ? data[0] : null;
        } else {
            const { data, error } = await supabase
                .from('tasks')
                .insert([taskPayload])
                .select();
            if (error) console.error("Error inserting task into Supabase:", error.message);
            return data ? data[0] : null;
        }
    } catch (err) {
        console.error("Exception syncing task to Supabase:", err.message);
        return null;
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
    syncTaskToSupabase,
    markTaskCompletedInSupabase
};
