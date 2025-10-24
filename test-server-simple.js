const express = require('express');
const app = express();

const PORT = 3001;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/api/health', (req, res) => {
    res.status(200).send({
        status: 'ok',
        message: 'API Gateway is online!',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Gateway running on port ${PORT}`);
    console.log(`📡 Server started successfully`);
});

console.log('Server starting...');
