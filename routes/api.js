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

module.exports = router;