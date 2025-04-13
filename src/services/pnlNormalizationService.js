const { MongoClient } = require('mongodb');
const { processCSV } = require('./process-signal-multi-strategies');
const { getDb } = require('../db/connection');

class PnLNormalizationService {
    constructor() {
        this.db = null;
        this.impactFactorsCollection = 'impact_factors';
        this.weeklyPnLCollection = 'weekly_pnl';
    }

    async initialize() {
        this.db = await getDb();
    }

    async calculateWeeklyPnL() {
        try {
            // Process the backtesting CSV to get PnL data
            const pnlData = await processCSV('./backtest_pnl.csv');
            
            // Group PnL by account and calculate sum
            const accountPnL = {};
            pnlData.forEach(entry => {
                if (!accountPnL[entry.account]) {
                    accountPnL[entry.account] = 0;
                }
                accountPnL[entry.account] += parseFloat(entry.pnl);
            });

            // Store weekly PnL data
            const weeklyPnL = {
                timestamp: new Date(),
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

module.exports = new PnLNormalizationService(); 