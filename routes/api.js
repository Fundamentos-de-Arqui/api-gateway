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
    const destination = '/queue/excel-input-queue';
    
    // Validar que se reciba el base64 del Excel
    if (!req.body.base64Content) {
        return res.status(400).send({
            status: 'error',
            message: 'Missing required field: base64Content',
            details: 'The request body must contain a base64Content field with the Excel file encoded in base64'
        });
    }

    // Validar que el base64Content no esté vacío
    if (typeof req.body.base64Content !== 'string' || req.body.base64Content.trim() === '') {
        return res.status(400).send({
            status: 'error',
            message: 'Invalid base64Content',
            details: 'The base64Content field must be a non-empty string'
        });
    }

    try {
        const excelData = {
            base64Content: req.body.base64Content,
            timestamp: new Date().toISOString(),
            source: 'api-gateway',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

        await brokerService.publish(destination, excelData);

        res.status(202).send({
            status: 'accepted',
            message: 'Excel file successfully sent to processing queue',
            destination: destination,
            processingId: `excel-${Date.now()}`,
            timestamp: excelData.timestamp
        });
    } catch (error) {
        console.error('❌ Failed to process Excel file:', error.message);
        res.status(503).send({
            status: 'error',
            message: 'Failed to process Excel file. Broker service unavailable.',
            details: error.message
        });
    }
});

module.exports = router;