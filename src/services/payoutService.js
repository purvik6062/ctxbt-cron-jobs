const { connect } = require('../db');

async function calculateMonthlyPayouts() {
    const client = await connect();
    try {
        const backtestingCollection = client.db('backtesting_db').collection('backtesting_results_with_reasoning');
        const influencersCollection = client.db('ctxbt-signal-flow').collection('influencers');
        const tweetsCollection = client.db('ctxbt-signal-flow').collection('ctxbt_tweets');

        // Determine the previous month's date range
        const currentDate = new Date();
        const previousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        const startOfPreviousMonth = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), 1).toISOString();
        const endOfPreviousMonth = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

        // Fetch all influencers with their twitterHandle and subscribers
        const influencers = await influencersCollection.find({}, { projection: { twitterHandle: 1, subscribers: 1 } }).toArray();

        for (const influencer of influencers) {
            const handle = influencer.twitterHandle;
            const numSubscribers = influencer.subscribers ? influencer.subscribers.length : 0;
            const P = numSubscribers * 20; // Total proceeds: $20 per subscriber

            // Fetch signals for the previous month
            const signals = await backtestingCollection.find({
                "Twitter Account": handle,
                "Signal Generation Date": { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth }
            }).toArray();

            // Calculate average P&L
            const pnls = signals.map(signal => {
                const pnlStr = signal["Final P&L"];
                if (!pnlStr) return 0;
                return parseFloat(pnlStr.replace('%', '')) || 0;
            });
            const A = pnls.length > 0 ? pnls.reduce((sum, val) => sum + val, 0) / pnls.length : 0;

            // Check for promotional tweet containing "ctxbt"
            const promotionalTweet = await tweetsCollection.findOne({
                twitterHandle: handle,
                tweets: {
                    $elemMatch: {
                        timestamp: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth },
                    }
                }
            });
            const S = promotionalTweet ? 1 : 0;
            // Calculate payout (R)
            let R;
            if (A >= 10 && S === 1) {
                R = P;
            } else if (A > 0 && A < 10 && S === 1) {
                R = P * (A / 10);
            } else {
                R = 0;
            }

            // Update the influencer's document with the payout
            await influencersCollection.updateOne(
                { _id: influencer._id },
                {
                    $push: {
                        monthlyPayouts: {
                            year: previousMonth.getFullYear(),
                            month: previousMonth.getMonth() + 1, // 1-12 for Jan-Dec
                            payout: R
                        }
                    }
                },
                { upsert: true } // Create monthlyPayouts array if it doesn't exist
            );

            console.log(`Updated payout for ${handle}: $${R}`);
        }
    } catch (error) {
        console.error('Error in calculateMonthlyPayouts:', error);
        throw error;
    } finally {
        client.close();
    }
}

module.exports = { calculateMonthlyPayouts };