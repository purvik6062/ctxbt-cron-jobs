const { 
    getCurrentTopInfluencers, 
    checkInfluencerEligibility, 
    clearInfluencerCache,
    shouldSendToHyperliquid
} = require('../services/signalGeneration');

async function testTopInfluencerSystem() {
    console.log('🧪 Testing Top Influencer System\n');
    
    try {
        // Test 1: Get current top influencers
        console.log('📊 Test 1: Getting current top influencers...');
        const topInfluencers = await getCurrentTopInfluencers();
        
        if (topInfluencers.error) {
            console.error('❌ Error getting top influencers:', topInfluencers.error);
            return;
        }
        
        console.log('✅ Top 10 Influencers:');
        topInfluencers.top10.forEach((inf, index) => {
            console.log(`   ${index + 1}. ${inf.twitterHandle} - Impact: ${inf.impactFactor}, PnL: ${inf.totalPnL}%, Signals: ${inf.signalCount}`);
        });
        
        console.log('\n✅ Top 30 Influencers (showing first 15):');
        topInfluencers.top30.slice(0, 15).forEach((inf, index) => {
            console.log(`   ${index + 1}. ${inf.twitterHandle} - Impact: ${inf.impactFactor}, PnL: ${inf.totalPnL}%, Signals: ${inf.signalCount}`);
        });
        
        console.log(`\n📈 Cache Info: ${topInfluencers.cacheInfo.cacheAge}`);
        
        // Test 2: Check specific influencer eligibility for different tokens
        console.log('\n🔍 Test 2: Checking influencer eligibility...');
        
        const testCases = [
            { influencer: 'RiddlerDeFi', token: 'bitcoin' },
            { influencer: 'RiddlerDeFi', token: 'ethereum' },
            { influencer: 'RiddlerDeFi', token: 'solana' },
            { influencer: 'AltcoinLevi', token: 'bitcoin' },
            { influencer: 'AltcoinLevi', token: 'solana' },
            { influencer: 'SomeRandomUser', token: 'bitcoin' },
            { influencer: 'SomeRandomUser', token: 'solana' }
        ];
        
        for (const testCase of testCases) {
            const eligibility = await checkInfluencerEligibility(testCase.influencer, testCase.token);
            console.log(`\n${testCase.influencer} + ${testCase.token}:`);
            console.log(`   BTC/ETH: ${eligibility.isBTC || eligibility.isETH ? 'Yes' : 'No'}`);
            console.log(`   Top 10: ${eligibility.isInTop10 ? `Yes (#${eligibility.ranking.top10Rank})` : 'No'}`);
            console.log(`   Top 30: ${eligibility.isInTop30 ? `Yes (#${eligibility.ranking.top30Rank})` : 'No'}`);
            console.log(`   Can Send: ${eligibility.shouldSend ? 'Yes' : 'No'}`);
            console.log(`   Reason: ${eligibility.reason}`);
        }
        
        // Test 3: Test the shouldSendToHyperliquid function directly
        console.log('\n🚀 Test 3: Testing Hyperliquid eligibility...');
        
        const hyperliquidTests = [
            { influencer: 'RiddlerDeFi', token: 'bitcoin' },
            { influencer: 'RiddlerDeFi', token: 'ethereum' },
            { influencer: 'RiddlerDeFi', token: 'solana' },
            { influencer: 'AltcoinLevi', token: 'bitcoin' },
            { influencer: 'AltcoinLevi', token: 'solana' }
        ];
        
        for (const test of hyperliquidTests) {
            const result = await shouldSendToHyperliquid(test.influencer, test.token);
            console.log(`\n${test.influencer} + ${test.token}:`);
            console.log(`   Should Send: ${result.shouldSend ? '✅ Yes' : '❌ No'}`);
            console.log(`   Reason: ${result.reason}`);
        }
        
        // Test 4: Test cache functionality
        console.log('\n💾 Test 4: Testing cache functionality...');
        console.log('   Clearing cache...');
        clearInfluencerCache();
        
        console.log('   Fetching fresh data...');
        const freshData = await getCurrentTopInfluencers();
        console.log(`   Cache age: ${freshData.cacheInfo.cacheAge}`);
        
        console.log('\n🎉 All tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed with error:', error);
    }
}

// Allow direct execution
if (require.main === module) {
    testTopInfluencerSystem()
        .then(() => {
            console.log('\n✨ Test script finished');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test script failed:', error);
            process.exit(1);
        });
}

module.exports = { testTopInfluencerSystem };
