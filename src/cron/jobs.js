// src/cron/jobs.js
const cron = require('node-cron');
const { updateSubscribers } = require('../services/subscriptionService');
const { processTweets } = require('../services/tweetsService');
const { fetchAndUpdateCoins } = require('../services/coinsService');
const { messageSender } = require('../services/messageSender');
const { addSubscriber } = require('../services/addSubscribers');
const { processCSV } = require('../services/process-signal-multi-strategies');
const { updateInfluencerScores } = require('../services/updateInfluencerScores');
const { pnlNormalization } = require('../services/pnlNormalization');
const { verifyAndUpdateAllUsersFollow } = require('../services/verifyFollows');
const { verifyAndUpdateAllUsersRetweet } = require('../services/verifyRetweets');
const { calculateMonthlyPayouts } = require('../services/payoutService');
const { resetAllUsersCredits } = require('../services/resetCredits');

function startCronJobs() {
    // updateInfluencerScores Every Sunday at midnight
    cron.schedule('0 0 0 * * 0', async () => {
        console.log('Starting influencer scores update at:', new Date().toISOString());
        await updateInfluencerScores();
        console.log('Completed influencer scores update at:', new Date().toISOString());
    });

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

    // backtesting job will run every 4 hours
    cron.schedule('*/30 * * * *', async () => {
        processCSV('./backtesting.csv')
            .catch(error => console.error('Error:', error));
    });

    // pnl normalization job will run every 4 hours
    cron.schedule('* */4 * * *', async () => {
        await pnlNormalization();
    });

    // verifyFollows will run once every month (on the 1st day of the month at 00:00)
    cron.schedule('0 0 1 * *', async () => {
        console.log('Starting verifyFollows job at:', new Date().toISOString());
        await verifyAndUpdateAllUsersFollow();
    });

    // verifyRetweets will run once every week (every Monday at 00:00)
    cron.schedule('0 0 * * 1', async () => {
        console.log('Starting verifyRetweets job at:', new Date().toISOString());
        await verifyAndUpdateAllUsersRetweet();
    });

    // Calculate monthly payouts on the 1st of each month at 00:00
    cron.schedule('0 0 1 * *', async () => {
        console.log('Starting monthly payout calculation at:', new Date().toISOString());
        await calculateMonthlyPayouts();
        console.log('Completed monthly payout calculation at:', new Date().toISOString());
    });

    // resetCredits will run once every month (on the 1st day of the month at 00:00)
    cron.schedule('0 0 1 * *', async () => {
        console.log('Starting resetCredits job at:', new Date().toISOString());
        await resetAllUsersCredits();
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
    //  console.log('Starting influencer scores update at:', new Date().toISOString());
    // updateInfluencerScores();
    // console.log('Starting monthly payout calculation at:', new Date().toISOString());
    // calculateMonthlyPayouts();

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