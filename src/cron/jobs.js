// src/cron/jobs.js
const cron = require('node-cron');
const { updateSubscribers } = require('../services/subscriptionService');
const { processTweets } = require('../services/tweetsService');
const { fetchAndUpdateCoins } = require('../services/coinsService');
const { messageSender } = require('../services/messageSender');
const { addSubscriber } = require('../services/addSubscribers');
const { processCSV } = require('../services/process-signal-multi-strategies')
const pnlNormalizationService = require('../services/pnlNormalizationService');

function startCronJobs() {
    // updateSubscribers will run every 10 minutes 
    cron.schedule('*/10 * * * *', async () => {
        console.log('Starting active subscription updater at:', new Date().toISOString());
        await updateSubscribers();
    });

    // fetchAndUpdateCoins will run every 20 minutes
    cron.schedule('*/20 * * * *', async () => {
        console.log('Starting coins update job at:', new Date().toISOString());
        await fetchAndUpdateCoins();
    });

    // messageSender will run every 20 minutes
    let isProcessing = false;
    cron.schedule('*/20 * * * *', async () => {
        if (isProcessing) {
            console.log('Previous processTweets job is still running, skipping this run');
            return;
        }

        try {
            isProcessing = true;
            console.log('Starting message sender job at:', new Date().toISOString());
            await processTweets();
            console.log('Completed message sender job at:', new Date().toISOString());
        } catch (error) {
            console.error('Error in message sender job:', error);
        } finally {
            isProcessing = false;
        }
    });

    // backtesting job will run every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
        processCSV('./backtesting.csv')
            .catch(error => console.error('Error:', error));
    });

    // Weekly PnL normalization - runs every Sunday at 23:59
    cron.schedule('59 23 * * 0', async () => {
        console.log('Starting weekly PnL normalization at:', new Date().toISOString());
        try {
            await pnlNormalizationService.processWeeklyNormalization();
        } catch (error) {
            console.error('Error in weekly PnL normalization:', error);
        }
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