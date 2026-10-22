const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config();

async function run() {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `
    You are Justin Evans, a program director or executive. Write a professional and glowing letter of recommendation for Daisy, who is applying to law school.
    
    Use the following real insights/context about Daisy from our company Slack to highlight her hard work, determination, and competence:
    - She recently took over the demanding "Reentry Navigator" role to streamline the intake and screening process, proving her ability to handle complex operational processes.
    - She is so skilled with our database (Apricot) that the team affectionately calls her "Data Daisy". 
    - A team member explicitly said: "we appreciate you holding our hand and guiding us through Apricot....Data Daisy", and another said "10/10 on that Apricot support in house".
    - She is a highly communicative problem-solver who takes initiative to create new processes that alleviate pressure on the whole team.
    - She manages complex data reporting (enrollments, exits, OSHA tracking) and compiles vast amounts of resources for our program.
    
    The letter must be professional, formal, formatted as a letter, and suitable for a law school admissions committee.
    Do NOT include markdown like \`\`\`html.
    Output the letter in RAW, clean HTML (using <p>, <br>, <strong>, etc.) so I can convert it to a docx file.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: prompt
        });
        
        let html = response.text.trim();
        if (html.startsWith('\`\`\`html')) html = html.replace(/^\`\`\`html\n?/, '').replace(/\n?\`\`\`$/, '');
        else if (html.startsWith('\`\`\`')) html = html.replace(/^\`\`\`\n?/, '').replace(/\n?\`\`\`$/, '');
        
        fs.writeFileSync('Daisy_Recommendation_Letter.html', html);
        
        // Convert to DOCX using macOS textutil
        execSync('textutil -convert docx Daisy_Recommendation_Letter.html');
        console.log("Successfully generated Daisy_Recommendation_Letter.docx");
        
    } catch (e) {
        console.error(e);
    }
}
run();
