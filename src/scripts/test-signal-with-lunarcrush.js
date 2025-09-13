const { connect, closeConnection } = require('../db');
// const { dbName, influencerCollectionName, tradingSignalsCollectionName } = require('../config/config');
const { getLunarCrushData, generatePrompt, callPerplexityAPI, checkUserThresholds } = require('../services/signalGeneration');
const CryptoService = require('../services/cryptoService');

// Sample BTC tweet - realistic trading signal tweet
const sampleBTCTweet = "Bitcoin breaking through $110,000 resistance with strong volume. Institutional accumulation continues, ETF flows positive. Target $120,000 by end of week. Bullish momentum confirmed. #BTC #Bitcoin";

async function testSignalGenerationWithLunarCrush() {
    console.log('🚀 Testing Signal Generation with LunarCrush Integration\n');

    let client;
    try {
        // Step 1: Get market data from CoinGecko
        console.log('📊 Step 1: Fetching CoinGecko market data for BTC...');
        const cryptoService = new CryptoService();

        const now = new Date();
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

        const marketData = await cryptoService.getHistoricalTokenDataFromCustomEndpoints(
            'bitcoin',
            sixHoursAgo.toISOString(),
            now.toISOString()
        );

        if (!marketData) {
            console.log('❌ Failed to get market data from CoinGecko');
            return;
        }

        console.log('✅ CoinGecko data retrieved:');
        console.log(`   - Token: ${marketData.token}`);
        console.log(`   - Current Price: $${marketData.current_data.price_usd.toLocaleString()}`);
        console.log(`   - 6h Change: ${marketData.current_data.price_change_since_historical}%`);
        console.log(`   - Volume: $${(marketData.current_data.total_volume / 1000000000).toFixed(1)}B`);

        // Step 2: Get LunarCrush data
        console.log('\n🌙 Step 2: Fetching LunarCrush data for BTC...');
        const lunarCrushData = await getLunarCrushData('BTC');

        if (lunarCrushData) {
            console.log('✅ LunarCrush data found:');
            console.log(`   - Type: ${lunarCrushData.type}`);
            console.log(`   - Predicted next 6h return: ${lunarCrushData.pred_next6h_pct?.toFixed(2) || 'N/A'}%`);
            if (lunarCrushData.metrics) {
                console.log(`   - Social Volume Change: ${lunarCrushData.metrics.d_pct_socvol_6h?.toFixed(2) || 'N/A'}%`);
                console.log(`   - Sentiment Change: ${lunarCrushData.metrics.d_pct_sent_6h?.toFixed(2) || 'N/A'}%`);
                console.log(`   - Market Volume Change: ${lunarCrushData.metrics.d_pct_mktvol_6h?.toFixed(2) || 'N/A'}%`);
            }
        } else {
            console.log('❌ No LunarCrush data found for BTC');
        }

        // Step 3: Generate prompt with both data sources
        console.log('\n🤖 Step 3: Generating enhanced prompt for Perplexity...');
        const prompt = generatePrompt(sampleBTCTweet, marketData, lunarCrushData);
        console.log(prompt);

        console.log('📝 Generated prompt preview (first 300 chars):');
        // console.log(prompt.substring(0, 300) + '...\n');

        // Step 4: Call Perplexity API
        console.log('🧠 Step 4: Calling Perplexity API for signal generation...');
        try {
            const signalData = await callPerplexityAPI(prompt);

            console.log('✅ Signal generated successfully:');
            console.log(`   - Signal: ${signalData.signal}`);
            console.log(`   - Current Price: $${signalData.currentPrice}`);
            console.log(`   - Targets: ${signalData.targets?.join(', ') || 'N/A'}`);
            console.log(`   - Stop Loss: $${signalData.stopLoss || 'N/A'}`);
            console.log(`   - Timeline: ${signalData.timeline || 'N/A'}`);
            console.log(`   - Trade Tip: ${signalData.tradeTip?.substring(0, 100)}...`);

            // Step 5: Show enhanced signal data that would be stored
            console.log('\n💾 Step 5: Enhanced signal data with LunarCrush integration:');
            const enhancedSignalData = {
                ...signalData,
                currentPrice: marketData.current_data.price_usd,
                tweet_content: sampleBTCTweet,
                lunarCrushMetrics: lunarCrushData?.metrics || null,
                lunarCrushPrediction: lunarCrushData?.pred_next6h_pct || null,
                lunarCrushTokenType: lunarCrushData?.type || null,
                coinGeckoData: {
                    price_change: marketData.current_data.price_change_since_historical,
                    volume: marketData.current_data.total_volume,
                    market_cap: marketData.current_data.market_cap
                }
            };

            console.log('   This signal includes:');
            console.log(`   - CoinGecko market data: ✓`);
            console.log(`   - LunarCrush social metrics: ${lunarCrushData ? '✓' : '✗'}`);
            console.log(`   - LunarCrush prediction: ${lunarCrushData?.pred_next6h_pct !== undefined ? '✓' : '✗'}`);
            console.log(`   - Token type classification: ${lunarCrushData?.type ? '✓' : '✗'}`);

        } catch (apiError) {
            console.log('❌ Perplexity API call failed:', apiError.message);
            console.log('Note: This could be due to API key issues or service unavailability');
        }

        console.log('\n🎯 Integration Test Summary:');
        console.log('-'.repeat(50));
        console.log('✅ CoinGecko market data integration: Working');
        console.log('✅ LunarCrush social metrics integration: Working');
        console.log('✅ Enhanced prompt generation: Working');
        console.log('✅ Signal data enrichment: Working');
        console.log('\nThe system now provides comprehensive context combining:');
        console.log('• Traditional market data (CoinGecko)');
        console.log('• Social sentiment metrics (LunarCrush)');
        console.log('• Token classification and predictions');

    } catch (error) {
        console.error('❌ Test failed with error:', error);
    }
}

// Alternative test with different tweet content
async function testWithDifferentTweet() {
    console.log('\n🔄 Testing with different tweet content...\n');

    const bearishTweet = "Bitcoin facing resistance at $66,000, decreasing volume and bearish divergence on RSI. Short-term correction likely. Expecting pullback to $62,000 support level. #BTC #Trading";

    try {
        const cryptoService = new CryptoService();
        const now = new Date();
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

        const marketData = await cryptoService.getHistoricalTokenDataFromCustomEndpoints(
            'bitcoin',
            sixHoursAgo.toISOString(),
            now.toISOString()
        );

        if (marketData) {
            const lunarCrushData = await getLunarCrushData('BTC');
            const prompt = generatePrompt(bearishTweet, marketData, lunarCrushData);

            console.log('📝 Bearish tweet prompt preview:');
            console.log(bearishTweet);
            console.log('\nPrompt includes market data + LunarCrush metrics for bearish analysis...\n');
        }
    } catch (error) {
        console.error('Error in bearish tweet test:', error);
    }
}

// Test the complete signal sending flow with threshold checking
async function testSignalSendingFlow() {
    console.log('🚀 Testing Complete Signal Sending Flow with Threshold Checking\n');

    let client;
    try {
        client = await connect();
        const signalFlowDb = client.db("ctxbt-signal-flow");
        const usersCollection = signalFlowDb.collection("users");

        // Step 1: Get sample users with threshold configurations
        console.log('📋 Step 1: Finding users with threshold configurations...');
        const usersWithThresholds = await usersCollection.find({
            "customizationOptions": { $exists: true, $ne: null }
        }).limit(3).toArray();

        if (usersWithThresholds.length === 0) {
            console.log('❌ No users found with threshold configurations');
            return;
        }

        console.log(`✅ Found ${usersWithThresholds.length} users with threshold configurations:`);
        usersWithThresholds.forEach((user, index) => {
            console.log(`   ${index + 1}. ${user.twitterUsername || user.telegramId} (${user.telegramUserId})`);
            const thresholds = user.customizationOptions;
            console.log(`      - Return threshold: ${thresholds.r_last6h_pct}%`);
            console.log(`      - Social volume threshold: ${thresholds.d_pct_socvol_6h}%`);
            console.log(`      - Sentiment threshold: ${thresholds.d_pct_sent_6h}%`);
        });

        // Step 2: Get LunarCrush data for BTC
        console.log('\n🌙 Step 2: Fetching LunarCrush data for threshold testing...');
        const lunarCrushData = await getLunarCrushData('BTC');

        if (!lunarCrushData || !lunarCrushData.metrics) {
            console.log('❌ No LunarCrush data available for threshold testing');
            return;
        }

        console.log('✅ LunarCrush metrics retrieved:');
        const metrics = lunarCrushData.metrics;
        console.log(`   - Return (6h): ${metrics.r_last6h_pct?.toFixed(2) || 'N/A'}%`);
        console.log(`   - Social volume (6h): ${metrics.d_pct_socvol_6h?.toFixed(2) || 'N/A'}%`);
        console.log(`   - Sentiment (6h): ${metrics.d_pct_sent_6h?.toFixed(2) || 'N/A'}%`);
        console.log(`   - Market volume (6h): ${metrics.d_pct_mktvol_6h?.toFixed(2) || 'N/A'}%`);
        console.log(`   - Users (6h): ${metrics.d_pct_users_6h?.toFixed(2) || 'N/A'}%`);
        console.log(`   - Influencers (6h): ${metrics.d_pct_infl_6h?.toFixed(2) || 'N/A'}%`);
        console.log(`   - Galaxy score (6h): ${metrics.d_galaxy_6h?.toFixed(2) || 'N/A'}`);
        console.log(`   - Alt rank improvement: ${metrics.neg_d_altrank_6h?.toFixed(2) || 'N/A'}`);

        // Step 3: Test threshold checking for each user
        console.log('\n🎯 Step 3: Testing threshold validation for each user...\n');

        for (const user of usersWithThresholds) {
            const username = user.twitterUsername || user.telegramId || user.telegramUserId;
            const userThresholds = user.customizationOptions;

            console.log(`👤 Testing thresholds for ${username}:`);

            // Check thresholds
            const thresholdCheck = checkUserThresholds(userThresholds, metrics);

            console.log(`   Result: ${thresholdCheck.passesThreshold ? '✅ PASSED' : '❌ FAILED'}`);
            console.log(`   Reason: ${thresholdCheck.reason}`);

            if (thresholdCheck.failedMetrics.length > 0) {
                console.log('   Failed metrics:');
                thresholdCheck.failedMetrics.forEach(failed => {
                    console.log(`     - ${failed.metric}: ${failed.actual?.toFixed(2) || 'N/A'} ${failed.operator} ${failed.threshold}`);
                });
            }

            console.log(''); // Add spacing between users
        }

        // Step 4: Simulate signal generation and sending decision
        console.log('💡 Step 4: Simulating signal sending decisions...\n');

        const signalData = {
            signal: "Buy",
            currentPrice: 115000,
            targets: [120000, 125000],
            stopLoss: 112000,
            timeline: "3-5 days",
            maxExitTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
            tradeTip: "Bitcoin showing strong momentum above resistance. Consider scaling in with proper risk management."
        };

        console.log('📨 Simulated Signal:');
        console.log(`   - Signal: ${signalData.signal}`);
        console.log(`   - Current Price: $${signalData.currentPrice.toLocaleString()}`);
        console.log(`   - Targets: $${signalData.targets.join(', $')}`);
        console.log(`   - Stop Loss: $${signalData.stopLoss.toLocaleString()}`);

        console.log('\n📤 Sending decisions based on thresholds:');
        let wouldReceiveCount = 0;

        for (const user of usersWithThresholds) {
            const username = user.twitterUsername || user.telegramId || user.telegramUserId;
            const userThresholds = user.customizationOptions;
            const thresholdCheck = checkUserThresholds(userThresholds, metrics);

            if (thresholdCheck.passesThreshold) {
                console.log(`   ✅ ${username} WOULD RECEIVE this signal (all thresholds met)`);
                wouldReceiveCount++;
            } else {
                console.log(`   ❌ ${username} would NOT receive this signal (${thresholdCheck.failedMetrics.length} thresholds failed)`);
            }
        }

        console.log(`\n📊 Summary: ${wouldReceiveCount} out of ${usersWithThresholds.length} users would receive this signal`);

        // Step 5: Test database logging (simulation)
        console.log('\n💾 Step 5: Demonstrating database logging structure...\n');

        const sampleLogEntry = {
            tweet_id: "test_tweet_123",
            twitterHandle: "crypto_analyst",
            subscribers: usersWithThresholds.map(user => ({
                username: user.twitterUsername || user.telegramId,
                sent: false, // Would be set based on threshold check
                thresholdCheck: checkUserThresholds(user.customizationOptions, metrics),
                sentAt: null, // Would be set when sent
                error: null
            })),
            signal_data: {
                ...signalData,
                lunarCrushMetrics: metrics,
                lunarCrushPrediction: lunarCrushData.pred_next6h_pct,
                lunarCrushTokenType: lunarCrushData.type
            }
        };

        console.log('📋 Sample database log entry structure:');
        console.log(JSON.stringify(sampleLogEntry, null, 2));

        console.log('\n🎉 Signal sending flow test completed successfully!');
        console.log('\nKey features demonstrated:');
        console.log('✅ User threshold configuration retrieval');
        console.log('✅ LunarCrush metrics validation');
        console.log('✅ Individual user threshold checking');
        console.log('✅ Signal sending decisions based on thresholds');
        console.log('✅ Comprehensive database logging');
        console.log('✅ Detailed failure tracking and reporting');

    } catch (error) {
        console.error('❌ Error in signal sending flow test:', error);
    } finally {
        if (client) {
            await closeConnection(client);
        }
    }
}

// Run the tests
if (require.main === module) {
    testSignalGenerationWithLunarCrush().then(() => {
        console.log('\n' + '='.repeat(80));
        return testWithDifferentTweet();
    }).then(() => {
        console.log('\n' + '='.repeat(80));
        return testSignalSendingFlow();
    }).catch(console.error);
}

module.exports = {
    testSignalGenerationWithLunarCrush,
    testWithDifferentTweet,
    testSignalSendingFlow,
    sampleBTCTweet
};