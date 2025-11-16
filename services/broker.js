const { Client } = require('@stomp/stompjs');
const WebSocket = require('ws');
const config = require('../config');

let stompClient = null;

Object.assign(global, { WebSocket });

/**
 * Initializes and activates the STOMP client connection to the broker.
 */
async function connect() {
    if (stompClient) {
        return;
    }

    // Log de configuración del broker
    console.log('🔍 Broker Configuration:');
    console.log(`   URL: ${config.BROKER_URL}`);
    console.log(`   User: ${config.BROKER_USER}`);
    console.log(`   Type: ${config.BROKER_TYPE}`);

    stompClient = new Client({
        brokerURL: config.BROKER_URL,
        connectHeaders: {
            login: config.BROKER_USER,
            passcode: config.BROKER_PASS,
        },
        reconnectDelay: 5000,
        heartbeatIncoming: 4000,
        heartbeatOutgoing: 4000,
        // Configuración para mensajes grandes
        maxWebSocketFrameSize: 1024 * 1024 * 50, // 50MB
        maxWebSocketMessageSize: 1024 * 1024 * 50, // 50MB
        // Configuración para dividir frames grandes
        splitLargeFrames: true,
        maxWebSocketChunkSize: 64 * 1024, // 64KB chunks
    });

    return new Promise((resolve, reject) => {
        // Timeout de 30 segundos para la conexión
        const timeout = setTimeout(() => {
            console.warn('STOMP: Connection timeout after 30 seconds');
            console.warn(`STOMP: Failed to connect to ${config.BROKER_URL}`);
            console.warn('STOMP: Check if the broker is running and accessible');
            console.warn('STOMP: Verify the port is correct and firewall is not blocking');
            reject(new Error('Broker connection timeout'));
        }, 30000);

        // Manejo de errores de WebSocket
        stompClient.onWebSocketError = (event) => {
            clearTimeout(timeout);
            console.error('STOMP: WebSocket error occurred');
            console.error(`STOMP: Failed to connect to ${config.BROKER_URL}`);
            console.error('STOMP: Error details:', event.message || event);
            reject(new Error(`WebSocket connection failed: ${event.message || 'Unknown error'}`));
        };

        stompClient.onConnect = (frame) => {
            clearTimeout(timeout);
            console.log('STOMP: Connected to broker successfully');
            console.log(`STOMP: Connected to ${config.BROKER_URL}`);
            resolve(stompClient);
        };

        stompClient.onStompError = (frame) => {
            clearTimeout(timeout);
            console.error('STOMP: STOMP protocol error');
            console.error('STOMP: Error frame:', frame);
            console.error(`STOMP: Failed to connect to ${config.BROKER_URL}`);
            reject(new Error(`STOMP connection failed: ${frame.headers?.message || 'Unknown STOMP error'}`));
        };

        console.log(`STOMP: Attempting to connect to ${config.BROKER_URL}...`);
        stompClient.activate();
    });
}

/**
 * Publishes a message to a specific destination (Queue or Topic).
 * @param {string} destination - The target queue or topic (e.g., '/queue/new.orders').
 * @param {object} payload - The message body (will be stringified to JSON).
 */
function publish(destination, payload) {
    if (!stompClient || !stompClient.connected) {
        console.error('STOMP: Client not connected. Message lost.');
        throw new Error('Broker connection is not active.');
    }

    try {
        const messageBody = JSON.stringify(payload);

        stompClient.publish({
            destination: destination,
            body: messageBody,
            headers: {
                'content-type': 'application/json',
                'persistent': 'true'
            }
        });
        console.log(`STOMP: Published message to ${destination}`);

    } catch (error) {
        console.error('STOMP: Error publishing message:', error);
        throw error;
    }
}

/**
 * Checks if the STOMP client is connected to the broker.
 * @returns {boolean} True if connected, false otherwise.
 */
function isConnected() {
    return stompClient && stompClient.connected;
}

module.exports = {
    connect,
    publish,
    isConnected,
    /**
     * Suscribe a una cola y ejecuta un callback al recibir mensajes
     * @param {string} destination - Cola o tópico (ej: '/queue/excel-generated-links')
     * @param {function} onMessage - Callback que recibe el mensaje
     * @returns {object} subscription - Objeto de suscripción para poder desuscribirse
     */
    subscribe(destination, onMessage) {
        if (!stompClient || !stompClient.connected) {
            throw new Error('Broker connection is not active.');
        }
        
        const subscription = stompClient.subscribe(destination, (message) => {
            try {
                const body = JSON.parse(message.body);
                console.log(`STOMP: Received message from ${destination}:`, body);
                onMessage(body);
            } catch (err) {
                console.error('Error parsing message:', err);
            }
        });
        
        console.log(`STOMP: Subscribed to ${destination}`);
        return subscription;
    },
};