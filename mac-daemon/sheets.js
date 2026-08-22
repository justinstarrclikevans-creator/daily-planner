const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
require('dotenv').config();

async function getSheetDoc() {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
        throw new Error("Missing Google Sheets credentials in .env");
    }

    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
        ],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo(); 
    return doc;
}

async function addTodosToSheet(todos) {
    if (!todos || todos.length === 0) return;
    const doc = await getSheetDoc();
    
    // We expect a sheet named "Reminders" to exist
    let sheet = doc.sheetsByTitle['Reminders'];
    if (!sheet) {
        sheet = await doc.addSheet({ title: 'Reminders', headerValues: ['ID', 'Title', 'Description', 'Due Date', 'Status'] });
    }

    const rows = todos.map(todo => ({
        ID: todo.id,
        Title: todo.name,
        Description: todo.body,
        'Due Date': todo.dueDate,
        Status: 'Pending'
    }));

    await sheet.addRows(rows);
}

async function addLetterlySummariesToSheet(notes) {
    if (!notes || notes.length === 0) return;
    const doc = await getSheetDoc();
    
    // We expect a sheet named "Letterly"
    let sheet = doc.sheetsByTitle['Letterly'];
    if (!sheet) {
        sheet = await doc.addSheet({ title: 'Letterly', headerValues: ['ID', 'Timestamp', 'Original Text', 'Summary'] });
    }

    const rows = notes.map(note => ({
        ID: note.id,
        Timestamp: new Date(note.timestamp).toLocaleString(),
        'Original Text': note.transcription,
        Summary: note.summary
    }));

    await sheet.addRows(rows);
}

async function addDailySummaryToSheet(summaryText) {
    if (!summaryText) return;
    const doc = await getSheetDoc();
    
    let sheet = doc.sheetsByTitle['DailySummary'];
    if (!sheet) {
        sheet = await doc.addSheet({ title: 'DailySummary', headerValues: ['Date', 'Summary'] });
    }

    await sheet.addRows([
        { Date: new Date().toLocaleDateString(), Summary: summaryText }
    ]);
}

async function getAllPendingTodos() {
    const doc = await getSheetDoc();
    const sheet = doc.sheetsByTitle['Reminders'];
    if (!sheet) return [];
    
    const rows = await sheet.getRows();
    return rows.filter(r => r.get('Status') === 'Pending').map(r => ({
        id: r.get('ID'),
        title: r.get('Title'),
        description: r.get('Description'),
        dueDate: r.get('Due Date')
    }));
}

module.exports = {
    addTodosToSheet,
    addLetterlySummariesToSheet,
    addDailySummaryToSheet,
    getAllPendingTodos
};
