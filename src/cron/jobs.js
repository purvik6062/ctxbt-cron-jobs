// src/cron/jobs.js
const cron = require('node-cron');
const { updateSubscribers } = require('../services/subscriptionService');
const { processTweets } = require('../services/tweetsService');

function startCronJobs() {
    // Active Subscription Updater - runs every 5 minutes
    cron.schedule('*/1 * * * *', async () => {
        console.log('Starting active subscription updater at:', new Date().toISOString());
        await updateSubscribers();
    });

    // Tweets Processing Job - runs every 5 minutes
    cron.schedule('*/3 * * * *', async () => {
        console.log('Starting tweets processing job at:', new Date().toISOString());
        await processTweets();
    });

    console.log('Cron jobs are scheduled.');
}

module.exports = { startCronJobs };
