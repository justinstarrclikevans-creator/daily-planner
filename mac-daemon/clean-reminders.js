const { getIncompleteReminders, updateReminderNotes } = require('./reminders');

async function run() {
    const reminders = await getIncompleteReminders();
    const toClean = reminders.filter(r => r.description && (r.description.includes('⚡ First 5 Minutes:') || r.description.includes('Estimated time:')));
    console.log(`Found ${toClean.length} tasks to clean...`);
    
    // Process in chunks of 20
    for (let i = 0; i < toClean.length; i += 20) {
        const chunk = toClean.slice(i, i + 20);
        await Promise.all(chunk.map(async task => {
            // Overwriting with empty string to remove the AI notes
            await updateReminderNotes(task.id, "");
            console.log(`Cleaned notes for: ${task.title}`);
        }));
    }
    console.log("All done cleaning!");
}
run();
