const express = require('express');
const app = express();

const config = require('./config');
const brokerService = require('./services/broker');
const apiRouter = require('./routes/api');

const PORT = config.SERVER_PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use('/api', apiRouter);
app.use((req, res) => {
    res.status(404).send({ error: 'Not Found', message: `Cannot ${req.method} ${req.url}` });
});

async function startServer() {
    try {
        console.log('🔄 Attempting to connect to broker...');
        await brokerService.connect();
        console.log('✅ Message Broker connected successfully.');
    } catch (error) {
        console.warn('⚠️  Broker connection failed:', error.message);
        console.warn('⚠️  Server will start without broker connection.');
        console.warn('⚠️  Excel processing will be simulated until broker is available.');
    }

    app.listen(PORT, () => {
        console.log(`🚀 API Gateway running on port ${PORT}`);
        console.log(`Environment: ${config.NODE_ENV}`);
        console.log(`📡 Broker Status: ${brokerService.isConnected() ? 'Connected' : 'Disconnected'}`);
    });
}

startServer();