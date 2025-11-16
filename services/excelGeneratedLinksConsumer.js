const { Client } = require('@stomp/stompjs');
const WebSocket = require('ws');
const config = require('../config');

let stompClient = null;

Object.assign(global, { WebSocket });

/**
 * Servicio para consumir mensajes de la cola excel-generated-links
 */
class ExcelGeneratedLinksConsumer {
    constructor() {
        this.isConnected = false;
        this.subscription = null;
    }

    /**
     * Conecta al broker y se suscribe a la cola excel-generated-links
     */
    async connect() {
        if (this.isConnected) {
            return;
        }

        console.log('ExcelGeneratedLinksConsumer: Connecting to broker...');
        console.log(`ExcelGeneratedLinksConsumer: URL: ${config.BROKER_URL}`);
        
        stompClient = new Client({
            brokerURL: config.BROKER_URL,
            connectHeaders: {
                login: config.BROKER_USER,
                passcode: config.BROKER_PASS,
            },
            reconnectDelay: 5000,
            heartbeatIncoming: 4000,
            heartbeatOutgoing: 4000,
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.warn('ExcelGeneratedLinksConsumer: Connection timeout after 30 seconds');
                console.warn(`ExcelGeneratedLinksConsumer: Failed to connect to ${config.BROKER_URL}`);
                reject(new Error('Broker connection timeout'));
            }, 30000);

            stompClient.onConnect = (frame) => {
                clearTimeout(timeout);
                console.log('ExcelGeneratedLinksConsumer: Connected to broker');
                this.isConnected = true;
                
                // Suscribirse a la cola excel-generated-links
                this.subscribeToExcelGeneratedLinks();
                resolve(stompClient);
            };

            stompClient.onWebSocketError = (event) => {
                clearTimeout(timeout);
                console.error('ExcelGeneratedLinksConsumer: WebSocket error:', event);
                console.error(`ExcelGeneratedLinksConsumer: Failed to connect to ${config.BROKER_URL}`);
                reject(new Error(`WebSocket connection failed: ${event.message || 'Unknown error'}`));
            };

            stompClient.onStompError = (frame) => {
                clearTimeout(timeout);
                console.error('ExcelGeneratedLinksConsumer: STOMP protocol error:', frame);
                reject(new Error(`STOMP connection failed: ${frame.headers?.message || 'Unknown STOMP error'}`));
            };

            stompClient.activate();
        });
    }

    /**
     * Se suscribe a la cola excel-generated-links
     */
    subscribeToExcelGeneratedLinks() {
        const destination = `/queue/${config.JMS_QUEUE_EXCEL_GENERATED_LINKS || 'excel-generated-links'}`;
        
        this.subscription = stompClient.subscribe(destination, (message) => {
            try {
                console.log('=== EXCEL GENERATED LINK RECEIVED ===');
                console.log('Timestamp:', new Date().toISOString());
                console.log('Destination:', destination);
                console.log('Message ID:', message.headers['message-id']);
                console.log('Source:', message.headers['source'] || 'unknown');
                console.log('Message Type:', message.headers['messageType'] || 'unknown');
                console.log('File Name:', message.headers['fileName'] || 'unknown');
                console.log('Original Message ID:', message.headers['originalMessageId'] || 'unknown');
                
                const messageBody = JSON.parse(message.body);
                console.log('Message Body:', JSON.stringify(messageBody, null, 2));
                
                // Procesar el mensaje
                this.processExcelGeneratedLink(messageBody, message.headers);
                
            } catch (error) {
                console.error('ExcelGeneratedLinksConsumer: Error processing message:', error);
                console.error('Message body:', message.body);
            }
        });

        console.log(`ExcelGeneratedLinksConsumer: Subscribed to ${destination}`);
    }

    /**
     * Procesa un mensaje de Excel generado
     * @param {Object} messageBody - Contenido del mensaje
     * @param {Object} headers - Headers del mensaje
     */
    processExcelGeneratedLink(messageBody, headers) {
        try {
            const { downloadUrl, fileName, messageId, timestamp, source, status } = messageBody;
            
            console.log('=== PROCESANDO EXCEL GENERATED LINK ===');
            console.log('Download URL:', downloadUrl);
            console.log('File Name:', fileName);
            console.log('Message ID:', messageId);
            console.log('Source:', source);
            console.log('Status:', status);
            console.log('Timestamp:', timestamp);
            
            // Aquí puedes agregar lógica adicional para procesar el link
            // Por ejemplo, enviar notificaciones, actualizar base de datos, etc.
            
            console.log('✅ Excel generated link processed successfully');
            console.log('📋 Next steps:');
            console.log('   1. Excel file is ready for download');
            console.log('   2. Link is valid for 60 minutes');
            console.log('   3. File can be accessed via the download URL');
            
        } catch (error) {
            console.error('ExcelGeneratedLinksConsumer: Error processing Excel generated link:', error);
        }
    }

    /**
     * Desconecta del broker
     */
    disconnect() {
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }
        
        if (stompClient) {
            stompClient.deactivate();
            stompClient = null;
        }
        
        this.isConnected = false;
        console.log('ExcelGeneratedLinksConsumer: Disconnected from broker');
    }

    /**
     * Verifica si está conectado
     */
    isConnectedToBroker() {
        return this.isConnected && stompClient && stompClient.connected;
    }
}

module.exports = ExcelGeneratedLinksConsumer;
