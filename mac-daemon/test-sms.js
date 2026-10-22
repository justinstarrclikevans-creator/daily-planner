const { processIncomingSMS } = require('./sms-handler');
console.log("Running processIncomingSMS manually...");
processIncomingSMS().then(() => console.log("Done running manually."));
