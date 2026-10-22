const { getIncompleteReminders, updateReminderNotes } = require('./reminders');
const { generateADHDProcess } = require('./ai');

async function run() {
    const reminders = await getIncompleteReminders();
    const toExpand = reminders.filter(r => !r.description || !r.description.includes('⚡ First 5 Minutes:'));
    console.log(`Found ${toExpand.length} tasks to rewrite...`);
    
    // Process in chunks of 20 to avoid overwhelming eventkit/gemini
    for (let i = 0; i < toExpand.length; i += 20) {
        const chunk = toExpand.slice(i, i + 20);
        await Promise.all(chunk.map(async task => {
            const process = await generateADHDProcess(task.title, task.description);
            if (process && process.includes('⚡ First 5 Minutes:')) {
                await updateReminderNotes(task.id, process);
                console.log(`Updated: ${task.title}`);
            }
        }));
    }
    console.log("All done!");
}
run();
