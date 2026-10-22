require('dotenv').config();
const { getPrimaryTaskClient } = require('./tasks');
getPrimaryTaskClient().then(async (service) => {
    try {
        const res = await service.tasks.get({
            tasklist: 'MG5IREVFc1lhXzFsb2NzSw',
            task: 'xDh3b2ppTEhVRlZaeTZVeQ'
        });
        console.log("Task found:", res.data.title);
    } catch (e) {
        console.log("Error:", e.message);
    }
});
