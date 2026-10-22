const { runFullSync } = require('./sync.js');
runFullSync(true).then(() => {
    console.log("Forced morning run finished");
    process.exit(0);
});
