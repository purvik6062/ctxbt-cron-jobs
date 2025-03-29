// src/cron/jobs.js
const cron = require('node-cron');
const { updateSubscribers } = require('../services/subscriptionService');
const { processTweets } = require('../services/tweetsService');
const { fetchAndUpdateCoins } = require('../services/coinsService');
const { messageSender } = require('../services/messageSender');
const { addSubscriber } = require('../services/addSubscribers');
const { processCSV } = require('../services/process-signal-multi-strategies')

function startCronJobs() {
    // updateSubscribers will run every 2 hours 
    cron.schedule('0 */2 * * *', async () => {
        console.log('Starting active subscription updater at:', new Date().toISOString());
        await updateSubscribers();
    });

    // Coins Update Job remains scheduled to run every day at midnight
    cron.schedule('0 */2 * * *', async () => {
        console.log('Starting coins update job at:', new Date().toISOString());
        await fetchAndUpdateCoins();
    });

    // messageSender will run every 6 hours
    cron.schedule('0 */3 * * *', async () => {
        console.log('Starting message sender job at:', new Date().toISOString());
        await processTweets();
    });

    // messageSender will run every 3 hours
    cron.schedule('0 */4 * * *', async () => {
        processCSV('./backtesting.csv', './result.csv')
            .catch(error => console.error('Error:', error));
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