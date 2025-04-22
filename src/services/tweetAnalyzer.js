// src/services/TweetTradingAnalyzer.js
const { OpenAI } = require('openai');
const path = require('path');
const coinsData = require(path.join(__dirname, '../utils/coins.json'));
const { connect, closeConnection } = require('../db/index');

class TweetTradingAnalyzer {
    constructor(apiKey) {
        this.openai = new OpenAI({ apiKey });
        this.coinsData = new Map();
        this.symbolGroups = new Map();
        this.initializeCoinsData(coinsData);
        this.db = null;
        this.client = null;
    }

    async initialize() {
        // We won't store the client as a property, only use as needed in methods
        const client = await connect();
        this.db = client.db("backtesting_db");
        return client;
    }

    initializeCoinsData(coinsData) {
        coinsData.forEach(coin => {
            this.coinsData.set(coin.id, coin);
            const symbol = coin.symbol.toLowerCase();
            if (!this.symbolGroups.has(symbol)) {
                this.symbolGroups.set(symbol, []);
            }
            this.symbolGroups.get(symbol).push(coin);
        });
    }

    async getImpactFactor(account) {
        try {
            let client = null;
            if (!this.db) {
                client = await this.initialize();
            }
            const impactFactorDoc = await this.db.collection('impact_factors').findOne({ account });

            // Make sure to release the connection if we created one
            if (client) {
                await closeConnection(client);
            }

            return impactFactorDoc ? impactFactorDoc.impactFactor : 1.0; // Default to 1.0 if no impact factor found
        } catch (error) {
            console.error('Error fetching impact factor:', error);
            return 1.0;
        }
    }

    getRelevantCoinsForContext(symbols) {
        const relevantCoins = [];
        for (const symbol of symbols) {
            const symbolLower = symbol.toLowerCase();
            if (this.symbolGroups.has(symbolLower)) {
                const coins = this.symbolGroups.get(symbolLower);
                const sortedCoins = coins.sort((a, b) => {
                    if (a.symbol.toLowerCase() === symbolLower && b.symbol.toLowerCase() !== symbolLower) return -1;
                    if (b.symbol.toLowerCase() === symbolLower && a.symbol.toLowerCase() !== symbolLower) return 1;
                    return a.id.length - b.id.length;
                });
                relevantCoins.push(...sortedCoins.slice(0, 10));
            }
        }
        return relevantCoins;
    }

    extractTradingElements(tweet) {
        const cashtags = [...new Set(tweet.match(/\$([A-Za-z0-9]+)/g) || [])];
        const hashtags = [...new Set(tweet.match(/#(\w+)/g) || [])];
        const mentions = [...new Set(tweet.match(/@(\w+)/g) || [])];
        return {
            cashtags: cashtags.map(tag => tag.substring(1).replace(/[^A-Za-z0-9]/g, '')),
            hashtags: hashtags.map(tag => tag.substring(1)),
            mentions: mentions.map(mention => mention.substring(1))
        };
    }

    async analyzeTweet(tweet, account) {
        try {
            if (!tweet || typeof tweet !== 'string') {
                throw new Error('Invalid tweet format - must be a string');
            }

            const impactFactor = await this.getImpactFactor(account);
            const tweetText = tweet;
            const elements = this.extractTradingElements(tweetText);
            const relevantCoins = this.getRelevantCoinsForContext(elements.cashtags);
            const systemPrompt = this.createSystemPrompt(relevantCoins, impactFactor);

            const openAiResponse = await this.getOpenAIAnalysis(systemPrompt, tweetText, elements, impactFactor);

            console.log("openAiResponse", openAiResponse);

            return openAiResponse;
        } catch (error) {
            console.error('Error analyzing tweet:', error);
            return { coin_ids: [] };
        }
    }

    async getOpenAIAnalysis(systemPrompt, tweet, elements, impactFactor) {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: `Tweet: ${tweet}
Extracted cashtags: ${elements.cashtags.join(', ')}
Extracted hashtags: ${elements.hashtags.join(', ')}
Extracted mentions: ${elements.mentions.join(', ')}
Account Impact Factor: ${impactFactor}
Please analyze this tweet in strict JSON format.`
                    }
                ],
                response_format: { type: "json_object" }
            });

            console.log("response", response.choices[0].message.content);

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Error getting OpenAI analysis:', error);
            throw new Error(`OpenAI analysis failed: ${error.message}`);
        }
    }

    createSystemPrompt(relevantCoins, impactFactor) {
        const confidenceThreshold = this.calculateConfidenceThreshold(impactFactor);

        return `You are an expert crypto trading analyst. Analyze the given tweet for coins or tokens being discussed.
When analyzing tokens, use the following reference information to identify the exact token being discussed:
${JSON.stringify(
            relevantCoins.map(coin => ({
                id: coin.id,
                symbol: coin.symbol,
                name: coin.name
            })), null, 2)}

Important guidelines:
1. Account Impact Factor: ${impactFactor}
2. Confidence Threshold for including trading signals: ${confidenceThreshold}
3. For accounts with higher impact factors (${impactFactor}), be more lenient in including potential trading signals
4. For accounts with lower impact factors, be more strict and only include high-confidence signals
5. Consider the impact factor when determining if a tweet contains actionable trading information
6. Higher impact accounts may have more subtle or indirect trading signals
7. Lower impact accounts require more explicit trading signals
8. Only include coins if your confidence in the trading signal meets or exceeds the confidence threshold (${confidenceThreshold})

Respond with a array of coin ids of the discussed coins in the below format: 
coin_ids: ['bitcoin', 'ethereum', 'solana', 'shiba-inu', 'dogecoin']
If no coins are discussed, respond with an empty array: coin_ids: []
`;
    }

    calculateConfidenceThreshold(impactFactor) {
        // Adjust confidence threshold based on impact factor
        // Higher impact factor = lower threshold (more lenient)
        // Lower impact factor = higher threshold (more strict)
        const baseThreshold = 0.7;
        const adjustment = (impactFactor - 1) * 0.1; // Adjust by 10% per unit of impact factor
        return Math.max(0.3, Math.min(0.9, baseThreshold - adjustment));
    }
}

module.exports = TweetTradingAnalyzer;