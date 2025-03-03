// Use dynamic import for p-queue
const axios = require('axios');
const dotenv = require('dotenv');
const { coingeckoApiUrl } = require('../config/config');
dotenv.config();

class CryptoService {
    constructor() {
        // this.baseUrl = 'https://api.coingecko.com/api/v3';
        this.baseUrl = coingeckoApiUrl;
        this.apiKey = process.env.COINGECKO_API_KEY;

        // Configure axios defaults for CoinGecko
        this.axiosInstance = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'x-cg-demo-api-key': this.apiKey
            }
        });

        // Initialize without p-queue, will be set in initQueue
        this.apiQueue = null;
        this.initQueue();

        this.tokenCache = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes

        this.queueStats = {
            pending: 0,
            processed: 0,
            lastWindow: Date.now()
        };

        this.metrics = {
            totalRequests: 0,
            failedRequests: 0,
            cacheHits: 0,
            queueStats: []
        };

        setInterval(() => {
            if (this.apiQueue) {
                this.metrics.queueStats.push({
                    timestamp: new Date().toISOString(),
                    pending: this.apiQueue.pending,
                    processed: this.apiQueue.completed
                });
            }
        }, 60000);
    }

    async initQueue() {
        try {
            // Dynamically import p-queue
            const PQueueModule = await import('p-queue');
            const PQueue = PQueueModule.default;

            this.apiQueue = new PQueue({
                intervalCap: 25, // Keep 5 reqs/minute buffer for safety
                interval: 60 * 1000,
                carryoverConcurrencyCount: true,
                autoStart: true
            });

            console.log('PQueue initialized successfully');
        } catch (error) {
            console.error('Failed to initialize PQueue:', error);
            throw new Error('Failed to initialize queue system');
        }
    }

    async ensureQueueInitialized() {
        if (!this.apiQueue) {
            await this.initQueue();
        }
        return this.apiQueue;
    }

    formatDateForCoinGecko(timestamp) {
        // Convert any timestamp format to DD-MM-YYYY
        const date = new Date(timestamp);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    }

    async getHistoricalTokenData(coinId, historicalTimestamp, currentTimestamp) {
        try {
            const formattedHistoricalDate = this.formatDateForCoinGecko(historicalTimestamp);
            const formattedCurrentDate = this.formatDateForCoinGecko(currentTimestamp);
            console.log(`Fetching historical data for ${coinId} at historical date: ${formattedHistoricalDate} and current date: ${formattedCurrentDate}`);

            // Fetch historical data
            const historicalResponse = await this.axiosInstance.get(`/coins/${coinId}/history`, {
                params: {
                    date: formattedHistoricalDate,
                    localization: false
                }
            });

            // Fetch current data at specified timestamp
            const currentResponse = await this.axiosInstance.get(`/coins/${coinId}/history`, {
                params: {
                    date: formattedCurrentDate,
                    localization: false
                }
            });

            const historicalData = historicalResponse.data;
            const currentData = currentResponse.data;

            // Fallback handling if historical data is missing
            if (!historicalData?.market_data) {
                console.warn(`No historical data found for ${coinId} at ${formattedHistoricalDate}`);
                return this._createFallbackResponse(coinId, historicalTimestamp, currentData);
            }

            return {
                token: historicalData.symbol.toUpperCase(),
                coin_id: coinId,
                historical_data: {
                    timestamp: historicalTimestamp,
                    price_usd: historicalData.market_data.current_price?.usd || 0,
                    market_cap: historicalData.market_data.market_cap?.usd || 0,
                    total_volume: historicalData.market_data.total_volume?.usd || 0
                },
                current_data: {
                    timestamp: currentTimestamp,
                    price_usd: currentData.market_data?.current_price?.usd || 0,
                    market_cap: currentData.market_data?.market_cap?.usd || 0,
                    total_volume: currentData.market_data?.total_volume?.usd || 0,
                    price_change_since_historical: currentData.market_data?.current_price?.usd && historicalData.market_data.current_price?.usd
                        ? ((currentData.market_data.current_price.usd - historicalData.market_data.current_price.usd) / historicalData.market_data.current_price.usd * 100).toFixed(2)
                        : "0.00"
                },
                metadata: {
                    name: historicalData.name,
                    categories: currentData.categories || [],
                    description: currentData.description || ""
                }
            };
        } catch (error) {
            console.error(`Error fetching historical data for ${coinId}:`, error);
            throw new Error(`Failed to fetch historical data for coin ID ${coinId}: ${error.message}`);
        }
    }

    _createFallbackResponse(coinId, historicalTimestamp, currentData) {
        const currentPrice = currentData.market_data?.current_price?.usd || 0;
        return {
            token: currentData.symbol?.toUpperCase() || coinId,
            coin_id: coinId,
            historical_data: {
                timestamp: historicalTimestamp,
                price_usd: currentPrice,
                market_cap: currentData.market_data?.market_cap?.usd || 0,
                total_volume: currentData.market_data?.total_volume?.usd || 0,
                note: "Historical data not available, using current data as fallback"
            },
            current_data: {
                price_usd: currentPrice,
                market_cap: currentData.market_data?.market_cap?.usd || 0,
                total_volume: currentData.market_data?.total_volume?.usd || 0,
                price_change_since_historical: "0.00"
            },
            metadata: {
                name: currentData.name || coinId,
                categories: currentData.categories || [],
                description: currentData.description || ""
            }
        };
    }

    async _getTokenDataWithHistory(coinId, tweetTimestamp) {
        try {
            const currentData = await this.getTokenDataById(coinId);
            const historicalData = await this.getHistoricalTokenData(coinId, tweetTimestamp, currentData);

            // If we couldn't get historical data, return current data with a note
            if (!historicalData || historicalData.error) {
                return {
                    ...currentData,
                    historical_context: {
                        note: "Historical data not available",
                        timestamp: tweetTimestamp,
                        price_usd: currentData.current_price,
                        market_cap: currentData.market_cap,
                        total_volume: currentData.total_volume
                    },
                    price_performance: {
                        price_at_tweet: currentData.current_price,
                        current_price: currentData.current_price,
                        price_change_percentage: "0.00",
                        market_cap_change: "0.00",
                        volume_change: "0.00"
                    }
                };
            }

            return {
                ...currentData,
                historical_context: historicalData.historical_data,
                price_performance: {
                    price_at_tweet: historicalData.historical_data.price_usd,
                    current_price: currentData.current_price,
                    price_change_percentage: historicalData.current_data.price_change_since_tweet,
                    market_cap_change: historicalData.historical_data.market_cap ?
                        ((currentData.market_cap - historicalData.historical_data.market_cap) / historicalData.historical_data.market_cap * 100).toFixed(2) : "0.00",
                    volume_change: historicalData.historical_data.total_volume ?
                        ((currentData.total_volume - historicalData.historical_data.total_volume) / historicalData.historical_data.total_volume * 100).toFixed(2) : "0.00"
                }
            };
        } catch (error) {
            console.error('Error fetching token data with history:', error.message);
            // Return a structured error response instead of throwing
            return {
                error: true,
                coin_id: coinId,
                message: `Failed to fetch token data: ${error.message}`,
                timestamp: tweetTimestamp
            };
        }
    }

    async getTokenDataWithHistory(coinId, historicalTimestamp, currentTimestamp = new Date()) {
        const cacheKey = `${coinId}-${new Date(historicalTimestamp).toISOString().split('T')[0]}-${new Date(currentTimestamp).toISOString().split('T')[0]}`;

        if (this.tokenCache.has(cacheKey)) {
            return this.tokenCache.get(cacheKey);
        }

        await this.ensureQueueInitialized();

        return this.apiQueue.add(async () => {
            try {
                const historicalData = await this.getHistoricalTokenData(coinId, historicalTimestamp, currentTimestamp);

                const response = {
                    ...historicalData,
                    price_performance: {
                        price_at_historical: historicalData.historical_data.price_usd,
                        current_price: historicalData.current_data.price_usd,
                        price_change_percentage: historicalData.current_data.price_change_since_historical,
                        market_cap_change: historicalData.historical_data.market_cap ?
                            ((historicalData.current_data.market_cap - historicalData.historical_data.market_cap) / historicalData.historical_data.market_cap * 100).toFixed(2) : "0.00",
                        volume_change: historicalData.historical_data.total_volume ?
                            ((historicalData.current_data.total_volume - historicalData.historical_data.total_volume) / historicalData.historical_data.total_volume * 100).toFixed(2) : "0.00"
                    }
                };

                this.tokenCache.set(cacheKey, response);
                setTimeout(() => this.tokenCache.delete(cacheKey), this.cacheTTL);
                return response;
            } catch (error) {
                if (error.response?.status === 429) {
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    return this.getTokenDataWithHistory(coinId, historicalTimestamp, currentTimestamp);
                }
                throw error;
            }
        });
    }

    async getTokenDataById(coinId) {
        await this.ensureQueueInitialized();

        return this.apiQueue.add(async () => {
            try {
                // Direct fetch using coin ID without symbol resolution
                const marketResponse = await this.axiosInstance.get('/coins/markets', {
                    params: {
                        vs_currency: 'usd',
                        ids: coinId,
                        order: 'market_cap_desc',
                        per_page: 1,
                        page: 1,
                        sparkline: false,
                        price_change_percentage: '24h'
                    }
                });

                if (!marketResponse.data || marketResponse.data.length === 0) {
                    throw new Error(`No market data found for coin ID ${coinId}`);
                }

                const marketData = marketResponse.data[0];

                // Get additional data using /coins/{id} endpoint
                const detailResponse = await this.axiosInstance.get(`/coins/${coinId}`, {
                    params: {
                        localization: false,
                        tickers: false,
                        market_data: true,
                        community_data: false,
                        developer_data: false,
                        sparkline: false
                    }
                });

                const detailData = detailResponse.data;

                return {
                    token: marketData.symbol.toUpperCase(),
                    coin_id: coinId,
                    current_price: marketData.current_price,
                    price_change_24h_percentage: marketData.price_change_percentage_24h,
                    market_cap: marketData.market_cap,
                    total_volume: marketData.total_volume,
                    high_24h: marketData.high_24h,
                    low_24h: marketData.low_24h,
                    price_timestamp: new Date().toISOString(),
                    additional_metrics: {
                        market_cap_rank: marketData.market_cap_rank,
                        total_supply: marketData.total_supply,
                        circulating_supply: marketData.circulating_supply,
                        max_supply: marketData.max_supply,
                        ath: marketData.ath,
                        ath_date: marketData.ath_date,
                        atl: marketData.atl,
                        atl_date: marketData.atl_date
                    },
                    market_details: {
                        market_cap_change_24h_percentage: marketData.market_cap_change_percentage_24h,
                        fully_diluted_valuation: marketData.fully_diluted_valuation,
                        price_change_24h: marketData.price_change_24h,
                        categories: detailData.categories,
                        description: detailData.description?.en,
                        sentiment_votes_up_percentage: detailData.sentiment_votes_up_percentage,
                        sentiment_votes_down_percentage: detailData.sentiment_votes_down_percentage
                    }
                };
            } catch (error) {
                console.error('Error fetching token data:', error);
                throw new Error(`Failed to fetch data for coin ID ${coinId}: ${error.message}`);
            }
        });
    }

    async getPriceRangeData(coinId, startTimestamp, endTimestamp, interval = 'daily') {
        try {
            const startDate = new Date(startTimestamp);
            const endDate = new Date(endTimestamp);

            // Calculate number of days between timestamps
            const diffTime = Math.abs(endDate - startDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Determine sampling frequency based on interval
            let samplePoints;
            switch (interval.toLowerCase()) {
                case 'hourly':
                    samplePoints = Math.min(diffDays * 24, 1000); // Cap at reasonable limit
                    break;
                case 'daily':
                    samplePoints = Math.min(diffDays, 365); // Cap at 1 year
                    break;
                case 'weekly':
                    samplePoints = Math.min(Math.ceil(diffDays / 7), 52); // Cap at 1 year
                    break;
                case 'monthly':
                    samplePoints = Math.min(Math.ceil(diffDays / 30), 12); // Cap at 1 year
                    break;
                default:
                    samplePoints = diffDays;
            }

            // Calculate dates to sample
            const datesToSample = [];
            const timeStep = diffTime / (samplePoints - 1 || 1);

            for (let i = 0; i < samplePoints; i++) {
                const sampleDate = new Date(startDate.getTime() + (i * timeStep));
                if (sampleDate <= endDate) {
                    datesToSample.push(this.formatDateForCoinGecko(sampleDate));
                }
            }

            // Fetch data for all sample points
            const priceDataPromises = datesToSample.map(date =>
                this.axiosInstance.get(`/coins/${coinId}/history`, {
                    params: {
                        date,
                        localization: false
                    }
                }).then(response => ({
                    date,
                    price: response.data.market_data?.current_price?.usd || 0
                }))
            );

            const priceData = await Promise.all(priceDataPromises);

            // Find highest price
            const prices = priceData.filter(d => d.price > 0).map(d => d.price);
            const highestPrice = prices.length > 0 ? Math.max(...prices) : 0;
            const highestPriceDate = priceData.find(d => d.price === highestPrice)?.date;

            return {
                coin_id: coinId,
                start_timestamp: startTimestamp,
                end_timestamp: endTimestamp,
                interval,
                highest_price: highestPrice,
                highest_price_date: highestPriceDate,
                sample_points: priceData.length,
                price_history: priceData
            };
        } catch (error) {
            console.error(`Error fetching price range data for ${coinId}:`, error);
            throw new Error(`Failed to fetch price range data: ${error.message}`);
        }
    }

    async getHighestPriceBetweenDates(coinId, startTimestamp, endTimestamp, interval = 'daily') {
        const cacheKey = `${coinId}-range-${new Date(startTimestamp).toISOString().split('T')[0]}-${new Date(endTimestamp).toISOString().split('T')[0]}-${interval}`;

        if (this.tokenCache.has(cacheKey)) {
            return this.tokenCache.get(cacheKey);
        }

        await this.ensureQueueInitialized();

        return this.apiQueue.add(async () => {
            try {
                const data = await this.getPriceRangeData(coinId, startTimestamp, endTimestamp, interval);
                this.tokenCache.set(cacheKey, data);
                setTimeout(() => this.tokenCache.delete(cacheKey), this.cacheTTL);
                return data;
            } catch (error) {
                if (error.response?.status === 429) {
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    return this.getHighestPriceBetweenDates(coinId, startTimestamp, endTimestamp, interval);
                }
                throw error;
            }
        });
    }

    clearCache() {
        this.tokenCache.clear();
    }
}

module.exports = CryptoService;