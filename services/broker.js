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
        stompClient.onConnect = (frame) => {
            console.log('STOMP: Connected to broker.');
            resolve(stompClient);
        };

        stompClient.onStompError = (frame) => {
            console.error('STOMP: Broker error:', frame);
            reject(new Error(`STOMP connection failed: ${frame.headers.message}`));
        };

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

module.exports = {
    connect,
    publish,
};