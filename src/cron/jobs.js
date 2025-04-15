// src/cron/jobs.js
const cron = require('node-cron');
const { updateSubscribers } = require('../services/subscriptionService');
const { processTweets } = require('../services/tweetsService');
const { fetchAndUpdateCoins } = require('../services/coinsService');
const { messageSender } = require('../services/messageSender');
const { addSubscriber } = require('../services/addSubscribers');
const { processCSV } = require('../services/process-signal-multi-strategies')
const { pnlNormalization } = require('../services/pnlNormalization');

function startCronJobs() {
    // updateSubscribers will run every 2 hours 
    cron.schedule('*/10 * * * *', async () => {
        console.log('Starting active subscription updater at:', new Date().toISOString());
        await updateSubscribers();
    });

    // Coins Update Job remains scheduled to run every day at midnight
    cron.schedule('*/20 * * * *', async () => {
        console.log('Starting coins update job at:', new Date().toISOString());
        await fetchAndUpdateCoins();
    });

    // messageSender will run every 3 hours
    cron.schedule('*/20 * * * *', async () => {
        console.log('Starting message sender job at:', new Date().toISOString());
        await processTweets();
    });

    // backtesting job will run every 4 hours
    cron.schedule('*/30 * * * *', async () => {
        processCSV('./backtesting.csv')
            .catch(error => console.error('Error:', error));
    });

    // pnl normalization job will run every 4 hours
    cron.schedule('* */4 * * *', async () => {
        await pnlNormalization();
    });

    console.log('Cron jobs are scheduled.');

    // console.log('Starting active subscription updater at:', new Date().toISOString());
    // updateSubscribers();
    // console.log('Starting coins update job at:', new Date().toISOString());
    // fetchAndUpdateCoins();
    // console.log('Starting tweets processing job at:', new Date().toISOString());
    // processTweets();
    // console.log('Starting message sender job at:', new Date().toISOString());
    // messageSender();

    // const twitterHandles = [
    //     "Steve_Cryptoo",
    //     "aixbt_agent",
    //     "dippy_eth",
    //     "cryptostasher",
    //     "KAPOTHEGOAT01",
    //     "CryptoDona7",
    //     "IncomeSharks"
    // ];
    // const subscriber = "userName";

    // addSubscriber(twitterHandles, subscriber);


}

module.exports = { startCronJobs };