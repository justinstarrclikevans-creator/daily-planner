const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

async function extractTodos(slackMessages, emails, events) {
    if (!process.env.GEMINI_API_KEY) {
        console.error("No Gemini API key found for extraction.");
        return [];
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const prompt = `
    You are an intelligent assistant. Review the following Slack messages, unread emails, and today's calendar events.
    Extract ANY actionable TODO items or tasks.
    
    Rules:
    - Output MUST be a raw JSON array of objects.
    - Schema: [{ "title": "Task title", "description": "Context/Details", "source": "slack" | "email" | "calendar" }]
    - Do not include markdown like \`\`\`json. Just raw JSON string.

    Slack Messages:
    ${JSON.stringify(slackMessages)}

    Unread Emails:
    ${JSON.stringify(emails)}

    Calendar Events:
    ${JSON.stringify(events)}
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
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
        return [];
    }
}

module.exports = { extractTodos };
