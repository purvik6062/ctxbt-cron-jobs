const { processAndSendSignal } = require('../services/hyperliquidSignalService');

/**
 * Test function to verify Hyperliquid signal service
 */
async function testHyperliquidSignal() {
    console.log('Testing Hyperliquid Signal Service...');
    
    // Test signal data
    const testSignal = {
        signal: 'buy',
        tokenMentioned: 'VIRTUAL',
        targets: [1.192, 1.2],
        stopLoss: 1.18,
        currentPrice: 1.19,
        maxExitTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
    };
    
    console.log('Test signal data:', JSON.stringify(testSignal, null, 2));
    
    try {
        const result = await processAndSendSignal(testSignal);
        console.log('API Response:', JSON.stringify(result, null, 2));
        
        if (result.status === 'success') {
            console.log('✅ Signal sent successfully!');
        } else {
            console.log('❌ Signal sending failed:', result.error);
        }
    } catch (error) {
        console.error('❌ Test failed with error:', error);
    }
}

// Run test if this file is executed directly
if (require.main === module) {
    testHyperliquidSignal();
}

module.exports = { testHyperliquidSignal }; 