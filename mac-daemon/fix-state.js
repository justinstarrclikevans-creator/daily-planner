const fs = require('fs');
const state = JSON.parse(fs.readFileSync('state.json'));
state.lastSMSProcessed = Date.now();
fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
