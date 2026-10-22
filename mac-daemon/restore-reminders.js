const { exec } = require('child_process');

const script = `
tell application "Reminders"
    set restoredCount to 0
    set allLists to lists
    repeat with aList in allLists
        try
            set compRems to (reminders of aList whose completed is true and completion date > ((current date) - (3 * hours)))
            repeat with rem in compRems
                set completed of rem to false
                set restoredCount to restoredCount + 1
            end repeat
        end try
    end repeat
    return restoredCount
end tell
`;

exec(`osascript -e '${script}'`, (err, stdout, stderr) => {
    if (err) console.error("Restore error:", stderr);
    else console.log("Restored reminders count:", stdout.trim());
});
