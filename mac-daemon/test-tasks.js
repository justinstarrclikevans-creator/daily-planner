require('dotenv').config();
const { getIncompleteGoogleTasks } = require('./tasks');
getIncompleteGoogleTasks().then(tasks => {
    console.log("Got tasks:", tasks.length);
    if(tasks.length > 0) {
        console.log("First task ID length:", tasks[0].id.length);
        console.log("First task:", tasks[0]);
    }
});
