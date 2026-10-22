const { getRecentEmails } = require('./google');
getRecentEmails().then(emails => {
    console.log("Total recent emails:", emails.length);
    emails.forEach(e => console.log(`- ${e.from}: ${e.subject}`));
});
