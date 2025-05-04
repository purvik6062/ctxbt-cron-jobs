// process-signals.js - Run this file to manually start the signal processing
const { processSignals } = require('./src/services/process-signal-multi-strategies');

console.log('Starting manual signal processing...');
processSignals()
    .then(() => {
        console.log('Signal processing completed successfully.');
        process.exit(0);
    })
    .catch(error => {
        console.error('Error in signal processing:', error);
        process.exit(1);
    }); 