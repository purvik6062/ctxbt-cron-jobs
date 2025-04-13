const { startCronJobs } = require('../jobs');

jest.mock('node-cron', () => ({
  schedule: jest.fn().mockImplementation((schedule, callback) => {
    return {
      start: jest.fn(),
      stop: jest.fn()
    };
  })
}));

describe('Cron Jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('startCronJobs should schedule all required jobs', () => {
    const cron = require('node-cron');
    startCronJobs();
    
    // Verify that cron.schedule was called the expected number of times
    expect(cron.schedule).toHaveBeenCalledTimes(4);
  });
}); 