const fs = require('fs');
const content = fs.readFileSync('/Users/justinevans/Desktop/ToDo App/render-webapp/src/app/api/todos/route.ts', 'utf8');

let newContent = content.replace(
    `        let dailySummary = null;`,
    `        let settingsSheet = doc.sheetsByTitle['Settings'];
        let projectNames = { proj1: 'Project 1', proj2: 'Project 2', proj3: 'Project 3' };
        if (settingsSheet) {
            const rows = await settingsSheet.getRows();
            rows.forEach(row => {
                const key = row.get('Key');
                const val = row.get('Value');
                if (key === 'proj1_name' && val) projectNames.proj1 = val;
                if (key === 'proj2_name' && val) projectNames.proj2 = val;
                if (key === 'proj3_name' && val) projectNames.proj3 = val;
            });
        }

        let dailySummary = null;`
);

newContent = newContent.replace(
    `return NextResponse.json({ reminders, letterly, dailySummary });`,
    `return NextResponse.json({ reminders, letterly, dailySummary, projectNames });`
);

newContent = newContent.replace(
    `return NextResponse.json({ error: "Invalid action" }, { status: 400 });`,
    `        if (action === 'update_todo_status') {
            const sheet = doc.sheetsByTitle['Reminders'];
            if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
            const rows = await sheet.getRows();
            const row = rows.find(r => r.rowNumber === rowNumber);
            if (row) {
                row.set('Status', newStatus);
                await row.save();
                return NextResponse.json({ success: true });
            }
            return NextResponse.json({ error: "Row not found" }, { status: 404 });
        }

        if (action === 'update_project_name') {
            let sheet = doc.sheetsByTitle['Settings'];
            if (!sheet) {
                sheet = await doc.addSheet({ title: 'Settings', headerValues: ['Key', 'Value'] });
            }
            const { key, value } = body;
            const rows = await sheet.getRows();
            const row = rows.find(r => r.get('Key') === key);
            if (row) {
                row.set('Value', value);
                await row.save();
            } else {
                await sheet.addRow({ Key: key, Value: value });
            }
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });`
);

fs.writeFileSync('/Users/justinevans/Desktop/ToDo App/render-webapp/src/app/api/todos/route.ts', newContent);
