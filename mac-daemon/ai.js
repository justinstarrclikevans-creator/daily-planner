const { GoogleGenAI } = require('@google/genai');
const { callGeminiWithRetry } = require('./gemini-helper');
require('dotenv').config();

async function extractTodos(slackMessages, emails, events, existingTodos = [], iMessages = [], appleReminders = []) {
    if (!process.env.GEMINI_API_KEY) {
        console.error("No Gemini API key found for extraction.");
        return [];
    }
    
    const prompt = `
    You are an intelligent executive assistant for Justin Evans.
    Justin's Slack User ID is U02AGGN2E1Z (username: jevans).
    
    Review the following Slack messages (including Huddle notes & team huddle transcripts), unread emails, today's calendar events, and recent iMessages/texts.
    Extract actionable TODO items specifically assigned to or required by Justin.
    
    CRITICAL HUDDLE & SLACK RULES:
    1. In Slack Huddle notes and Action Items:
       - ONLY extract action items that are explicitly assigned to Justin (@U02AGGN2E1Z, @jevans, or Justin).
       - Do NOT extract tasks assigned to other team members (e.g. tasks starting with '@U0AL7RCBKCG to...', '@U03P4PK3E4U to...', '@U08PDJ1Q8AC will...' belong to colleagues—ignore them).
       - If a colleague is instructed to provide feedback or send reports TO Justin, that is the colleague's task, NOT Justin's task.
    2. In regular Slack messages / DMs / channels:
       - Extract direct asks, requests for review, commitments Justin made, or questions that require Justin's action.
       - Ignore passive commentary, casual banter, or general team announcements.

    LIST MAPPING GUIDELINES (Use Justin's exact Apple Reminders list names):
    - "First Shift": Turn Ninety work, First Shift operations, participant casework, Apricot, curricula, staffing, reentry navigation, or staff huddles. (If specifically reentry navigation casework, you can also use "Reentry Nav").
    - "Football": Youth football, 843 Athletic Club, coaching drills, practice slots, or sports sponsorships. (Or "843").
    - "Personal": Household tasks, personal appointments, family, personal bills, or personal errands.

    RULES & SCHEMA:
    - Output MUST be a raw JSON array of objects.
    - Schema: [{ "title": "Clear action-verb task title", "description": "Brief context and source reference", "source": "slack" | "email" | "calendar" | "imessage", "listName": "First Shift" | "Football" | "Personal" | "Reentry Nav", "estimatedMinutes": 5 }]
    - Note on duration: Default to 5 minutes for tasks unless explicitly stated otherwise.
    - Do not include markdown like \`\`\`json. Just raw JSON string.
    - CRITICAL: Do NOT extract any tasks that are similar or identical to the "Existing Pending Todos" provided below. We want to avoid duplicates.
    - CRITICAL PRIORITY FOR EMAILS: Prioritize direct human communication, forwarded requests, or bills.
    - STRICT EXCLUSION: Do NOT flag marketing emails, mass newsletters, promotional content, automated alerts, or spam as tasks.

    Existing Pending Todos (Do not extract these):
    ${JSON.stringify(existingTodos)}

    iMessages:
    ${JSON.stringify(iMessages)}

    Apple Reminders (just pulled):
    ${JSON.stringify(appleReminders)}

    Slack Messages:
    ${JSON.stringify(slackMessages)}

    Unread Emails:
    ${JSON.stringify(emails)}

    Calendar Events:
    ${JSON.stringify(events)}
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.5-flash',
            contents: prompt,
            config: {
                temperature: 0.2
            }
        });

        let text = response.text;
        if (text.startsWith('\`\`\`json')) {
            text = text.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '');
        } else if (text.startsWith('\`\`\`')) {
            text = text.replace(/^\`\`\`\n?/, '').replace(/\n?\`\`\`$/, '');
        }

        return JSON.parse(text);
    } catch (error) {
        console.error("AI Extraction Error:", error);
        throw error;
    }
}

async function generateDailySummary(events, todos) {
    if (!process.env.GEMINI_API_KEY) {
        console.error("No Gemini API key found for summary.");
        return null;
    }
    
    const prompt = `
    You are an intelligent daily planner assistant. It is 6 AM.
    Review my calendar events for today and my current pending todos.
    Write a brief, encouraging, and highly actionable "State of the Union" style summary for my day.
    Point out what calendar events I have, and suggest what else I could realistically get done today from my pending todos.
    
    Keep it concise and readable (markdown allowed).
    
    Calendar Events Today:
    ${JSON.stringify(events, null, 2)}
    
    Current Pending Todos:
    ${JSON.stringify(todos, null, 2)}
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.5-flash',
            contents: prompt,
            config: {
                temperature: 0.5
            }
        });

        return response.text.trim();
    } catch (error) {
        console.error("AI Daily Summary Error:", error);
        throw error;
    }
}

async function getMostImportantTask(tasks) {
    if (!process.env.GEMINI_API_KEY || tasks.length === 0) return null;
    
    // Map tasks to simple numbered format to avoid Gemini hallucinating long base64 IDs
    const numberedTasks = tasks.map((t, index) => {
        let taskData = {
            index: index,
            title: t.title,
            listName: t.listName,
            description: t.description
        };
        if (t.dueDate) {
            taskData.dueDate = t.dueDate;
        }
        return taskData;
    });
    
    const prompt = `
    You are an intelligent executive assistant for a user with ADHD. The user has requested a single, highly actionable task to focus on right now.
    Look at their current open tasks across all lists. 
    
    You MUST prioritize using the following rules in this exact order:
    1. Due Dates: Any tasks that are past due or have impending/upcoming due dates today must be bumped to the absolute top.
    2. List Priority: "First shift" is the absolute top priority list. "Personal" is the second priority list. "Football" (or 843) is the third priority.
    
    Select the single most important task for them to do next based on these rules. Do not pick anything vague; pick something concrete.
    
    Return ONLY a raw JSON object containing the index of the chosen task. Do not include markdown.
    Schema: { "index": number }
    
    Current Tasks:
    ${JSON.stringify(numberedTasks, null, 2)}
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.5-flash',
            contents: prompt,
            config: { temperature: 0.1 }
        });
        
        let text = response.text.trim();
        if (text.startsWith('\`\`\`json')) text = text.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '');
        else if (text.startsWith('\`\`\`')) text = text.replace(/^\`\`\`\n?/, '').replace(/\n?\`\`\`$/, '');
        
        const result = JSON.parse(text);
        if (result && typeof result.index === 'number' && tasks[result.index]) {
            return tasks[result.index];
        }
        return tasks[0]; // fallback to first task if it fails
    } catch (e) {
        console.error("AI Most Important Task Error:", e);
        return tasks[0]; // fallback
    }
}

async function getMeetingRelatedTasks(event, tasks) {
    if (!process.env.GEMINI_API_KEY || tasks.length === 0) return [];
    
    // Map tasks to simple numbered format to avoid Gemini hallucinating long base64 IDs
    const numberedTasks = tasks.map((t, index) => ({
        index: index,
        title: t.title,
        listName: t.listName,
        description: t.description
    }));
    
    const prompt = `
    You are an intelligent assistant. The user has a meeting starting soon.
    Look at the meeting details and the user's open tasks.
    Are there any open tasks that are directly relevant to this meeting (e.g. asking a specific person a question, reviewing a document for this project)?
    
    Return a raw JSON array of the INDICES of the relevant tasks. If none are relevant, return an empty array [].
    Do not include markdown. Example: [0, 5, 12]
    
    Meeting Details:
    ${JSON.stringify(event, null, 2)}
    
    Open Tasks:
    ${JSON.stringify(numberedTasks, null, 2)}
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.5-flash',
            contents: prompt,
            config: { temperature: 0.1 }
        });
        
        let text = response.text.trim();
        if (text.startsWith('\`\`\`json')) text = text.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '');
        else if (text.startsWith('\`\`\`')) text = text.replace(/^\`\`\`\n?/, '').replace(/\n?\`\`\`$/, '');
        
        const indices = JSON.parse(text);
        if (Array.isArray(indices)) {
            return indices.map(i => tasks[i]).filter(t => t);
        }
        return [];
    } catch (e) {
        console.error("AI Meeting Related Tasks Error:", e);
        return [];
    }
}

async function generateADHDProcess(title, description) {
    if (!process.env.GEMINI_API_KEY) return description || "";
    
    const prompt = `
    You are an expert ADHD coach. Your client struggles with executive dysfunction and task paralysis.
    They need to start this task: "${title}"
    Original Context: "${description || "No context provided"}"

    (Note: If the Original Context contains generic step-by-step instructions or "Estimated time:", completely ignore them. They are old automated junk).

    DO NOT provide generic, robotic steps (e.g. "open computer", "log in"). DO NOT pretend to know their proprietary business processes.
    Instead, focus ENTIRELY on overcoming the initiation barrier.

    Provide a very short, conversational instruction on the absolute smallest, lowest-effort physical action they can take right now just to break the paralysis and start building momentum.
    If you lack context, just give them a micro-action to GET context (e.g., "Just text John and ask what he needs for this").

    Format your response EXACTLY like this:
    ⚡ First 5 Minutes: [Your 1-2 sentence momentum action]
    `;

    try {
        const response = await callGeminiWithRetry({
            model: 'gemini-3.5-flash',
            contents: prompt,
            config: { temperature: 0.2 }
        });
        return response.text.trim();
    } catch (e) {
        console.error("AI ADHD Process Error:", e);
        return description || "";
    }
}

module.exports = { extractTodos, generateDailySummary, getMostImportantTask, getMeetingRelatedTasks, generateADHDProcess };
