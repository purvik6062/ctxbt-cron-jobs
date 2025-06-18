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

    async calculateOverallPnL() {
        try {
            // Fetch all PnL data from the database (no date filtering)
            const pnlData = await this.backtestingDb.collection('backtesting_results_with_reasoning')
                .find({})
                .toArray();
            console.log("Overall pnlData", pnlData.length, "total records");
            
            // Group PnL by Twitter Account and calculate sum and signal count
            const accountPnL = {};
            const accountSignalCount = {};
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
                    accountSignalCount[account] = 0;
                }
                accountPnL[account] += pnl; // Sum the P&L for each account
                accountSignalCount[account] += 1; // Count signals for each account
            });
            
            // Store overall PnL data for record keeping
            const overallPnL = {
                timestamp: new Date(),
                calculationType: 'overall',
                data: accountPnL,
                signalCounts: accountSignalCount
            };

            await this.backtestingDb.collection(this.weeklyPnLCollection).insertOne(overallPnL);
            return { accountPnL, accountSignalCount };
        } catch (error) {
            console.error('Error calculating overall PnL:', error);
            throw error;
        }
    }

    async normalizePnL(accountPnL, accountSignalCount) {
        try {
            // Get all influencers
            const influencers = await this.signalFlowDb.collection(this.influencersCollection)
                .find({})
                .toArray();

            // Update impact factors using new formula
            const updates = [];
            for (const [account, totalPnL] of Object.entries(accountPnL)) {
                // Find the influencer by twitterHandle
                const twitterHandle = account.replace('@', '');
                const influencer = influencers.find(f => f.twitterHandle === twitterHandle);
                
                // Skip if influencer not found
                if (!influencer) {
                    console.log(`Influencer not found for account: ${account}`);
                    continue;
                }
                
                // Get signal count for this account
                const signalCount = accountSignalCount[account] || 1; // Prevent division by zero
                
                // Calculate impact factor using new formula: total PnL / number of signals
                const pnlPerSignal = totalPnL / signalCount;
                
                let newImpactFactor;
                if (totalPnL > 0) {
                    // Positive total PnL: calculate positive impact factor
                    // Scale the pnlPerSignal to a reasonable range (1-1000+)
                    // Using a scaling factor to convert percentage-based PnL to impact factor range
                    const SCALING_FACTOR = 10; // Adjust this to fine-tune the sensitivity
                    newImpactFactor = Math.max(1, Math.round(1 + Math.abs(pnlPerSignal) * SCALING_FACTOR));
                } else {
                    // Negative or zero total PnL: set minimum impact factor
                    newImpactFactor = 10 // Minimum impact factor for poor performance
                }

                updates.push({
                    updateOne: {
                        filter: { twitterHandle },
                        update: { 
                            $set: { 
                                impactFactor: newImpactFactor,
                                totalPnL: totalPnL,
                                signalCount: signalCount,
                                pnlPerSignal: pnlPerSignal,
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
                newImpactFactor: u.updateOne.update.$set.impactFactor,
                totalPnL: u.updateOne.update.$set.totalPnL,
                signalCount: u.updateOne.update.$set.signalCount,
                pnlPerSignal: u.updateOne.update.$set.pnlPerSignal
            }));
        } catch (error) {
            console.error('Error normalizing PnL and updating influencers:', error);
            throw error;
        }
    }

    async processOverallNormalization() {
        try {
            await this.initialize();
            const { accountPnL, accountSignalCount } = await this.calculateOverallPnL();
            const updatedInfluencers = await this.normalizePnL(accountPnL, accountSignalCount);
            
            console.log('Overall PnL normalization completed:', {
                timestamp: new Date(),
                updatedAccounts: updatedInfluencers.length,
                sampleUpdate: updatedInfluencers[0]
            });

            // Close database connection
            // if (this.client) {
            //     await this.client.close();
            // }

            return updatedInfluencers;
        } catch (error) {
            console.error('Error in overall normalization process:', error);
            throw error;
        }
    }
}

// Add this section to allow direct execution
// if (require.main === module) {
//     (async () => {
//         const service = new PnLNormalizationService();
//         try {
//             const updatedInfluencers = await service.processOverallNormalization();
//             console.log('Updated Influencers:', updatedInfluencers);
//         } catch (error) {
//             console.error('Failed to process overall normalization:', error);
//         } finally {
//             process.exit(); // Exit the process after completion
//         }
//     })();
// }

module.exports = new PnLNormalizationService(); 