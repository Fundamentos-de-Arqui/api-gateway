const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
const environment = process.env.NODE_ENV || 'development';

// Log de variables de entorno cargadas
console.log('📋 Environment variables loaded:');
console.log(`   BROKER_URL: ${process.env.BROKER_URL || 'NOT SET (using default: ws://localhost:61614/stomp)'}`);
console.log(`   BROKER_USER: ${process.env.BROKER_USER || 'NOT SET (using default: guest)'}`);
console.log(`   BROKER_PASS: ${process.env.BROKER_PASS ? '***' : 'NOT SET (using default: guest)'}`);
console.log(`   SERVER_PORT: ${process.env.SERVER_PORT || 'NOT SET (using default: 4000)'}`);
console.log(`   NODE_ENV: ${environment}`);

const config = {
    NODE_ENV: environment,

    SERVER_PORT: process.env.SERVER_PORT || 4000,

    USER_SERVICE_URL: process.env.USER_SERVICE_URL || 'http://localhost:4001',
    ORDER_SERVICE_URL: process.env.ORDER_SERVICE_URL || 'http://localhost:4002',

    BROKER_TYPE: process.env.BROKER_TYPE || 'STOMP',
    BROKER_URL: process.env.BROKER_URL || 'ws://localhost:61614/stomp',
    BROKER_USER: process.env.BROKER_USER || 'guest',
    BROKER_PASS: process.env.BROKER_PASS || 'guest',
    
    // MinIO/S3 Configuration
    S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://localhost:9000',
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || 'admin',
    S3_SECRET_KEY: process.env.S3_SECRET_KEY || 'admin12345',
    S3_BUCKET: process.env.S3_BUCKET || 'my-bucket',
    S3_REGION: process.env.S3_REGION || 'us-east-1',
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE === 'true' || true,
    
    // JMS Queue Names
    JMS_QUEUE_EXCEL_INPUT: process.env.JMS_QUEUE_EXCEL_INPUT || 'excel-input-queue',
    JMS_QUEUE_PATIENT_DATA: process.env.JMS_QUEUE_PATIENT_DATA || 'patient-data-queue',
    JMS_QUEUE_PATIENT_FORM: process.env.JMS_QUEUE_PATIENT_FORM || 'excelParser_patientForm',
    JMS_QUEUE_EXCEL_GENERATED_LINKS: process.env.JMS_QUEUE_EXCEL_GENERATED_LINKS || 'excel-generated-links',
};

if (environment === 'development' && !process.env.USER_SERVICE_URL) {
    console.warn("⚠️ WARNING: USER_SERVICE_URL is not defined in .env. Using default localhost.");
}

module.exports = config;