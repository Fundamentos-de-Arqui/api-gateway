const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
const environment = process.env.NODE_ENV || 'development';

const config = {
    NODE_ENV: environment,

    SERVER_PORT: process.env.SERVER_PORT || 3001,

    USER_SERVICE_URL: process.env.USER_SERVICE_URL || 'http://localhost:4001',
    ORDER_SERVICE_URL: process.env.ORDER_SERVICE_URL || 'http://localhost:4002',

    BROKER_TYPE: process.env.BROKER_TYPE || 'STOMP',
    BROKER_URL: process.env.BROKER_URL || 'ws://localhost:61614/stomp',
    BROKER_USER: process.env.BROKER_USER || 'guest',
    BROKER_PASS: process.env.BROKER_PASS || 'guest',
};

if (environment === 'development' && !process.env.USER_SERVICE_URL) {
    console.warn("⚠️ WARNING: USER_SERVICE_URL is not defined in .env. Using default localhost.");
}

module.exports = config;