const Realm = require('realm');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

function expandHomeDir(filePath) {
    if (filePath.startsWith('~/')) {
        return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
}

const realmPath = expandHomeDir('~/Library/Containers/ai.draft.DraftAI/Data/Library/Application Support/default.realm');

async function getRecentLetterlyNotes() {
    if (!fs.existsSync(realmPath)) {
        console.error("Letterly Realm database not found at", realmPath);
        return [];
    }

    let realm;
    try {
        realm = await Realm.open({
            path: realmPath,
            readOnly: true
        });

        // Get notes from the last hour
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const notes = realm.objects('Note')
            .filtered('timestampMs >= $0', oneHourAgo)
            .sorted('timestampMs', true);
        
        const recentNotes = notes.map(note => ({
            id: note._id ? note._id.toString() : (note.id || 'unknown'),
            transcription: note.transcription || '',
            timestamp: note.timestampMs || 0
        }));

        realm.close();
        return recentNotes;
    } catch (e) {
        console.error("Failed to read Letterly database:", e);
        if (realm && !realm.isClosed) {
            realm.close();
        }
        return [];
    }
}

async function summarizeNotes(notes) {
    if (!notes || notes.length === 0) return [];

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    if (!process.env.GEMINI_API_KEY) {
        console.error("No Gemini API key found.");
        return notes; // Return unsummarized if no key
    }

    const summaries = [];
    for (const note of notes) {
        try {
            const prompt = `
            Summarize the following voice note transcription into a clear, detailed summary. 
            Extract any key action items or important points.
            Do not output JSON, just plain text markdown.
            
            Transcription:
            "${note.transcription}"
            `;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });

            summaries.push({
                ...note,
                summary: response.text
            });
        } catch (e) {
            console.error("Failed to summarize note", e);
            summaries.push({ ...note, summary: note.transcription });
        }
    }
    
    return summaries;
}

module.exports = {
    getRecentLetterlyNotes,
    summarizeNotes
};
