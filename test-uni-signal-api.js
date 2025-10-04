const { getSafeAddressForSpot, sendSignalToSafeAPI } = require('./src/services/signalGeneration');

/**
 * Creates a UNI-specific personalizedSignalData object with realistic prices
 * @returns {Object} - UNI personalized signal data
 */
function createUNIPersonalizedSignalData() {
    return {
        token: "Uniswap (UNI)",
        signal: "Buy",
        currentPrice: 8.45,
        targets: [9.20, 10.50],
        stopLoss: 7.80,
        timeline: "1-2 weeks",
        maxExitTime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks from now
        tradeTip: "UNI showing strong DeFi momentum with potential for 15-20% gains. Key resistance at $9.20, support at $7.80. Consider DCA strategy.",
        tweet_id: "uni_tweet_456",
        tweet_link: "https://twitter.com/defi_analyst/status/123456789",
        tweet_timestamp: new Date().toISOString(),
        priceAtTweet: 8.25,
        exitValue: null,
        twitterHandle: "CryptoReviewing",
        tokenMentioned: "UNI",
        tokenId: "uniswap",
        lunarCrushMetrics: {
            r_last6h_pct: 3.8,
            d_pct_mktvol_6h: 12.5,
            d_pct_socvol_6h: 18.2,
            d_pct_sent_6h: 6.4,
            d_pct_users_6h: 9.8,
            d_pct_infl_6h: 15.3,
            d_galaxy_6h: 2.8,
            neg_d_altrank_6h: -3.2
        },
        lunarCrushPrediction: 5.2,
        lunarCrushTokenType: "defi",
        userWeightages: {
            r_last6h_pct: 85,
            d_pct_mktvol_6h: 70,
            d_pct_socvol_6h: 60,
            d_pct_sent_6h: 75,
            d_pct_users_6h: 65,
            d_pct_infl_6h: 80,
            d_galaxy_6h: 55,
            neg_d_altrank_6h: 70
        },
        personalizedFor: "p_9899"
    };
}

/**
 * Test UNI signal with different scenarios
 */
async function testUNISignal() {
    console.log('🦄 Testing UNI (Uniswap) Signal API...\n');

    const uniSignalData = createUNIPersonalizedSignalData();
    console.log('📊 UNI Signal Data:');
    console.log(`   Token: ${uniSignalData.token}`);
    console.log(`   Signal: ${uniSignalData.signal}`);
    console.log(`   Current Price: $${uniSignalData.currentPrice}`);
    console.log(`   Targets: $${uniSignalData.targets[0]} → $${uniSignalData.targets[1]}`);
    console.log(`   Stop Loss: $${uniSignalData.stopLoss}`);
    console.log(`   Timeline: ${uniSignalData.timeline}`);
    console.log(`   Trade Tip: ${uniSignalData.tradeTip}`);
    console.log('\n' + '='.repeat(80) + '\n');

    const testUsername = "p_9899";

    try {
        console.log(`🔍 Step 1: Getting safe address for user: ${testUsername}`);
        const spotResult = await getSafeAddressForSpot(testUsername);

        if (!spotResult || !spotResult.safeAddress) {
            console.log('❌ No safe address found for user:', testUsername);
            console.log('   Possible reasons:');
            console.log('   - User not found in database');
            console.log('   - No safeConfigs configured');
            console.log('   - No spot type safe configs');
            console.log('   - Missing safeAddress in spot configs');
            return;
        }

        console.log('✅ Safe address found:');
        console.log(`   Address: ${spotResult.safeAddress}`);
        console.log(`   Twitter ID: ${spotResult.twitterId}`);

        console.log('\n' + '='.repeat(80) + '\n');

        console.log(`📤 Step 2: Sending UNI signal to Safe API`);
        console.log('   Signal Details:');
        console.log(`   - Token: ${uniSignalData.tokenMentioned}`);
        console.log(`   - Action: ${uniSignalData.signal}`);
        console.log(`   - Entry: $${uniSignalData.currentPrice}`);
        console.log(`   - TP1: $${uniSignalData.targets[0]} (+${((uniSignalData.targets[0] / uniSignalData.currentPrice - 1) * 100).toFixed(1)}%)`);
        console.log(`   - TP2: $${uniSignalData.targets[1]} (+${((uniSignalData.targets[1] / uniSignalData.currentPrice - 1) * 100).toFixed(1)}%)`);
        console.log(`   - SL: $${uniSignalData.stopLoss} (${((uniSignalData.stopLoss / uniSignalData.currentPrice - 1) * 100).toFixed(1)}%)`);

        const apiResult = await sendSignalToSafeAPI(
            uniSignalData,
            testUsername,
            spotResult.safeAddress,
            spotResult.twitterId
        );

        if (apiResult.success) {
            console.log('\n✅ UNI Signal sent successfully!');
            console.log('📋 API Response:');
            console.log(JSON.stringify(apiResult.response, null, 2));
        } else {
            console.log('\n❌ Failed to send UNI signal:');
            console.log('📋 Error Details:');
            console.log(JSON.stringify(apiResult.error, null, 2));
        }

    } catch (error) {
        console.error('\n💥 Test failed with error:', error.message);
        console.error('Full error:', error);
    }

    console.log('\n' + '='.repeat(80) + '\n');
    console.log('🏁 UNI Signal Test completed!');
}

/**
 * Test with different UNI price scenarios
 */
async function testUNIPriceScenarios() {
    console.log('📈 Testing UNI with different price scenarios...\n');

    const scenarios = [
        {
            name: "Bullish UNI",
            currentPrice: 8.10,
            targets: [9.20, 10.50],
            stopLoss: 7.80,
            signal: "Buy",
            tradeTip: "Strong DeFi momentum, potential 15-20% gains. Key resistance at $9.20."
        },
        {
            name: "Bearish UNI",
            currentPrice: 8.45,
            targets: [7.20, 6.50],
            stopLoss: 9.20,
            signal: "Put Options",
            tradeTip: "UNI facing resistance, potential downside to $7.20. Consider put options strategy."
        },
        {
            name: "Neutral UNI",
            currentPrice: 8.45,
            targets: [8.80, 9.10],
            stopLoss: 8.00,
            signal: "Hold",
            tradeTip: "UNI consolidating, wait for breakout. Support at $8.00, resistance at $9.10."
        }
    ];

    for (const scenario of scenarios) {
        console.log(`\n🧪 Testing: ${scenario.name}`);
        console.log('-'.repeat(50));

        const scenarioData = createUNIPersonalizedSignalData();
        scenarioData.currentPrice = scenario.currentPrice;
        scenarioData.targets = scenario.targets;
        scenarioData.stopLoss = scenario.stopLoss;
        scenarioData.signal = scenario.signal;
        scenarioData.tradeTip = scenario.tradeTip;

        console.log(`   Signal: ${scenario.signal}`);
        console.log(`   Price: $${scenario.currentPrice}`);
        console.log(`   Targets: $${scenario.targets[0]} → $${scenario.targets[1]}`);
        console.log(`   Stop Loss: $${scenario.stopLoss}`);
        console.log(`   Tip: ${scenario.tradeTip}`);

        // You can add actual API testing here if needed
        console.log(`   ✅ ${scenario.name} scenario prepared`);
    }
}

// Run the tests
if (require.main === module) {
    console.log('🚀 Starting UNI Signal Test Suite...\n');

    testUNISignal()
        .then(() => {
            console.log('\n' + '='.repeat(80) + '\n');
            console.log('🔄 Running price scenario tests...\n');
            return testUNIPriceScenarios();
        })
        .then(() => {
            console.log('\n🏁 All UNI tests completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 UNI test suite failed:', error);
            process.exit(1);
        });
}

module.exports = {
    createUNIPersonalizedSignalData,
    testUNISignal,
    testUNIPriceScenarios
};
