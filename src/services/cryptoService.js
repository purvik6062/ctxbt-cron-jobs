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

            // console.log('PQueue initialized successfully');
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

    async fetchFromMarketCapUrl(coinId) {
        const url = `https://www.coingecko.com/market_cap/${coinId}/usd/24_hours.json`;
        try {
            const response = await fetch(url, { timeout: 60000 });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Error fetching price data for ${coinId}:`, error.message);
            return null;
        }
    }

    async fetchFromPriceChartsUrl(coinId) {
        const url = `https://www.coingecko.com/price_charts/${coinId}/usd/24_hours.json`;
        try {
            const response = await fetch(url, { timeout: 60000 });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Error fetching price data for ${coinId}:`, error.message);
            return null;
        }
    }

    async getHistoricalTokenDataFromCustomEndpoints(coinId, historicalTimestamp, currentTimestamp) {
        try {
            // Convert ISO timestamps to Unix timestamps (milliseconds)
            const historicalUnixMs = new Date(historicalTimestamp).getTime();
            const currentUnixMs = new Date(currentTimestamp).getTime();

            // Validate that timestamps are within the last 24 hours
            const now = Date.now();
            const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
            if (historicalUnixMs < twentyFourHoursAgo || currentUnixMs < twentyFourHoursAgo) {
                throw new Error('Timestamps must be within the last 24 hours for these endpoints.');
            }

            const marketCapData = await this.fetchFromMarketCapUrl(coinId);
            const priceChartsData = await this.fetchFromPriceChartsUrl(coinId);

            // Helper function to find the closest data point to a given timestamp
            const findClosest = (data, targetTimestamp) => {
                if (!data || data.length === 0) return null;
                return data.reduce((prev, curr) => {
                    const prevDiff = Math.abs(prev[0] - targetTimestamp);
                    const currDiff = Math.abs(curr[0] - targetTimestamp);
                    return currDiff < prevDiff ? curr : prev;
                });
            };

            // Extract historical data points
            const historicalPricePoint = findClosest(priceChartsData.stats, historicalUnixMs);
            const historicalMarketCapPoint = findClosest(marketCapData.stats, historicalUnixMs);
            const historicalVolumePoint = findClosest(marketCapData.total_volumes, historicalUnixMs);

            // Extract current data points
            const currentPricePoint = findClosest(priceChartsData.stats, currentUnixMs);
            const currentMarketCapPoint = findClosest(marketCapData.stats, currentUnixMs);
            const currentVolumePoint = findClosest(marketCapData.total_volumes, currentUnixMs);

            // Fetch metadata from the official CoinGecko API
            const metadataResponse = await this.axiosInstance.get(`/coins/${coinId}`, {
                params: {
                    localization: false,
                    tickers: false,
                    market_data: false,
                    community_data: false,
                    developer_data: false,
                    sparkline: false
                }
            });
            const metadata = metadataResponse.data;

            // Extract values, defaulting to 0 if data is unavailable
            const historicalPrice = historicalPricePoint ? historicalPricePoint[1] : 0;
            const currentPrice = currentPricePoint ? currentPricePoint[1] : 0;

            // Calculate price change percentage
            const priceChange = historicalPrice
                ? ((currentPrice - historicalPrice) / historicalPrice * 100).toFixed(4)
                : "0.00";

            // Construct and return the response
            return {
                token: metadata.symbol.toUpperCase(),
                coin_id: coinId,
                id: metadata.id,
                historical_data: {
                    timestamp: historicalTimestamp,
                    price_usd: historicalPrice,
                    market_cap: historicalMarketCapPoint ? historicalMarketCapPoint[1] : 0,
                    total_volume: historicalVolumePoint ? historicalVolumePoint[1] : 0
                },
                current_data: {
                    timestamp: currentTimestamp,
                    price_usd: currentPrice,
                    market_cap: currentMarketCapPoint ? currentMarketCapPoint[1] : 0,
                    total_volume: currentVolumePoint ? currentVolumePoint[1] : 0,
                    price_change_since_historical: priceChange
                },
                metadata: {
                    name: metadata.name,
                    categories: metadata.categories || [],
                    description: metadata.description?.en || ""
                }
            };
        } catch (error) {
            console.error(`Error fetching data for ${coinId}:`, error);
            throw new Error(`Failed to fetch data for coin ID ${coinId}: ${error.message}`);
        }
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
                id: historicalData.id,
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
                        ? ((currentData.market_data.current_price.usd - historicalData.market_data.current_price.usd) / historicalData.market_data.current_price.usd * 100).toFixed(4)
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