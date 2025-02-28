// src/cron/jobs.js
const cron = require('node-cron');
const { updateSubscribers } = require('../services/subscriptionService');
const { processTweets } = require('../services/tweetsService');
const { fetchAndUpdateCoins } = require('../services/coinsService');

function startCronJobs() {
    // // Active Subscription Updater - runs every 5 minutes
    // cron.schedule('*/1 * * * *', async () => {
    //     console.log('Starting active subscription updater at:', new Date().toISOString());
    //     await updateSubscribers();
    // });

    // Tweets Processing Job - runs every 10 minutes
    cron.schedule('*/1 * * * *', async () => {
        console.log('Starting tweets processing job at:', new Date().toISOString());
        await processTweets();
    });

    // Coins Update Job - runs every 24 hours at midnight
    cron.schedule('0 0 * * *', async () => {
        console.log('Starting coins update job at:', new Date().toISOString());
        await fetchAndUpdateCoins();
    });

    console.log('Cron jobs are scheduled.');
}

module.exports = { startCronJobs };
