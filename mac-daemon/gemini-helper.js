const { GoogleGenAI } = require('@google/genai');

const FALLBACK_MODELS = [
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-flash-latest'
];

async function callGeminiWithRetry(options, retries = 3) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Determine model list starting with the requested model or default
    const primaryModel = options.model || 'gemini-3.5-flash';
    const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];
    
    let lastError = null;
    for (const model of modelsToTry) {
        let attempt = 0;
        while (attempt < retries) {
            try {
                return await ai.models.generateContent({
                    ...options,
                    model: model
                });
            } catch (error) {
                attempt++;
                lastError = error;
                console.error(`Gemini Error (${model}, attempt ${attempt}/${retries}):`, error.message || error);
                
                // If 503 (high demand) or 429, try next attempt with backoff
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
                }
            }
        }
        // Try fallback model
        console.log(`Switching to fallback model after exhausting retries on ${model}...`);
    }
    
    throw lastError;
}

module.exports = { callGeminiWithRetry };
