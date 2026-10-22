require('dotenv').config();
const { getRecentMessages } = require('./imessage');
const lastSMSProcessed = 1789347547759;
console.log("Checking since:", new Date(lastSMSProcessed));
getRecentMessages(lastSMSProcessed).then(msgs => {
    console.log(`Found ${msgs.length} messages.`);
    if (msgs.length > 0) {
        console.log(msgs.slice(-5));
    }
});
