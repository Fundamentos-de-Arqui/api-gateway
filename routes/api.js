const express = require('express');
const router = express.Router();
const brokerService = require('../services/broker');
const minioService = require('../services/minioService');

router.get('/health', (req, res) => {
    res.status(200).send({
        status: 'ok',
        message: 'API Gateway is online!',
        timestamp: new Date().toISOString()
    });
});

// Endpoint para probar conexión con MinIO
router.get('/minio/health', async (req, res) => {
    try {
        console.log('🔍 Testing MinIO connection...');
        const isConnected = await minioService.testConnection();
        
        if (isConnected) {
            res.status(200).send({
                status: 'ok',
                message: 'MinIO connection successful',
                endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
                bucket: process.env.S3_BUCKET || 'my-bucket',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(503).send({
                status: 'error',
                message: 'MinIO connection failed',
                endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
                bucket: process.env.S3_BUCKET || 'my-bucket',
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('❌ MinIO health check failed:', error.message);
        res.status(503).send({
            status: 'error',
            message: 'MinIO health check failed',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
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

// Endpoint para obtener presigned URL para subir Excel
router.post('/excel/presigned-url', async (req, res) => {
    console.log('=== EXCEL PRESIGNED URL ENDPOINT CALLED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const fileName = req.body.fileName || `excel-${Date.now()}.xlsx`;
        const fileKey = minioService.generateUniqueKey(fileName, 'uploads');
        
        console.log(`🔗 Generating presigned URL for file: ${fileName}`);
        console.log(`   Generated key: ${fileKey}`);
        
        // Generar presigned URL para subida
        const presignedUrl = await minioService.generatePresignedPutUrl(fileKey, {
            expiresIn: 900, // 15 minutos
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            contentLengthRange: { min: 1024, max: 50 * 1024 * 1024 } // 1KB - 50MB
        });
        
        console.log('✅ Presigned URL generated successfully');
        
        res.status(200).send({
            status: 'success',
            presignedUrl: presignedUrl,
            fileKey: fileKey,
            fileName: fileName,
            expiresIn: 900,
            instructions: {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                },
                note: 'Upload your Excel file directly to this URL within 15 minutes'
            },
            nextStep: {
                endpoint: '/api/excel/process',
                method: 'POST',
                body: {
                    fileKey: fileKey,
                    fileName: fileName
                }
            }
        });
        
    } catch (error) {
        console.error('❌ FAILED TO GENERATE PRESIGNED URL:', error.message);
        console.error('Error Stack:', error.stack);
        res.status(500).send({
            status: 'error',
            message: 'Failed to generate presigned URL',
            details: error.message
        });
    }
    
    console.log('=== EXCEL PRESIGNED URL ENDPOINT COMPLETED ===');
});

// Endpoint para procesar Excel (nuevo flujo con MinIO)
router.post('/excel/process', async (req, res) => {
    console.log('=== EXCEL PROCESS ENDPOINT CALLED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request Method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
    
    const destination = '/queue/excel-input-queue';
    
    // Validar campos requeridos
    if (!req.body.fileKey) {
        console.log('❌ VALIDATION ERROR: Missing fileKey field');
        return res.status(400).send({
            status: 'error',
            message: 'Missing required field: fileKey',
            details: 'The request body must contain a fileKey field with the MinIO file key'
        });
    }
    
    const { fileKey, fileName, metadata } = req.body;
    
    console.log('✅ VALIDATION PASSED: fileKey received');
    console.log('File Key:', fileKey);
    console.log('File Name:', fileName || 'N/A');
    
    try {
        // Verificar que el archivo existe en MinIO
        console.log('🔍 Checking if file exists in MinIO...');
        const fileExists = await minioService.fileExists(fileKey);
        
        if (!fileExists) {
            console.log('❌ FILE NOT FOUND in MinIO:', fileKey);
            return res.status(404).send({
                status: 'error',
                message: 'File not found in storage',
                fileKey: fileKey,
                details: 'The specified file does not exist in MinIO storage'
            });
        }
        
        console.log('✅ File exists in MinIO');
        
        // Obtener información del archivo
        const fileInfo = await minioService.getFileInfo(fileKey);
        console.log('📄 File Info:', JSON.stringify(fileInfo, null, 2));
        
        // Crear mensaje para la cola
        const processingMessage = {
            fileKey: fileKey,
            fileName: fileName || fileInfo.key.split('/').pop(),
            bucket: process.env.S3_BUCKET || 'my-bucket',
            fileSize: fileInfo.size,
            contentType: fileInfo.contentType,
            timestamp: new Date().toISOString(),
            source: 'api-gateway',
            metadata: metadata || {}
        };
        
        console.log('📤 ATTEMPTING TO PUBLISH TO BROKER...');
        console.log('Destination:', destination);
        console.log('Message Size:', JSON.stringify(processingMessage).length);
        console.log('Broker Connected:', brokerService.isConnected());
        
        if (brokerService.isConnected()) {
            await brokerService.publish(destination, processingMessage);
            console.log('✅ MESSAGE PUBLISHED SUCCESSFULLY TO BROKER');
        } else {
            console.log('⚠️  BROKER NOT CONNECTED - SIMULATING SUCCESS');
        }
        
        const processingId = `excel-${Date.now()}`;
        console.log('Processing ID:', processingId);
        
        res.status(202).send({
            status: 'accepted',
            message: brokerService.isConnected() 
                ? 'Excel file processing queued successfully'
                : 'Excel file received (broker disconnected - simulated)',
            destination: destination,
            processingId: processingId,
            fileKey: fileKey,
            fileName: fileName || fileInfo.key.split('/').pop(),
            fileSize: fileInfo.size,
            timestamp: processingMessage.timestamp,
            brokerStatus: brokerService.isConnected() ? 'connected' : 'disconnected'
        });
        
    } catch (error) {
        console.error('❌ FAILED TO PROCESS EXCEL FILE:', error.message);
        console.error('Error Stack:', error.stack);
        res.status(503).send({
            status: 'error',
            message: 'Failed to process Excel file. Service unavailable.',
            details: error.message
        });
    }
    
    console.log('=== EXCEL PROCESS ENDPOINT COMPLETED ===');
});

module.exports = router;