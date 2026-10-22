require('dotenv').config();
const { getRecentMessages } = require('./imessage');
getRecentMessages(Date.now() - 600000).then(msgs => {
    console.log(`Found ${msgs.length} messages in last 10 mins.`);
    if (msgs.length > 0) {
        console.log(msgs.slice(-5));
    }
});
