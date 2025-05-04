const fs = require('fs');
const path = require('path');

/**
 * Deletes CSV files that are no longer needed since we're using MongoDB directly
 */
function cleanupCSVFiles() {
    const rootDir = path.resolve(__dirname, '../../');
    const csvFiles = [
        'backtesting.csv',
        'backtest.csv',
        'backtest_pnl.csv',
        'backtesting_old.csv',
        'result.csv'
    ];
    
    console.log('Cleaning up unnecessary CSV files...');
    
    let deletedCount = 0;
    let notFoundCount = 0;
    
    for (const file of csvFiles) {
        const filePath = path.join(rootDir, file);
        
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Deleted: ${file}`);
                deletedCount++;
            } else {
                console.log(`File not found: ${file}`);
                notFoundCount++;
            }
        } catch (error) {
            console.error(`Error deleting ${file}:`, error);
        }
    }
    
    console.log(`Cleanup complete. Deleted: ${deletedCount}, Not found: ${notFoundCount}`);
}

// Execute the cleanup if this file is run directly
if (require.main === module) {
    cleanupCSVFiles();
}

module.exports = { cleanupCSVFiles }; 