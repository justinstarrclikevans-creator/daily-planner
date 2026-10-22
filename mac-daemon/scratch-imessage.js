require('dotenv').config();
const { getRecentMessages } = require('./imessage.js');
getRecentMessages().then(msgs => {
    console.log(`Found ${msgs.length} messages.`);
    if (msgs.length > 0) {
        console.log(msgs.slice(-5));
    }
});
