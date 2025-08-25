const { connect } = require('../db/index');

class RiddlerDeFiFixService {
    constructor() {
        this.signalFlowDb = null;
        this.backtestingDb = null;
        this.influencersCollection = 'influencers';
        this.backtestingCollection = 'backtesting_results_with_reasoning';
    }

    async initialize() {
        this.client = await connect();
        this.signalFlowDb = this.client.db("ctxbt-signal-flow");
        this.backtestingDb = this.client.db("backtesting_db");
    }

    async calculateActualValuesForRiddlerDeFi() {
        try {
            console.log('Calculating actual values for RiddlerDeFi...');
            
            // Get RiddlerDeFi's influencer document
            const riddlerDeFi = await this.signalFlowDb.collection(this.influencersCollection)
                .findOne({ twitterHandle: 'RiddlerDeFi' });

            if (!riddlerDeFi) {
                console.log('RiddlerDeFi not found in influencers collection');
                return null;
            }

            console.log('Found RiddlerDeFi:', {
                twitterHandle: riddlerDeFi.twitterHandle,
                currentImpactFactor: riddlerDeFi.impactFactor,
                currentPnLPerSignal: riddlerDeFi.pnlPerSignal,
                currentTotalPnL: riddlerDeFi.totalPnL
            });

            // Get all backtesting results for RiddlerDeFi
            const backtestingResults = await this.backtestingDb.collection(this.backtestingCollection)
                .find({ "Twitter Account": "RiddlerDeFi" })
                .toArray();

            console.log(`Found ${backtestingResults.length} backtesting results for RiddlerDeFi`);

            if (backtestingResults.length === 0) {
                console.log('No backtesting results found for RiddlerDeFi');
                return null;
            }

            // Calculate actual values
            let totalPnL = 0;
            let validSignals = 0;
            const signalPnLs = [];

            for (const result of backtestingResults) {
                const pnlStr = result["Final P&L"];
                if (pnlStr && typeof pnlStr === 'string') {
                    // Remove % and parse
                    const cleanPnL = pnlStr.replace('%', '').trim();
                    const pnl = parseFloat(cleanPnL);
                    
                    if (isFinite(pnl)) {
                        totalPnL += pnl;
                        validSignals++;
                        signalPnLs.push(pnl);
                    } else {
                        console.log(`Skipping invalid PnL: "${pnlStr}"`);
                    }
                }
            }

            console.log(`Valid signals: ${validSignals}/${backtestingResults.length}`);
            console.log(`Total PnL: ${totalPnL.toFixed(2)}%`);
            
            if (validSignals > 0) {
                const pnlPerSignal = totalPnL / validSignals;
                console.log(`PnL per signal: ${pnlPerSignal.toFixed(2)}%`);
                
                // Calculate impact factor based on performance
                let impactFactor;
                if (totalPnL > 0) {
                    // Positive performance: scale based on PnL per signal
                    const SCALING_FACTOR = 10;
                    impactFactor = Math.max(1, Math.round(1 + Math.abs(pnlPerSignal) * SCALING_FACTOR));
                } else {
                    // Negative or neutral performance: minimum impact factor
                    impactFactor = 10;
                }
                
                console.log(`Calculated impact factor: ${impactFactor}`);

                return {
                    totalPnL: totalPnL,
                    pnlPerSignal: pnlPerSignal,
                    impactFactor: impactFactor,
                    signalCount: validSignals,
                    allPnLs: signalPnLs
                };
            } else {
                console.log('No valid PnL data found, using default values');
                return {
                    totalPnL: 0,
                    pnlPerSignal: 0,
                    impactFactor: 10,
                    signalCount: 0,
                    allPnLs: []
                };
            }

        } catch (error) {
            console.error('Error calculating actual values:', error);
            throw error;
        }
    }

    async updateRiddlerDeFiDocument(calculatedValues) {
        try {
            if (!calculatedValues) {
                console.log('No calculated values to update');
                return;
            }

            console.log('Updating RiddlerDeFi document with calculated values...');

            const updateResult = await this.signalFlowDb.collection(this.influencersCollection)
                .updateOne(
                    { twitterHandle: 'RiddlerDeFi' },
                    {
                        $set: {
                            impactFactor: calculatedValues.impactFactor,
                            pnlPerSignal: calculatedValues.pnlPerSignal,
                            totalPnL: calculatedValues.totalPnL,
                            signalCount: calculatedValues.signalCount,
                            updatedAt: new Date(),
                            lastCalculated: new Date()
                        }
                    }
                );

            if (updateResult.modifiedCount > 0) {
                console.log('Successfully updated RiddlerDeFi document');
                
                // Verify the update
                const updatedDoc = await this.signalFlowDb.collection(this.influencersCollection)
                    .findOne({ twitterHandle: 'RiddlerDeFi' });
                
                console.log('Updated values:', {
                    impactFactor: updatedDoc.impactFactor,
                    pnlPerSignal: updatedDoc.pnlPerSignal,
                    totalPnL: updatedDoc.totalPnL,
                    signalCount: updatedDoc.signalCount
                });
            } else {
                console.log('No changes made to RiddlerDeFi document');
            }

        } catch (error) {
            console.error('Error updating RiddlerDeFi document:', error);
            throw error;
        }
    }

    async fixRiddlerDeFi() {
        try {
            console.log('Starting RiddlerDeFi fix process...');
            
            // Calculate actual values
            const calculatedValues = await this.calculateActualValuesForRiddlerDeFi();
            
            // Update the document
            await this.updateRiddlerDeFiDocument(calculatedValues);
            
            console.log('RiddlerDeFi fix completed successfully');
            return calculatedValues;

        } catch (error) {
            console.error('Error during RiddlerDeFi fix:', error);
            throw error;
        }
    }

    async close() {
        if (this.client) {
            await this.client.close();
        }
    }
}

// Allow direct execution
if (require.main === module) {
    (async () => {
        const fixService = new RiddlerDeFiFixService();
        try {
            await fixService.initialize();
            const result = await fixService.fixRiddlerDeFi();
            console.log('Fix completed with result:', result);
        } catch (error) {
            console.error('Failed to fix RiddlerDeFi:', error);
        } finally {
            await fixService.close();
            process.exit();
        }
    })();
}

module.exports = RiddlerDeFiFixService;
