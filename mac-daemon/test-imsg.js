const { getRecentMessages } = require('./imessage.js');
getRecentMessages().then(msgs => console.log(`Found ${msgs.length} messages.`));
