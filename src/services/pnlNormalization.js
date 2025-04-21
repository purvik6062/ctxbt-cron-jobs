const { MongoClient } = require('mongodb');
const { connect } = require('../db/index');

class PnLNormalizationService {
    constructor() {
        this.db = "backtesting_db";
        this.impactFactorsCollection = 'impact_factors';
        this.weeklyPnLCollection = 'weekly_pnl';
    }

    async initialize() {
        const client = await connect();
        this.db = client.db("backtesting_db");
    }

    async calculateWeeklyPnL() {
        try {
            // Calculate date range for the last week
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
            
            // Fetch PnL data from the database for the last week
            const pnlData = await this.db.collection('backtesting_results_with_reasoning')
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

            await this.db.collection(this.weeklyPnLCollection).insertOne(weeklyPnL);
            return accountPnL;
        } catch (error) {
            console.error('Error calculating weekly PnL:', error);
            throw error;
        }
    }

    async normalizePnL(accountPnL) {
        try {
            // Get all impact factors
            const impactFactors = await this.db.collection(this.impactFactorsCollection)
                .find({})
                .toArray();

            // Calculate normalization factors
            const totalPnL = Object.values(accountPnL).reduce((sum, pnl) => sum + pnl, 0);
            const averagePnL = totalPnL / Object.keys(accountPnL).length;

            // Normalize PnL and update impact factors
            const updates = [];
            for (const [account, pnl] of Object.entries(accountPnL)) {
                const currentImpact = impactFactors.find(f => f.account === account)?.impactFactor || 1;
                
                // Calculate new impact factor
                // This formula can be adjusted based on your requirements
                const normalizedPnL = pnl / averagePnL;
                const newImpactFactor = currentImpact * (1 + (normalizedPnL * 0.1)); // 10% adjustment factor
                
                // Ensure impact factor stays within reasonable bounds
                const boundedImpactFactor = Math.max(0.5, Math.min(2.0, newImpactFactor));

                updates.push({
                    updateOne: {
                        filter: { account },
                        update: { 
                            $set: { 
                                impactFactor: boundedImpactFactor,
                                lastUpdated: new Date(),
                                previousImpactFactor: currentImpact
                            }
                        },
                        upsert: true
                    }
                });
            }

            // Bulk update impact factors
            if (updates.length > 0) {
                await this.db.collection(this.impactFactorsCollection).bulkWrite(updates);
            }

            return updates.map(u => ({
                account: u.updateOne.filter.account,
                newImpactFactor: u.updateOne.update.$set.impactFactor
            }));
        } catch (error) {
            console.error('Error normalizing PnL:', error);
            throw error;
        }
    }

    async processWeeklyNormalization() {
        try {
            await this.initialize();
            const accountPnL = await this.calculateWeeklyPnL();
            const updatedImpactFactors = await this.normalizePnL(accountPnL);
            
            console.log('Weekly PnL normalization completed:', {
                timestamp: new Date(),
                updatedAccounts: updatedImpactFactors.length,
                sampleUpdate: updatedImpactFactors[0]
            });

            return updatedImpactFactors;
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
//             const updatedImpactFactors = await service.processWeeklyNormalization();
//             console.log('Updated Impact Factors:', updatedImpactFactors);
//         } catch (error) {
//             console.error('Failed to process weekly normalization:', error);
//         } finally {
//             process.exit(); // Exit the process after completion
//         }
//     })();
// }

module.exports = new PnLNormalizationService(); 