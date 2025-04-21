const pnlNormalizationService = require('../pnlNormalizationService');
const { getDb } = require('../../db/connection');

// Mock the database connection
jest.mock('../../db/connection', () => ({
    getDb: jest.fn()
}));

// Mock the processCSV function
jest.mock('../process-signal-multi-strategies', () => ({
    processCSV: jest.fn()
}));

describe('PnLNormalizationService', () => {
    let mockDb;
    let mockCollection;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup mock database
        mockCollection = {
            find: jest.fn().mockReturnThis(),
            toArray: jest.fn(),
            insertOne: jest.fn(),
            bulkWrite: jest.fn()
        };

        mockDb = {
            collection: jest.fn().mockReturnValue(mockCollection)
        };

        getDb.mockResolvedValue(mockDb);
    });

    describe('calculateWeeklyPnL', () => {
        it('should calculate and store weekly PnL correctly', async () => {
            // Mock CSV data
            const mockPnLData = [
                { account: 'account1', pnl: '100' },
                { account: 'account2', pnl: '200' },
                { account: 'account1', pnl: '50' }
            ];

            require('../process-signal-multi-strategies').processCSV
                .mockResolvedValue(mockPnLData);

            await pnlNormalizationService.calculateWeeklyPnL();

            // Verify database operations
            expect(mockCollection.insertOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    timestamp: expect.any(Date),
                    data: {
                        account1: 150,
                        account2: 200
                    }
                })
            );
        });
    });

    describe('normalizePnL', () => {
        it('should update impact factors correctly', async () => {
            const accountPnL = {
                account1: 150,
                account2: 200
            };

            // Mock existing impact factors
            mockCollection.find.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                    { account: 'account1', impactFactor: 1.0 },
                    { account: 'account2', impactFactor: 1.0 }
                ])
            });

            await pnlNormalizationService.normalizePnL(accountPnL);

            // Verify bulk update was called
            expect(mockCollection.bulkWrite).toHaveBeenCalled();
            
            // Verify the number of updates
            const bulkWriteCalls = mockCollection.bulkWrite.mock.calls[0][0];
            expect(bulkWriteCalls.length).toBe(2);
        });
    });

    describe('processWeeklyNormalization', () => {
        it('should complete the full normalization process', async () => {
            // Mock the entire process
            const mockPnLData = [
                { account: 'account1', pnl: '100' },
                { account: 'account2', pnl: '200' }
            ];

            require('../process-signal-multi-strategies').processCSV
                .mockResolvedValue(mockPnLData);

            mockCollection.find.mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                    { account: 'account1', impactFactor: 1.0 },
                    { account: 'account2', impactFactor: 1.0 }
                ])
            });

            const result = await pnlNormalizationService.processWeeklyNormalization();

            // Verify the process completed
            expect(result).toBeDefined();
            expect(result.length).toBe(2);
        });
    });
}); 