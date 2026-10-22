const fs = require('fs');
const state = JSON.parse(fs.readFileSync('state.json'));
state.lastSMSProcessed = state.lastSMSProcessed - 600000;
fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
