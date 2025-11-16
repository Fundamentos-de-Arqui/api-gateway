const { Client } = require('@stomp/stompjs');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const path = require('path');

// Cargar variables de entorno
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Configurar WebSocket global
Object.assign(global, { WebSocket });

const brokerUser = process.env.BROKER_USER || 'admin';
const brokerPass = process.env.BROKER_PASS || 'admin';

// URLs a probar
const urlsToTest = [
    'ws://172.193.242.89:61614',
    'ws://172.193.242.89:61614/',
    'ws://172.193.242.89:61614/ws',
    'ws://172.193.242.89:61614/stomp',
    'ws://172.193.242.89:61615',
    'ws://172.193.242.89:61615/',
    'ws://172.193.242.89:61615/ws',
    'ws://172.193.242.89:61615/stomp',
];

let currentIndex = 0;

function testConnection(url) {
    return new Promise((resolve) => {
        console.log(`\n🧪 Testing URL: ${url}`);
        console.log('─'.repeat(50));
        
        const client = new Client({
            brokerURL: url,
            connectHeaders: {
                login: brokerUser,
                passcode: brokerPass,
            },
            reconnectDelay: 5000,
            heartbeatIncoming: 4000,
            heartbeatOutgoing: 4000,
        });

        let resolved = false;
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.log(`❌ TIMEOUT - No response after 10 seconds`);
                client.deactivate();
                resolve({ url, success: false, error: 'Timeout' });
            }
        }, 10000);

        client.onConnect = (frame) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                console.log(`✅ SUCCESS! Connected to ${url}`);
                console.log(`   Server: ${frame.headers.server || 'Unknown'}`);
                console.log(`   Session: ${frame.headers.session || 'Unknown'}`);
                
                // Probar publicar un mensaje
                try {
                    client.publish({
                        destination: '/queue/test',
                        body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
                        headers: { 'content-type': 'application/json' }
                    });
                    console.log(`   ✅ Message published successfully`);
                } catch (err) {
                    console.log(`   ⚠️  Could not publish: ${err.message}`);
                }
                
                setTimeout(() => {
                    client.deactivate();
                    resolve({ url, success: true });
                }, 1000);
            }
        };

        client.onStompError = (frame) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                console.log(`❌ STOMP ERROR`);
                console.log(`   Message: ${frame.headers?.message || 'Unknown error'}`);
                client.deactivate();
                resolve({ url, success: false, error: `STOMP: ${frame.headers?.message || 'Unknown'}` });
            }
        };

        client.onWebSocketError = (event) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                const errorMsg = event.message || event.type || 'Unknown WebSocket error';
                console.log(`❌ WEBSOCKET ERROR: ${errorMsg}`);
                resolve({ url, success: false, error: errorMsg });
            }
        };

        client.activate();
    });
}

async function runTests() {
    console.log('🧪 Testing Multiple Broker URLs');
    console.log('='.repeat(50));
    console.log(`User: ${brokerUser}`);
    console.log(`Pass: ${brokerPass ? '***' : 'NOT SET'}`);
    console.log('='.repeat(50));

    const results = [];

    for (const url of urlsToTest) {
        const result = await testConnection(url);
        results.push(result);
        
        // Pequeña pausa entre pruebas
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Resumen
    console.log('\n\n📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(50));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
        console.log('\n✅ SUCCESSFUL CONNECTIONS:');
        successful.forEach(r => {
            console.log(`   ✓ ${r.url}`);
        });
    }

    if (failed.length > 0) {
        console.log('\n❌ FAILED CONNECTIONS:');
        failed.forEach(r => {
            console.log(`   ✗ ${r.url} - ${r.error}`);
        });
    }

    if (successful.length === 0) {
        console.log('\n⚠️  No successful connections found!');
        console.log('\n💡 Recommendations:');
        console.log('   1. Verify the transportConnector "ws" is configured for STOMP');
        console.log('   2. Check jetty.xml configuration in ActiveMQ');
        console.log('   3. Verify firewall/NSG rules allow WebSocket connections');
        console.log('   4. Check if ActiveMQ WebSocket endpoint is enabled');
    } else {
        console.log(`\n✅ Found ${successful.length} working URL(s)!`);
        console.log(`\n💡 Use this URL in your .env:`);
        console.log(`   BROKER_URL=${successful[0].url}`);
    }

    process.exit(successful.length > 0 ? 0 : 1);
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

