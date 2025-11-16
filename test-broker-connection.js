const { Client } = require('@stomp/stompjs');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const path = require('path');

// Cargar variables de entorno
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Configurar WebSocket global
Object.assign(global, { WebSocket });

// Configuración del broker
const brokerURL = 'ws://172.193.242.89:61615/stomp';
const brokerUser = process.env.BROKER_USER || 'admin';
const brokerPass = process.env.BROKER_PASS || 'admin';

console.log('🧪 Testing Broker Connection');
console.log('============================');
console.log(`URL: ${brokerURL}`);
console.log(`User: ${brokerUser}`);
console.log(`Pass: ${brokerPass ? '***' : 'NOT SET'}`);
console.log('============================\n');

// Crear cliente STOMP
const client = new Client({
    brokerURL: brokerURL,
    connectHeaders: {
        login: brokerUser,
        passcode: brokerPass,
    },
    reconnectDelay: 5000,
    heartbeatIncoming: 4000,
    heartbeatOutgoing: 4000,
    maxWebSocketFrameSize: 1024 * 1024 * 50,
    maxWebSocketMessageSize: 1024 * 1024 * 50,
    splitLargeFrames: true,
    maxWebSocketChunkSize: 64 * 1024,
});

// Configurar eventos
client.onConnect = (frame) => {
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log('Connected to broker');
    console.log('Frame:', JSON.stringify(frame, null, 2));
    
    // Probar enviar un mensaje de prueba
    console.log('\n📤 Testing message publish...');
    try {
        client.publish({
            destination: '/queue/test',
            body: JSON.stringify({
                message: 'Test message from connection test',
                timestamp: new Date().toISOString()
            }),
            headers: {
                'content-type': 'application/json'
            }
        });
        console.log('✅ Message published successfully to /queue/test');
    } catch (error) {
        console.error('❌ Error publishing message:', error.message);
    }
    
    // Desconectar después de 2 segundos
    setTimeout(() => {
        console.log('\n🔌 Disconnecting...');
        client.deactivate();
        console.log('✅ Test completed successfully');
        process.exit(0);
    }, 2000);
};

client.onStompError = (frame) => {
    console.error('❌ STOMP PROTOCOL ERROR');
    console.error('Error frame:', JSON.stringify(frame, null, 2));
    console.error('Headers:', frame.headers);
    process.exit(1);
};

client.onWebSocketError = (event) => {
    console.error('❌ WEBSOCKET ERROR');
    console.error('Error type:', event.type);
    console.error('Error message:', event.message);
    console.error('Error details:', event);
    process.exit(1);
};

client.onDisconnect = () => {
    console.log('🔌 Disconnected from broker');
};

// Timeout de 30 segundos
const timeout = setTimeout(() => {
    console.error('❌ CONNECTION TIMEOUT');
    console.error('Failed to connect within 30 seconds');
    console.error('This could mean:');
    console.error('  1. The broker is not accessible');
    console.error('  2. The URL format is incorrect');
    console.error('  3. The port is blocked');
    console.error('  4. The broker is not running');
    client.deactivate();
    process.exit(1);
}, 30000);

// Intentar conectar
console.log('🔄 Attempting to connect...\n');
client.activate();

// Manejar cierre del proceso
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Interrupted by user');
    clearTimeout(timeout);
    client.deactivate();
    process.exit(0);
});

