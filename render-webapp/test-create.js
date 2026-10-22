require('dotenv').config({ path: '/Users/justinevans/Desktop/ToDo App/render-webapp/.env' });
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

async function test() {
    let sanitizedKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const auth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: sanitizedKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle['Reminders'];
    console.log("Found sheet:", !!sheet);
    await sheet.addRow({
        ID: 'web_' + Date.now(),
        Title: 'Test Todo',
        Description: '',
        'Due Date': '',
        Status: 'Pending'
    });
    console.log("Added row!");
}
test();
