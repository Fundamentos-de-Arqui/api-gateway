const express = require('express');
const app = express();

const config = require('./config');
const brokerService = require('./services/broker');
const ExcelGeneratedLinksConsumer = require('./services/excelGeneratedLinksConsumer');
const apiRouter = require('./routes/api');

const PORT = config.SERVER_PORT;

// Instancia del consumidor de Excel generated links
let excelGeneratedLinksConsumer = null;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use('/api', apiRouter);
app.use((req, res) => {
    res.status(404).send({ error: 'Not Found', message: `Cannot ${req.method} ${req.url}` });
});

async function startServer() {
    // Intentar conectar broker primero
    try {
        console.log('🔄 Attempting to connect to broker...');
        await brokerService.connect();
        console.log('✅ Message Broker connected successfully.');
        
        // Inicializar consumidor de Excel generated links
        console.log('🔄 Initializing Excel Generated Links Consumer...');
        excelGeneratedLinksConsumer = new ExcelGeneratedLinksConsumer();
        await excelGeneratedLinksConsumer.connect();
        console.log('✅ Excel Generated Links Consumer connected successfully.');
        
        // Hacer el consumidor global para que esté disponible en las rutas
        global.excelGeneratedLinksConsumer = excelGeneratedLinksConsumer;
        
    } catch (error) {
        console.warn('⚠️  Broker connection failed:', error.message);
        console.warn('⚠️  Server will continue without broker connection.');
        console.warn('⚠️  Excel processing will be simulated until broker is available.');
    }

    // Iniciar servidor después de intentar conectar el broker
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 API Gateway running on port ${PORT}`);
        console.log(`Environment: ${config.NODE_ENV}`);
        console.log(`📡 Server started successfully`);
        console.log(`📋 Available endpoints:`);
        console.log(`   - POST /api/excel/generated-link (for direct HTTP calls)`);
        console.log(`   - Consumer: /queue/${config.JMS_QUEUE_EXCEL_GENERATED_LINKS || 'excel-generated-links'} (for JMS messages)`);
    });
}

startServer();