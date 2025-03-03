// src/cron/jobs.js
const cron = require('node-cron');
const { updateSubscribers } = require('../services/subscriptionService');
const { processTweets } = require('../services/tweetsService');
const { fetchAndUpdateCoins } = require('../services/coinsService');

function startCronJobs() {
    // updateSubscribers will run every 12 hours (at midnight and noon)
    cron.schedule('0 */12 * * *', async () => {
        console.log('Starting active subscription updater at:', new Date().toISOString());
        await updateSubscribers();
    });

    // processTweets will run every day at 10 AM
    cron.schedule('0 10 * * *', async () => {
        console.log('Starting tweets processing job at:', new Date().toISOString());
        await processTweets();
    });

    // Coins Update Job remains scheduled to run every day at midnight
    cron.schedule('0 0 * * *', async () => {
        console.log('Starting coins update job at:', new Date().toISOString());
        await fetchAndUpdateCoins();
    });

    console.log('Cron jobs are scheduled.');
}

module.exports = { startCronJobs };
