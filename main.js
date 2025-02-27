// main.js
const { startCronJobs } = require('./src/cron/jobs');

console.log('Initializing Cron Jobs...');
startCronJobs();
