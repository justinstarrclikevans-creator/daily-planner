require('dotenv').config();
const { triggerStalePurgeOffer } = require('./sms-handler');
triggerStalePurgeOffer().then(() => console.log("Done checking purge."));
