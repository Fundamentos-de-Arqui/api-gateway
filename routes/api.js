const express = require('express');
const router = express.Router();
const brokerService = require('../services/broker');
const minioService = require('../services/minioService');
const ExcelGeneratedLinksConsumer = require('../services/excelGeneratedLinksConsumer');
const config = require('../config');
const multer = require('multer');
const AWS = require('aws-sdk');

// Configurar multer para manejar archivos en memoria
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB límite
    },
    fileFilter: (req, file, cb) => {
        // Solo permitir archivos Excel
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel' ||
            file.originalname.endsWith('.xlsx') ||
            file.originalname.endsWith('.xls')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls)'), false);
        }
    }
});

router.get('/health', (req, res) => {
    res.status(200).send({
        status: 'ok',
        message: 'API Gateway is online!',
        timestamp: new Date().toISOString()
    });
});

// Endpoint para verificar el estado del consumidor de Excel generated links
router.get('/excel/consumer-status', (req, res) => {
    try {
        console.log('=== EXCEL CONSUMER STATUS CHECK ===');
        console.log('Timestamp:', new Date().toISOString());
        
        // Verificar si el consumidor está disponible (se pasa desde index.js)
            const consumerStatus = {
            brokerConnected: brokerService.isConnected(),
            consumerAvailable: global.excelGeneratedLinksConsumer ? true : false,
            consumerConnected: global.excelGeneratedLinksConsumer ? global.excelGeneratedLinksConsumer.isConnectedToBroker() : false,
            queueName: config.JMS_QUEUE_EXCEL_GENERATED_LINKS || 'excel-generated-links',
            timestamp: new Date().toISOString()
        };
        
        console.log('Consumer Status:', JSON.stringify(consumerStatus, null, 2));
        
        if (consumerStatus.brokerConnected && consumerStatus.consumerConnected) {
            res.status(200).send({
                status: 'ok',
                message: 'Excel Generated Links Consumer is active and connected',
                details: consumerStatus
            });
        } else {
            res.status(503).send({
                status: 'warning',
                message: 'Excel Generated Links Consumer is not fully operational',
                details: consumerStatus
            });
        }
        
    } catch (error) {
        console.error('❌ Error checking Excel consumer status:', error.message);
        res.status(500).send({
            status: 'error',
            message: 'Failed to check Excel consumer status',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
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
                endpoint: config.S3_ENDPOINT || 'http://localhost:9000',
                bucket: config.S3_BUCKET || 'my-bucket',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(503).send({
                status: 'error',
                message: 'MinIO connection failed',
                endpoint: config.S3_ENDPOINT || 'http://localhost:9000',
                bucket: config.S3_BUCKET || 'my-bucket',
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

// Endpoint único para subir y procesar Excel automáticamente
router.post('/excel/upload-and-process', upload.single('file'), async (req, res) => {
    console.log('=== EXCEL UPLOAD AND PROCESS ENDPOINT CALLED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request Method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
    
    try {
        // Validar que se recibió un archivo
        if (!req.file) {
            console.log('❌ VALIDATION ERROR: No file received');
            return res.status(400).send({
                status: 'error',
                message: 'No file received',
                details: 'Please upload an Excel file using the "file" field'
            });
        }
        
        const file = req.file;
        console.log('✅ File received successfully');
        console.log('File Info:', {
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            bufferLength: file.buffer.length
        });
        
        // Generar clave única para MinIO
        const fileName = file.originalname || `excel-${Date.now()}.xlsx`;
        const fileKey = minioService.generateUniqueKey(fileName, 'uploads');
        
        console.log(`🔗 Uploading file to MinIO: ${fileName}`);
        console.log(`   Generated key: ${fileKey}`);
        
        // Subir archivo a MinIO precio usando el servicio existente
        const s3 = minioService.s3;
        
        const bucketName = config.S3_BUCKET || 'my-bucket';
        
        const uploadParams = {
            Bucket: bucketName,
            Key: fileKey,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'private'
        };
        
        console.log('📤 Uploading to MinIO...');
        const uploadResult = await s3.upload(uploadParams).promise();
        console.log('✅ File uploaded to MinIO successfully');
        console.log('Upload Result:', uploadResult.Location);
        
        // Obtener información del archivo subido
        const fileInfo = await minioService.getFileInfo(fileKey);
        console.log('📄 File Info from MinIO:', JSON.stringify(fileInfo, null, 2));
        
        // Crear mensaje para la cola
        const processingMessage = {
            fileKey: fileKey,
            fileName: fileName,
            bucket: bucketName,
            fileSize: fileInfo.size,
            contentType: fileInfo.contentType,
            timestamp: new Date().toISOString(),
            source: 'api-gateway-upload',
            metadata: { 
                autoProcessed: true,
                originalName: file.originalname,
                uploadMethod: 'multipart'
            }
        };
        
        const excelInputQueue = `/queue/${config.JMS_QUEUE_EXCEL_INPUT || 'excel-input-queue'}`;
        console.log('📤 Publishing processing message to broker...');
        console.log('Destination:', excelInputQueue);
        console.log('Message Size:', JSON.stringify(processingMessage).length);
        
        if (brokerService.isConnected()) {
            await brokerService.publish(excelInputQueue, processingMessage);
            console.log('✅ Processing message published successfully');
        } else {
            console.log('⚠️  Broker not connected - processing message not sent');
        }
        
        const processingId = `excel-upload-${Date.now()}`;
        console.log('Processing ID:', processingId);
        
        res.status(202).send({
            status: 'success',
            message: brokerService.isConnected() 
                ? 'Excel file uploaded and processing queued successfully'
                : 'Excel file uploaded successfully (broker disconnected)',
            processingId: processingId,
            fileKey: fileKey,
            fileName: fileName,
            fileSize: fileInfo.size,
            minioLocation: uploadResult.Location,
            timestamp: processingMessage.timestamp,
            brokerStatus: brokerService.isConnected() ? 'connected' : 'disconnected',
            instructions: {
                note: 'File has been automatically uploaded to MinIO and queued for processing',
                nextSteps: 'Check the patient-data-queue for processed results'
            }
        });
        
    } catch (error) {
        console.error('❌ FAILED TO UPLOAD AND PROCESS EXCEL:', error.message);
        console.error('Error Stack:', error.stack);
        
        res.status(500).send({
            status: 'error',
            message: 'Failed to upload and process Excel file',
            details: error.message
        });
    }
    
    console.log('=== EXCEL UPLOAD AND PROCESS ENDPOINT COMPLETED ===');
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

// Endpoint para recibir links de Excel generados desde el parser
router.post('/excel/generated-link', async (req, res) => {
    console.log('=== EXCEL GENERATED LINK ENDPOINT CALLED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
    
    try {
        // Validar campos requeridos
        const requiredFields = ['downloadUrl', 'fileName', 'messageId'];
        const missingFields = requiredFields.filter(field => !req.body[field]);
        
        if (missingFields.length > 0) {
            console.log('❌ VALIDATION ERROR: Missing required fields:', missingFields);
            return res.status(400).send({
                status: 'error',
                message: 'Missing required fields',
                missingFields: missingFields,
                requiredFields: requiredFields
            });
        }
        
        const { downloadUrl, fileName, messageId, timestamp, source, status } = req.body;
        
        console.log('✅ VALIDATION PASSED: All required fields received');
        console.log('Download URL:', downloadUrl);
        console.log('File Name:', fileName);
        console.log('Message ID:', messageId);
        console.log('Source:', source || 'unknown');
        console.log('Status:', status || 'unknown');
        
        // Crear respuesta de éxito con información del Excel generado
        const response = {
            status: 'success',
            message: 'Excel file generated and link received successfully',
            generatedExcel: {
                downloadUrl: downloadUrl,
                fileName: fileName,
                messageId: messageId,
                timestamp: timestamp || new Date().toISOString(),
                source: source || 'excel-parser',
                status: status || 'generated',
                expiresIn: '60 minutes',
                instructions: {
                    download: 'Use the downloadUrl to download the generated Excel file',
                    format: 'The Excel file contains structured patient form data',
                    note: 'This file was automatically generated from patient form JSON data'
                }
            },
            processingInfo: {
                originalMessageId: messageId,
                processingTime: new Date().toISOString(),
                nextSteps: 'Excel file is ready for download and use'
            }
        };
        
        console.log('✅ Excel generated link processed successfully');
        console.log('Response:', JSON.stringify(response, null, 2));
        
        res.status(200).send(response);
        
    } catch (error) {
        console.error('❌ FAILED TO PROCESS EXCEL GENERATED LINK:', error.message);
        console.error('Error Stack:', error.stack);
        res.status(500).send({
            status: 'error',
            message: 'Failed to process Excel generated link',
            details: error.message
        });
    }
    
    console.log('=== EXCEL GENERATED LINK ENDPOINT COMPLETED ===');
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
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        
        console.log('✅ Presigned URL generated successfully');
        
        // Programar procesamiento automático después de 30 segundos
        console.log('⏰ Scheduling automatic processing in 30 seconds...');
        setTimeout(async () => {
            try {
                console.log('🔄 Starting automatic processing for file:', fileKey);
                
                // Verificar que el archivo existe en MinIO
                const fileExists = await minioService.fileExists(fileKey);
                
                if (fileExists) {
                    console.log('✅ File found in MinIO, proceeding with automatic processing');
                    
                    // Obtener información del archivo
                    const fileInfo = await minioService.getFileInfo(fileKey);
                    console.log('📄 File Info:', JSON.stringify(fileInfo, null, 2));
                    
                    // Crear mensaje para la cola
                    const processingMessage = {
                        fileKey: fileKey,
                        fileName: fileName,
                        bucket: config.S3_BUCKET || 'my-bucket',
                        fileSize: fileInfo.size,
                        contentType: fileInfo.contentType,
                        timestamp: new Date().toISOString(),
                        source: 'api-gateway-auto',
                        metadata: { autoProcessed: true }
                    };
                    
                    const excelInputQueue = `/queue/${config.JMS_QUEUE_EXCEL_INPUT || 'excel-input-queue'}`;
                    console.log('📤 Publishing automatic processing message to broker...');
                    console.log('Destination:', excelInputQueue);
                    console.log('Message Size:', JSON.stringify(processingMessage).length);
                    
                    if (brokerService.isConnected()) {
                        await brokerService.publish(excelInputQueue, processingMessage);
                        console.log('✅ Automatic processing message published successfully');
                    } else {
                        console.log('⚠️  Broker not connected - automatic processing skipped');
                    }
                } else {
                    console.log('❌ File not found in MinIO after 30 seconds - automatic processing cancelled');
                }
            } catch (error) {
                console.error('❌ Error in automatic processing:', error.message);
            }
        }, 30000); // 30 segundos
        
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
            automaticProcessing: {
                enabled: true,
                delaySeconds: 30,
                message: 'File will be automatically processed 30 seconds after presigned URL generation',
                note: 'No need to call /api/excel/process manually - it will happen automatically!'
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
    
    const destination = `/queue/${config.JMS_QUEUE_EXCEL_INPUT || 'excel-input-queue'}`;
    
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
            bucket: config.S3_BUCKET || 'my-bucket',
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