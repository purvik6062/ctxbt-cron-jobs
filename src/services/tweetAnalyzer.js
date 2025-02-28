// src/services/TweetTradingAnalyzer.js
const { OpenAI } = require('openai');
const path = require('path');
const coinsData = require(path.join(__dirname, '../utils/coins.json'));

class TweetTradingAnalyzer {
    constructor(apiKey) {
        this.openai = new OpenAI({ apiKey });
        this.coinsData = new Map();
        this.symbolGroups = new Map();
        this.initializeCoinsData(coinsData);
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

    async analyzeTweet(tweet) {
        try {
            if (!tweet || typeof tweet !== 'string') {
                throw new Error('Invalid tweet format - must be a string');
            }
            const tweetText = tweet;
            const elements = this.extractTradingElements(tweetText);
            const relevantCoins = this.getRelevantCoinsForContext(elements.cashtags);
            const systemPrompt = this.createSystemPrompt(relevantCoins);

            const openAiResponse = await this.getOpenAIAnalysis(systemPrompt, tweetText, elements);

            // Instead of a full analysis object, return only the coins array (tokens)
            if (!openAiResponse.contains_trading_signal || !openAiResponse.tokens) {
                return [];
            }
            return openAiResponse.tokens;
        } catch (error) {
            console.error('Error analyzing tweet:', error);
            return [];
        }
    }

    async getOpenAIAnalysis(systemPrompt, tweet, elements) {
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
Please analyze this tweet in strict JSON format.`
                    }
                ],
                response_format: { type: "json_object" }
            });

            console.log("response", response.choices[0].message.content);

            return response.choices[0].message.content;
        } catch (error) {
            console.error('Error getting OpenAI analysis:', error);
            throw new Error(`OpenAI analysis failed: ${error.message}`);
        }
    }

    createSystemPrompt(relevantCoins) {
        return `You are an expert crypto trading analyst. Analyze the given tweet for coins or tokens being discussed.
When analyzing tokens, use the following reference information to identify the exact token being discussed:
${JSON.stringify(
            relevantCoins.map(coin => ({
                id: coin.id,
                symbol: coin.symbol,
                name: coin.name
            })), null, 2)}
Important guidelines:
[...additional guidelines...]
Respond with a array of coin ids of the discussed coins in the below format: 
coin_ids: ['bitcoin', 'ethereum', 'solana', 'shiba-inu', 'dogecoin']
If no coins are discussed, respond with an empty array: coin_ids: []
`;
    }
}

module.exports = TweetTradingAnalyzer;
