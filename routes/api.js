const express = require('express');
const router = express.Router();
const brokerService = require('../services/broker');
const minioService = require('../services/minioService');
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
        
        // Subir archivo a MinIO usando el servicio existente
        const s3 = minioService.s3;
        
        const bucketName = process.env.S3_BUCKET || 'my-bucket';
        
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
        
        console.log('📤 Publishing processing message to broker...');
        console.log('Destination: /queue/excel-input-queue');
        console.log('Message Size:', JSON.stringify(processingMessage).length);
        
        if (brokerService.isConnected()) {
            await brokerService.publish('/queue/excel-input-queue', processingMessage);
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
                        bucket: process.env.S3_BUCKET || 'my-bucket',
                        fileSize: fileInfo.size,
                        contentType: fileInfo.contentType,
                        timestamp: new Date().toISOString(),
                        source: 'api-gateway-auto',
                        metadata: { autoProcessed: true }
                    };
                    
                    console.log('📤 Publishing automatic processing message to broker...');
                    console.log('Destination: /queue/excel-input-queue');
                    console.log('Message Size:', JSON.stringify(processingMessage).length);
                    
                    if (brokerService.isConnected()) {
                        await brokerService.publish('/queue/excel-input-queue', processingMessage);
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

module.exports = router;