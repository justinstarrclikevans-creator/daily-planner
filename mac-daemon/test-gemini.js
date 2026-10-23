require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function run() {
    const apiKey = process.env.GEMINI_API_KEY || Buffer.from("QVEuQWI4Uk42SVhCUU85RUc5RE1BV2NDa282M19nWFh5b2lNZmNxcE9Ka21jeWNPWVF6WkE=", "base64").toString("utf-8");
    const ai = new GoogleGenAI({ apiKey });
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
