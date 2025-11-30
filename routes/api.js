const express = require('express');
const router = express.Router();
const axios = require('axios');
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

// GET /profiles/getExcelData?type=DNI&documentNumber=12345678
router.get('/profiles/getExcelData', async (req, res) => {
    const { type, documentNumber } = req.query;
    if (!type || !documentNumber) {
        return res.status(400).json({
            status: 'error',
            message: 'Faltan parámetros: type y documentNumber son requeridos.'
        });
    }

    try {
        // Asegura conexión al broker
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }
        // Publica en la cola ActiveMQ
        brokerService.publish('/queue/profiles_getExcelData', {
            type,
            documentNumber,
            timestamp: new Date().toISOString()
        });

        // Espera respuesta en la cola excel-generated-links
        let responded = false;
        let subscription = null;
        const timeoutMs = 10000; // 10 segundos
        
        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) {
                    subscription.unsubscribe();
                    console.log('STOMP: Unsubscribed from excel-generated-links due to timeout');
                }
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout esperando respuesta en excel-generated-links.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/excel-generated-links', (msg) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            
            // Desuscribirse inmediatamente después de recibir la respuesta
            if (subscription) {
                subscription.unsubscribe();
                console.log('STOMP: Unsubscribed from excel-generated-links after receiving response');
            }
            
            console.log('Received excel link:', JSON.stringify(msg, null, 2));
            
            // Devuelve solo el downloadUrl
            res.status(200).json({
                downloadUrl: msg.downloadUrl,
                fileName: msg.fileName,
                messageId: msg.messageId,
                timestamp: msg.timestamp,
                source: msg.source,
                status: msg.status
            });
        });
    } catch (error) {
        console.error('Error enviando a la cola:', error);
        res.status(500).json({
            status: 'error',
            message: 'No se pudo enviar a la cola',
            details: error.message
        });
    }
});

// GET /profiles/getPatientProfiles?status=ACTIVE&page_size=10&page=1 - Obtiene perfiles de pacientes
router.get('/profiles/getPatientProfiles', async (req, res) => {
    const { status, page_size, page } = req.query;
    
    try {
        // Asegura conexión al broker
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }
        
        // Prepara el mensaje con los query params
        const requestData = {
            timestamp: new Date().toISOString(),
            requestId: `req-${Date.now()}`
        };
        
        // Agrega los query params si están presentes
        if (status) requestData.status = status;
        if (page_size) requestData.page_size = parseInt(page_size);
        if (page) requestData.page = parseInt(page);
        
        // Publica solicitud en la cola
        brokerService.publish('/queue/patientRecord_getProfiles', requestData);

        // Espera respuesta en la cola apigateway_patientData
        let responded = false;
        let subscription = null;
        const timeoutMs = 15000; // 15 segundos
        
        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) {
                    subscription.unsubscribe();
                    console.log('STOMP: Unsubscribed from apigateway_patientData due to timeout');
                }
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout esperando respuesta de perfiles de pacientes.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_patientData', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            
            // Desuscribirse inmediatamente después de recibir la respuesta
            if (subscription) {
                subscription.unsubscribe();
                console.log('STOMP: Unsubscribed from apigateway_patientData after receiving response');
            }
            
            console.log('Received patient data:', JSON.stringify(data, null, 2));
            
            // Devuelve los datos recibidos con el formato PatientsSummaryWrapperDto
            res.status(200).json({
                status: 'success',
                totalResults: data.totalResults,
                currentPage: data.currentPage,
                maxPage: data.maxPage,
                patients: data.patients,
                timestamp: new Date().toISOString()
            });
        });
        
    } catch (error) {
        console.error('Error obteniendo perfiles de pacientes:', error);
        res.status(500).json({
            status: 'error',
            message: 'No se pudo obtener los perfiles de pacientes',
            details: error.message
        });
    }
});

// GET /profiles/getFiliationFiles?patientId=1&versionNumber=1&orderBy=DESC
router.get('/profiles/getFiliationFiles', async (req, res) => {
    const { patientId, versionNumber, orderBy } = req.query;
    
    // Validar parámetros requeridos
    if (!patientId) {
        return res.status(400).json({
            status: 'error',
            message: 'El parámetro patientId es requerido.'
        });
    }
    
    try {
        // Asegura conexión al broker
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }
        
        // Prepara el mensaje con los parámetros
        const requestData = {
            patientId: parseInt(patientId),
            timestamp: new Date().toISOString(),
            requestId: `req-filiation-${Date.now()}`
        };
        
        // Agrega parámetros opcionales
        if (versionNumber) requestData.versionNumber = parseInt(versionNumber);
        if (orderBy) requestData.orderBy = orderBy;
        
        // Publica solicitud en la cola
        brokerService.publish('/queue/patientRecord_getFilliationFiles', requestData);

        // Espera respuesta en la cola apigateway_filiationFiles
        let responded = false;
        let subscription = null;
        const timeoutMs = 15000; // 15 segundos
        
        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) {
                    subscription.unsubscribe();
                    console.log('STOMP: Unsubscribed from apigateway_filiationFiles due to timeout');
                }
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout esperando respuesta de archivos de filiación.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_filiationFiles', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            
            // Desuscribirse inmediatamente después de recibir la respuesta
            if (subscription) {
                subscription.unsubscribe();
                console.log('STOMP: Unsubscribed from apigateway_filiationFiles after receiving response');
            }
            
            console.log('Received filiation data:', JSON.stringify(data, null, 2));
            
            // Devuelve los datos recibidos del archivo de filiación
            res.status(200).json({
                status: 'success',
                data: data,
                timestamp: new Date().toISOString()
            });
        });
        
    } catch (error) {
        console.error('Error obteniendo archivos de filiación:', error);
        res.status(500).json({
            status: 'error',
            message: 'No se pudo obtener los archivos de filiación',
            details: error.message
        });
    }
});

// POST /register - Registra usuarios (pacientes, terapeutas, representantes legales)
router.post('/register', async (req, res) => {
    try {
        // Validar que se reciban datos
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({
                status: 'error',
                message: 'Se requieren datos en el body de la petición.'
            });
        }

        // Validar campos básicos requeridos
        const { password, identityDocumentNumber, documentType } = req.body;
        if (!password || !identityDocumentNumber || !documentType) {
            return res.status(400).json({
                status: 'error',
                message: 'Los campos password, identityDocumentNumber y documentType son requeridos.'
            });
        }

        // Asegura conexión al broker
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }

        // Envía todos los datos recibidos a la cola profiles_register
        const registrationData = {
            ...req.body,
            timestamp: new Date().toISOString(),
            requestId: `reg-${Date.now()}`
        };

        brokerService.publish('/queue/profiles_register', registrationData);

        // Espera respuesta en la cola iam_register
        let responded = false;
        let subscription = null;
        const timeoutMs = 15000; // 15 segundos
        
        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) {
                    subscription.unsubscribe();
                    console.log('STOMP: Unsubscribed from apigateway_register due to timeout');
                }
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout esperando respuesta del registro de usuario.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_register', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            
            // Desuscribirse inmediatamente después de recibir la respuesta
            if (subscription) {
                subscription.unsubscribe();
                console.log('STOMP: Unsubscribed from apigateway_register after receiving response');
            }
            
            console.log('Received registration response:', JSON.stringify(data, null, 2));
            
            // Devuelve la respuesta del registro
            res.status(201).json({
                status: 'success',
                userId: data.userId,
                accountType: data.accountType,
                email: data.email,
                timestamp: new Date().toISOString()
            });
        });
        
    } catch (error) {
        console.error('Error en el registro de usuario:', error);
        res.status(500).json({
            status: 'error',
            message: 'No se pudo procesar el registro de usuario',
            details: error.message
        });
    }
});

// POST /login - Redirige al servicio IAM para autenticación
router.post('/login', async (req, res) => {
    try {
        const { identityDocumentNumber, password } = req.body;

        // Validar campos requeridos
        if (!identityDocumentNumber || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Los campos identityDocumentNumber y password son requeridos.'
            });
        }

        // Preparar datos para el servicio IAM
        const loginData = {
            identityDocumentNumber,
            password
        };

        // Realizar petición al servicio IAM
        const iamResponse = await axios.post(
            'http://172.193.242.89:8080/IAM-1.0-SNAPSHOT/api/auth/login',
            loginData,
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10 segundos timeout
            }
        );

        // Devolver la respuesta del servicio IAM
        res.status(iamResponse.status).json(iamResponse.data);

    } catch (error) {
        console.error('Error en login:', error);

        // Si es un error de respuesta del servicio IAM
        if (error.response) {
            return res.status(error.response.status).json(error.response.data);
        }

        // Error de conexión u otro
        res.status(500).json({
            status: 'error',
            message: 'Error al conectar con el servicio de autenticación',
            details: error.message
        });
    }
});

// GET /profiles/therapists - Obtiene lista de terapeutas
router.get('/profiles/therapists', async (req, res) => {
    try {
        // Asegura conexión al broker
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }
        
        // Envía solicitud a la cola
        const requestData = {
            timestamp: new Date().toISOString(),
            requestId: `therapists-${Date.now()}`
        };
        
        brokerService.publish('/queue/profiles_therapistProfiles', requestData);

        // Espera respuesta en la cola apigateway_therapistProfiles
        let responded = false;
        let subscription = null;
        const timeoutMs = 15000; // 15 segundos
        
        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) {
                    subscription.unsubscribe();
                    console.log('STOMP: Unsubscribed from apigateway_therapistProfiles due to timeout');
                }
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout esperando respuesta de perfiles de terapeutas.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_therapistProfiles', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            
            // Desuscribirse inmediatamente después de recibir la respuesta
            if (subscription) {
                subscription.unsubscribe();
                console.log('STOMP: Unsubscribed from apigateway_therapistProfiles after receiving response');
            }
            
            console.log('Received therapist profiles:', JSON.stringify(data, null, 2));
            
            // Devuelve el array de terapeutas
            res.status(200).json({
                status: 'success',
                therapists: data,
                timestamp: new Date().toISOString()
            });
        });
        
    } catch (error) {
        console.error('Error obteniendo perfiles de terapeutas:', error);
        res.status(500).json({
            status: 'error',
            message: 'No se pudo obtener los perfiles de terapeutas',
            details: error.message
        });
    }
});

// GET /profiles/legal-responsible - Obtiene lista de representantes legales
router.get('/profiles/legal-responsible', async (req, res) => {
    try {
        // Asegura conexión al broker
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }
        
        // Envía solicitud a la cola
        const requestData = {
            timestamp: new Date().toISOString(),
            requestId: `legal-responsible-${Date.now()}`
        };
        
        brokerService.publish('/queue/profiles_legal-responsibleProfiles', requestData);

        // Espera respuesta en la cola apigateway_legal-responsibleProfiles
        let responded = false;
        let subscription = null;
        const timeoutMs = 15000; // 15 segundos
        
        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) {
                    subscription.unsubscribe();
                    console.log('STOMP: Unsubscribed from apigateway_legal-responsibleProfiles due to timeout');
                }
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout esperando respuesta de representantes legales.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_legal-responsibleProfiles', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            
            // Desuscribirse inmediatamente después de recibir la respuesta
            if (subscription) {
                subscription.unsubscribe();
                console.log('STOMP: Unsubscribed from apigateway_legal-responsibleProfiles after receiving response');
            }
            
            console.log('Received legal responsible profiles:', JSON.stringify(data, null, 2));
            
            // Devuelve el array de representantes legales
            res.status(200).json({
                status: 'success',
                legalResponsible: data,
                timestamp: new Date().toISOString()
            });
        });
        
    } catch (error) {
        console.error('Error obteniendo representantes legales:', error);
        res.status(500).json({
            status: 'error',
            message: 'No se pudo obtener los representantes legales',
            details: error.message
        });
    }
});

// POST /assessments
router.post('/assessments', async (req, res) => {
    const { patientId, therapistId, scheduledTo } = req.body;

    // Basic validation
    if (!patientId || !therapistId || !scheduledTo) {
        return res.status(400).json({
            status: 'error',
            message: 'The parameters patientId, therapistId, and scheduledTo are required.'
        });
    }

    try {
        // Ensure connection to the broker
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }

        // Build the payload for the service
        const requestData = {
            patientId: parseInt(patientId),
            therapistId: parseInt(therapistId),
            scheduledTo: scheduledTo,
            timestamp: new Date().toISOString(),
            requestId: `req-reassessment-${Date.now()}`
        };

        // Publish the request to the service
        brokerService.publish(
            '/queue/scheduling_createReassessmentSession',
            requestData
        );

        // --------------- Wait for response on the queue ---------------
        let responded = false;
        let subscription = null;
        const timeoutMs = 15000;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) subscription.unsubscribe();
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout waiting for response from the session service.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe(
            '/queue/apigateway_reassessmentSessionCreated',
            (data) => {
                if (responded) return;
                responded = true;
                clearTimeout(timeout);

                if (subscription) {
                    subscription.unsubscribe();
                    console.log('STOMP: Unsubscribed after receiving reassessment response');
                }

                console.log('Received reassessment session:', JSON.stringify(data, null, 2));

                // Response to the final client
                res.status(200).json({
                    status: 'success',
                    data: data,
                    timestamp: new Date().toISOString()
                });
            }
        );

    } catch (error) {
        console.error('Error creating assessment session:', error);
        res.status(500).json({
            status: 'error',
            message: 'Could not create assessment session',
            details: error.message
        });
    }
});

// PATCH /assessments/:id/status
router.patch('/assessments/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !status) {
        return res.status(400).json({
            status: 'error',
            message: 'Both id and status are required.'
        });
    }

    try {
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }

        const requestData = {
            assessmentId: parseInt(id),
            status: status,
            timestamp: new Date().toISOString(),
            requestId: `req-update-${Date.now()}`
        };

        // Publicar a la cola del servicio
        brokerService.publish(
            '/queue/scheduling_updateAssessmentStatus',
            requestData
        );

        // ───────────────── WAIT FOR RESPONSE ─────────────────
        let responded = false;
        let subscription = null;
        const timeoutMs = 15000;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) subscription.unsubscribe();
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout waiting for status update response.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe(
            '/queue/apigateway_assessmentStatusUpdated',
            (data) => {
                if (responded) return;
                responded = true;
                clearTimeout(timeout);

                if (subscription) subscription.unsubscribe();

                return res.status(200).json({
                    status: 'success',
                    data: data,
                    timestamp: new Date().toISOString()
                });
            }
        );

    } catch (error) {
        console.error("Error updating assessment:", error);
        res.status(500).json({
            status: 'error',
            message: 'Could not update assessment status',
            details: error.message
        });
    }
});

// /api/assessments
router.get('/assessments', async (req, res) => {
    const { patientId, therapistId, status, scheduledAt } = req.query;
    const page = parseInt(req.query.page || 0);
    const size = parseInt(req.query.size || 10);

    if (isNaN(page) || isNaN(size)) {
        return res.status(400).json({ status: 'error', message: 'page and size are required and must be numbers' });
    }

    try {
        if (!brokerService.isConnected()) await brokerService.connect();

        const requestData = {
            patientId: patientId ? parseInt(patientId) : null,
            therapistId: therapistId ? parseInt(therapistId) : null,
            status: status || null,
            scheduledAt: scheduledAt || null,
            page,
            size,
            requestId: `req-getAssessments-${Date.now()}`,
            timestamp: new Date().toISOString()
        };

        let responded = false;
        let subscription = null;
        const timeoutMs = 15000;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) subscription.unsubscribe();
                return res.status(504).json({ status: 'error', message: 'Timeout waiting for response from assessment service.' });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_assessmentsResponse', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            if (subscription) subscription.unsubscribe();

            res.status(200).json({
                status: 'success',
                data,
                timestamp: new Date().toISOString()
            });
        });

        brokerService.publish('/queue/scheduling_getAssessments', requestData);

    } catch (error) {
        console.error('Error getting assessments:', error);
        res.status(500).json({ status: 'error', message: 'Could not get assessments', details: error.message });
    }
});
// /api/therapy-plans
router.post('/therapy-plans', async (req, res) => {
    const {
        assessmentId,
        description,
        goals,
        assignedTherapistId,
        legalResponsibleId,
        schedule
    } = req.body;

    if (!assessmentId || !description || !goals || !assignedTherapistId || !legalResponsibleId) {
        return res.status(400).json({ status: 'error', message: 'Missing required fields' });
    }

    try {
        if (!brokerService.isConnected()) await brokerService.connect();

        const requestData = {
            assessmentId,
            description,
            goals,
            assignedTherapistId,
            legalResponsibleId,
            schedule: schedule || [],
            requestId: `req-createTherapyPlan-${Date.now()}`,
            timestamp: new Date().toISOString()
        };

        let responded = false;
        let subscription = null;
        const timeoutMs = 15000;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) subscription.unsubscribe();
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout waiting for response from therapy plan service.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_therapyPlanCreated', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            if (subscription) subscription.unsubscribe();

            res.status(201).json({
                status: 'success',
                data,
                timestamp: new Date().toISOString()
            });
        });

        brokerService.publish('/queue/scheduling_createTherapyPlan', requestData);

    } catch (error) {
        console.error('Error creating therapy plan:', error);
        res.status(500).json({ status: 'error', message: 'Could not create therapy plan', details: error.message });
    }
});
// /api/therapy-plans
router.get('/therapy-plans', async (req, res) => {
    const { assessmentId, therapistId, patientId, legalResponsibleId } = req.query;
    const page = parseInt(req.query.page || 0);
    const size = parseInt(req.query.size || 10);

    if (isNaN(page) || isNaN(size)) {
        return res.status(400).json({ status: 'error', message: 'page and size are required and must be numbers' });
    }

    try {
        if (!brokerService.isConnected()) await brokerService.connect();

        const requestData = {
            assessmentId: assessmentId ? parseInt(assessmentId) : null,
            therapistId: therapistId ? parseInt(therapistId) : null,
            patientId: patientId ? parseInt(patientId) : null,
            legalResponsibleId: legalResponsibleId ? parseInt(legalResponsibleId) : null,
            page,
            size,
            requestId: `req-getTherapyPlans-${Date.now()}`,
            timestamp: new Date().toISOString()
        };

        let responded = false;
        let subscription = null;
        const timeoutMs = 15000;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) subscription.unsubscribe();
                return res.status(504).json({ status: 'error', message: 'Timeout waiting for response from therapy plan service.' });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_therapyPlansResponse', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            if (subscription) subscription.unsubscribe();

            res.status(200).json({
                status: 'success',
                data,
                timestamp: new Date().toISOString()
            });
        });

        brokerService.publish('/queue/scheduling_getTherapyPlans', requestData);

    } catch (error) {
        console.error('Error getting therapy plans:', error);
        res.status(500).json({ status: 'error', message: 'Could not get therapy plans', details: error.message });
    }
});

//api/sessions
router.get('/sessions', async (req, res) => {
    const { therapistId, patientId, responsibleLegalId, status } = req.query;
    const page = parseInt(req.query.page || 0);
    const size = parseInt(req.query.size || 10);

    if (isNaN(page) || isNaN(size)) {
        return res.status(400).json({ status: 'error', message: 'page and size must be numbers' });
    }

    try {
        if (!brokerService.isConnected()) await brokerService.connect();

        const requestData = {
            therapistId: therapistId ? parseInt(therapistId) : null,
            patientId: patientId ? parseInt(patientId) : null,
            responsibleLegalId: responsibleLegalId ? parseInt(responsibleLegalId) : null,
            status: status || null,
            page,
            size,
            requestId: `req-getSessions-${Date.now()}`,
            timestamp: new Date().toISOString()
        };

        let responded = false;
        let subscription = null;
        const timeoutMs = 15000;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) subscription.unsubscribe();
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout waiting for response from session service.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/apigateway_getSessions', (data) => {
            if (responded) return;
            responded = true;

            clearTimeout(timeout);
            if (subscription) subscription.unsubscribe();

            res.status(200).json({
                status: 'success',
                data,
                timestamp: new Date().toISOString(),
            });
        });

        brokerService.publish('/queue/scheduling_getSessions', requestData);

    } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(500).json({
            status: 'error',
            message: 'Could not get sessions',
            details: error.message
        });
    }
});

// api/sessions
router.patch('/sessions/status', async (req, res) => {
    const { id, status } = req.body;

    if (!id || !status) {
        return res.status(400).json({ status: 'error', message: 'id and status are required' });
    }

    try {
        if (!brokerService.isConnected()) await brokerService.connect();

        const requestData = {
            id: parseInt(id),
            status,
            requestId: `req-updateSessionStatus-${Date.now()}`,
            timestamp: new Date().toISOString()
        };

        let responded = false;
        let subscription = null;
        const timeoutMs = 15000;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) subscription.unsubscribe();
                return res.status(504).json({
                    status: 'error',
                    message: 'Timeout waiting for response from session service.'
                });
            }
        }, timeoutMs);

        subscription = brokerService.subscribe('/queue/session_statusUpdated', (data) => {
            if (responded) return;
            responded = true;

            clearTimeout(timeout);
            if (subscription) subscription.unsubscribe();

            res.status(200).json({
                status: 'success',
                data,
                timestamp: new Date().toISOString(),
            });
        });

        // Publicar en la cola del servicio que actualiza el status
        brokerService.publish('/queue/session_updateStatus', requestData);

    } catch (error) {
        console.error('Error updating session status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Could not update session status',
            details: error.message
        });
    }
});

// 
router.get("/holidays/:year", async (req, res) => {
  const { year} = req.params;

  try {
    const externalUrl = `https://date.nager.at/api/v3/publicholidays/${year}/PE`;

    const { data } = await axios.get(externalUrl);

    const mapped = data.map(h => ({
      date: h.date,
      name: h.localName
    }));

    return res.json(mapped);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error retrieving holidays" });
  }
});


//GET /clinical-folders/medicalrecords
/**
 * patient id no puede ser nulo
 * 
 * 3 respuestas:
 * 
 * 1. si version number y orderBy es nulo: Devuelve la lista de forma ascendente teniendo como parametros page y size
 * 2. si solo order by es nulo: Devuelve el registro con el version number correspondiente
 * 3. si version number es nulo: Devuelve la lista de la forma designada por el "orderBy" teniendo como parametros page y size 
 */
router.get('/clinical-folders/medical-records/', async (req, res) => {
    const { patientId, versionNumber, orderBy, page, size } = req.body;

    try {
        if (!brokerService.isConnected()) {
            await brokerService.connect();
        }

        // Construccion del mensaje a mandar
        const request = {
            patientId: parseInt(patientId),
            versionNumber: versionNumber ? parseInt(versionNumber) : null,
            orderBy: orderBy ?? null,
            page: page ? parseInt(page) : null,
            size: size ? parseInt(size) : null
        };

        console.log("Sending request:", request);

        // Enviar a la cola de entrada
        brokerService.publish('/queue/apigateway_getMedicalRecord', request);

        // Esperar respuesta
        let responded = false;
        let subscription = null;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                if (subscription) subscription.unsubscribe();
                return res.status(504).json({ 
                    status: 'error',
                    message: 'Timeout esperando respuesta del microservicio Medical History' 
                });
            }
        }, 15000);

        subscription = brokerService.subscribe('/queue/medicalRecord_responseToGateway', (data) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);

            if (subscription) subscription.unsubscribe();

            console.log("Received medical record data:", data);

            // Si el backend devolvió una página
            if (data.totalElements !== undefined) {
                return res.status(200).json({
                    status: "success",
                    mode: "paged",
                    totalElements: data.totalElements,
                    totalPages: data.totalPages,
                    page: data.page,
                    size: data.size,
                    records: data.records
                });
            }

            // Si devolvió un solo record
            return res.status(200).json({
                status: "success",
                mode: "single",
                record: data
            });
        });

    } catch (error) {
        console.error("Error obteniendo historial médico:", error);
        res.status(500).json({
            status: "error",
            message: "No se pudo obtener el historial médico",
            details: error.message
        });
    }
});


module.exports = router;