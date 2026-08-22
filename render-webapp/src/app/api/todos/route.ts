import { NextRequest, NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

async function getSheetDoc() {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
        throw new Error("Missing Google Sheets credentials in .env");
    }

    const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
    // Strip surrounding quotes if the user accidentally copied them from the .env file
    let sanitizedKey = rawKey;
    if (sanitizedKey.startsWith('"') && sanitizedKey.endsWith('"')) {
        sanitizedKey = sanitizedKey.slice(1, -1);
    } else if (sanitizedKey.startsWith("'") && sanitizedKey.endsWith("'")) {
        sanitizedKey = sanitizedKey.slice(1, -1);
    }
    
    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: sanitizedKey.replace(/\\n/g, '\n'),
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
        ],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo(); 
    return doc;
}

export async function GET() {
    try {
        const doc = await getSheetDoc();
        
        let remindersSheet = doc.sheetsByTitle['Reminders'];
        let letterlySheet = doc.sheetsByTitle['Letterly'];
        
        const reminders: any[] = [];
        if (remindersSheet) {
            const rows = await remindersSheet.getRows();
            rows.forEach(row => {
                reminders.push({
                    rowNumber: row.rowNumber,
                    id: row.get('ID'),
                    title: row.get('Title'),
                    description: row.get('Description'),
                    dueDate: row.get('Due Date'),
                    status: row.get('Status')
                });
            });
        }

        const letterly: any[] = [];
        if (letterlySheet) {
            const rows = await letterlySheet.getRows();
            rows.forEach(row => {
                letterly.push({
                    id: row.get('ID'),
                    timestamp: row.get('Timestamp'),
                    original: row.get('Original Text'),
                    summary: row.get('Summary')
                });
            });
        }
        
        let dailySummary = null;
        let dailySummarySheet = doc.sheetsByTitle['DailySummary'];
        if (dailySummarySheet) {
            const rows = await dailySummarySheet.getRows();
            if (rows.length > 0) {
                // Get the most recent one (last row)
                const lastRow = rows[rows.length - 1];
                dailySummary = {
                    date: lastRow.get('Date'),
                    summary: lastRow.get('Summary')
                };
            }
        }

        return NextResponse.json({ reminders, letterly, dailySummary });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, rowNumber, newStatus, title } = body;
        const doc = await getSheetDoc();
        
        if (action === 'delete_todo') {
            const sheet = doc.sheetsByTitle['Reminders'];
            if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
            
            const rows = await sheet.getRows();
            const row = rows.find(r => r.rowNumber === rowNumber);
            
            if (row) {
                await row.delete();
                return NextResponse.json({ success: true });
            }
            return NextResponse.json({ error: "Row not found" }, { status: 404 });
        }
        
        if (action === 'create_todo') {
            let sheet = doc.sheetsByTitle['Reminders'];
            if (!sheet) {
                sheet = await doc.addSheet({ title: 'Reminders', headerValues: ['ID', 'Title', 'Description', 'Due Date', 'Status'] });
            }
            await sheet.addRow({
                ID: 'web_' + Date.now(),
                Title: title,
                Description: '',
                'Due Date': '',
                Status: 'Pending'
            });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
