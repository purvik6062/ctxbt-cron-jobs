const { MongoClient } = require('mongodb');
const { connect } = require('../db/index');

class PnLNormalizationService {
    constructor() {
        this.backtestingDb = "backtesting_db";
        this.signalFlowDb = "ctxbt-signal-flow";
        this.weeklyPnLCollection = 'weekly_pnl';
        this.influencersCollection = 'influencers';
    }

    async initialize() {
        this.client = await connect();
        this.backtestingDb = this.client.db("backtesting_db");
        this.signalFlowDb = this.client.db("ctxbt-signal-flow");
    }

    async calculateWeeklyPnL() {
        try {
            // Calculate date range for the last week
            const endDate = new Date(new Date().setDate(new Date().getDate() - 7));
            const startDate = new Date(new Date().setDate(new Date().getDate() - 14));
            
            // Fetch PnL data from the database for the last week
            const pnlData = await this.backtestingDb.collection('backtesting_results_with_reasoning')
                .find({
                    "Signal Generation Date": {
                        $gte: startDate.toISOString(),
                        $lte: endDate.toISOString()
                    }
                })
                .toArray();
            console.log("pnlData for last week", pnlData.length, "records from", startDate.toISOString(), "to", endDate.toISOString());
            
            // Group PnL by Twitter Account and calculate sum
            const accountPnL = {};
            pnlData.forEach(entry => {
                const account = entry["Twitter Account"];
                const pnlStr = entry["Final P&L"];
                // Convert percentage string to number
                let pnl = 0;
                if (pnlStr && typeof pnlStr === 'string') {
                    pnl = parseFloat(pnlStr.replace('%', ''));
                } else if (typeof pnlStr === 'number') {
                    pnl = pnlStr;
                }
                
                if (!accountPnL[account]) {
                    accountPnL[account] = 0;
                }
                accountPnL[account] += pnl; // Sum the P&L for each account
            });
            
            // Store weekly PnL data
            const weeklyPnL = {
                timestamp: new Date(),
                startDate: startDate,
                endDate: endDate,
                data: accountPnL
            };

            await this.backtestingDb.collection(this.weeklyPnLCollection).insertOne(weeklyPnL);
            return accountPnL;
        } catch (error) {
            console.error('Error calculating weekly PnL:', error);
            throw error;
        }
    }

    async normalizePnL(accountPnL) {
        try {
            // Get all influencers
            const influencers = await this.signalFlowDb.collection(this.influencersCollection)
                .find({})
                .toArray();

            // Calculate normalization factors
            const totalPnL = Object.values(accountPnL).reduce((sum, pnl) => sum + pnl, 0);
            const averagePnL = totalPnL / Object.keys(accountPnL).length;

            // Normalize PnL and update impact factors
            const updates = [];
            for (const [account, pnl] of Object.entries(accountPnL)) {
                // Find the influencer by twitterHandle
                const twitterHandle = account.replace('@', '');
                const influencer = influencers.find(f => f.twitterHandle === twitterHandle);
                
                // Skip if influencer not found
                if (!influencer) {
                    console.log(`Influencer not found for account: ${account}`);
                    continue;
                }
                
                const currentImpactFactor = influencer.impactFactor || 1;
                
                // Calculate new impact factor in 0.5-2.0 range
                const normalizedPnL = pnl / averagePnL;
                const newImpactFactorRaw = currentImpactFactor * (1 + (normalizedPnL * 0.1)); // 10% adjustment factor
                const boundedImpactFactorRaw = Math.max(0.5, Math.min(2.0, newImpactFactorRaw));
                
                // Scale from 0.5-2.0 to 1-100 range
                const scaledImpactFactor = Math.round(((boundedImpactFactorRaw - 0.5) / 1.5) * 99 + 1);

                updates.push({
                    updateOne: {
                        filter: { twitterHandle },
                        update: { 
                            $set: { 
                                impactFactor: scaledImpactFactor,
                                updatedAt: new Date()
                            }
                        }
                    }
                });
            }

            // Bulk update influencers
            if (updates.length > 0) {
                await this.signalFlowDb.collection(this.influencersCollection).bulkWrite(updates);
            }

            return updates.map(u => ({
                twitterHandle: u.updateOne.filter.twitterHandle,
                newImpactFactor: u.updateOne.update.$set.impactFactor
            }));
        } catch (error) {
            console.error('Error normalizing PnL and updating influencers:', error);
            throw error;
        }
    }

    async processWeeklyNormalization() {
        try {
            await this.initialize();
            const accountPnL = await this.calculateWeeklyPnL();
            const updatedInfluencers = await this.normalizePnL(accountPnL);
            
            console.log('Weekly PnL normalization completed:', {
                timestamp: new Date(),
                updatedAccounts: updatedInfluencers.length,
                sampleUpdate: updatedInfluencers[0]
            });

            // Close database connection
            if (this.client) {
                await this.client.close();
            }

            return updatedInfluencers;
        } catch (error) {
            console.error('Error in weekly normalization process:', error);
            throw error;
        }
    }
}

// Add this section to allow direct execution
// if (require.main === module) {
//     (async () => {
//         const service = new PnLNormalizationService();
//         try {
//             const updatedInfluencers = await service.processWeeklyNormalization();
//             console.log('Updated Influencers:', updatedInfluencers);
//         } catch (error) {
//             console.error('Failed to process weekly normalization:', error);
//         } finally {
//             process.exit(); // Exit the process after completion
//         }
//     })();
// }

module.exports = new PnLNormalizationService(); 