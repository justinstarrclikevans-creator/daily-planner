const { GoogleGenAI } = require('@google/genai');

async function run() {
    const ai = new GoogleGenAI({ apiKey: "AQ.Ab8RN6IcCg0ZHzgemvtrQ-8oyseoCX5QSMOxKBT_aCyMXrHd6w" });
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: 'Hello'
        });
        console.log("Success:", response.text);
    } catch (e) {
        console.error("Error:", e.message);
    }
}
run();
