const express = require('express');
const app = express();

const PORT = 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Health endpoint
app.get('/api/health', (req, res) => {
    res.status(200).send({
        status: 'ok',
        message: 'API Gateway is online!',
        timestamp: new Date().toISOString()
    });
});

// Excel processing endpoint (simplified)
app.post('/api/excel/process', (req, res) => {
    console.log('=== EXCEL PROCESS ENDPOINT CALLED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request Method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Request Body Keys:', Object.keys(req.body || {}));
    console.log('Request Body Length:', JSON.stringify(req.body || {}).length);
    
    // Validar que se reciba el base64 del Excel
    if (!req.body.base64Content) {
        console.log('❌ VALIDATION ERROR: Missing base64Content field');
        return res.status(400).send({
            status: 'error',
            message: 'Missing required field: base64Content',
            details: 'The request body must contain a base64Content field with the Excel file encoded in base64'
        });
    }

    // Validar que el base64Content no esté vacío
    if (typeof req.body.base64Content !== 'string' || req.body.base64Content.trim() === '') {
        console.log('❌ VALIDATION ERROR: Empty or invalid base64Content');
        return res.status(400).send({
            status: 'error',
            message: 'Invalid base64Content',
            details: 'The base64Content field must be a non-empty string'
        });
    }

    console.log('✅ VALIDATION PASSED: base64Content received');
    console.log('Base64 Content Length:', req.body.base64Content.length);
    console.log('Base64 Content Preview:', req.body.base64Content.substring(0, 50) + '...');

    // Simular éxito sin broker
    console.log('✅ SIMULATED SUCCESS (no broker connection)');
    
    res.status(202).send({
        status: 'accepted',
        message: 'Excel file received successfully (simulated)',
        destination: '/queue/excel-input-queue',
        processingId: `excel-${Date.now()}`,
        timestamp: new Date().toISOString()
    });
    
    console.log('=== EXCEL PROCESS ENDPOINT COMPLETED ===');
});

app.use((req, res) => {
    res.status(404).send({ error: 'Not Found', message: `Cannot ${req.method} ${req.url}` });
});

app.listen(PORT, () => {
    console.log(`🚀 API Gateway running on port ${PORT}`);
    console.log(`Environment: development`);
    console.log('⚠️  Running in SIMPLIFIED mode (no broker connection)');
});
