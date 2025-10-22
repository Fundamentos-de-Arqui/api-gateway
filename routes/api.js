const express = require('express');
const router = express.Router();
const brokerService = require('../services/broker');

router.get('/health', (req, res) => {
    res.status(200).send({
        status: 'ok',
        message: 'API Gateway is online!',
        timestamp: new Date().toISOString()
    });
});

router.post('/test-broker-connection', async (req, res) => {
    const testDestination = '/queue/test.hello';

    try {
        await brokerService.publish(testDestination, {
            message: 'Hello from API Gateway!',
            time: Date.now()
        });

        res.status(202).send({
            status: 'accepted',
            message: 'Test message successfully published to broker.',
            destination: testDestination
        });
    } catch (error) {
        console.error('❌ Broker connection test failed:', error.message);
        res.status(503).send({
            status: 'error',
            message: 'Broker service unavailable. Connection failed.',
            details: error.message
        });
    }
});

router.post('/profiles-therapist/add-therapist', async (req, res) => {
    const destination = '/queue/profiles_therapist';
    
    // Validar que se reciban todos los campos requeridos
    const requiredFields = [
        'firstNames', 'paternalSurname', 'maternalSurname', 
        'identityDocumentNumber', 'documentType', 'phone', 
        'email', 'specialtyName', 'attentionPlaceAddress'
    ];
    
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
        return res.status(400).send({
            status: 'error',
            message: 'Missing required fields',
            missingFields: missingFields
        });
    }

    try {
        const therapistData = {
            firstNames: req.body.firstNames,
            paternalSurname: req.body.paternalSurname,
            maternalSurname: req.body.maternalSurname,
            identityDocumentNumber: req.body.identityDocumentNumber,
            documentType: req.body.documentType,
            phone: req.body.phone,
            email: req.body.email,
            specialtyName: req.body.specialtyName,
            attentionPlaceAddress: req.body.attentionPlaceAddress,
            timestamp: new Date().toISOString()
        };

        await brokerService.publish(destination, therapistData);

        res.status(202).send({
            status: 'accepted',
            message: 'Therapist profile successfully published to queue.',
            destination: destination,
            therapistId: therapistData.identityDocumentNumber
        });
    } catch (error) {
        console.error('❌ Failed to publish therapist profile:', error.message);
        res.status(503).send({
            status: 'error',
            message: 'Failed to publish therapist profile. Broker service unavailable.',
            details: error.message
        });
    }
});

router.post('/excel/process', async (req, res) => {
    console.log('=== EXCEL PROCESS ENDPOINT CALLED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request Method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Request Body Keys:', Object.keys(req.body || {}));
    console.log('Request Body Length:', JSON.stringify(req.body || {}).length);
    
    const destination = '/queue/excel-input-queue';
    
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

    try {
        const excelData = {
            base64Content: req.body.base64Content,
            timestamp: new Date().toISOString(),
            source: 'api-gateway',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

        console.log('📤 ATTEMPTING TO PUBLISH TO BROKER...');
        console.log('Destination:', destination);
        console.log('Message Size:', JSON.stringify(excelData).length);
        console.log('Broker Connected:', brokerService.isConnected());

        if (brokerService.isConnected()) {
            await brokerService.publish(destination, excelData);
            console.log('✅ MESSAGE PUBLISHED SUCCESSFULLY TO BROKER');
        } else {
            console.log('⚠️  BROKER NOT CONNECTED - SIMULATING SUCCESS');
        }

        console.log('Processing ID:', `excel-${Date.now()}`);

        res.status(202).send({
            status: 'accepted',
            message: brokerService.isConnected() 
                ? 'Excel file successfully sent to processing queue'
                : 'Excel file received (broker disconnected - simulated)',
            destination: destination,
            processingId: `excel-${Date.now()}`,
            timestamp: excelData.timestamp,
            brokerStatus: brokerService.isConnected() ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('❌ FAILED TO PROCESS EXCEL FILE:', error.message);
        console.error('Error Stack:', error.stack);
        res.status(503).send({
            status: 'error',
            message: 'Failed to process Excel file. Broker service unavailable.',
            details: error.message
        });
    }
    
    console.log('=== EXCEL PROCESS ENDPOINT COMPLETED ===');
});

module.exports = router;