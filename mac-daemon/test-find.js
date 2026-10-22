require('dotenv').config();
const { getIncompleteGoogleTasks } = require('./tasks');
getIncompleteGoogleTasks().then(tasks => {
    const found = tasks.find(t => t.id === "xDh3b2ppTEhVRlZaeTZVeQ" || t.title.includes("Airbnb"));
    console.log("Found:", found);
});
