# API Gateway - Excel Processing Integration

## Descripción

El API Gateway actúa como punto de entrada para procesar archivos Excel. Recibe archivos Excel codificados en base64 y los envía a la cola `excel-input-queue` para su procesamiento por el DocExcelParser.

## Flujo de Procesamiento

```
POST /api/excel/process
    ↓
API Gateway (Node.js)
    ↓
excel-input-queue (ActiveMQ)
    ↓
DocExcelParser (WildFly)
    ↓
patient-data-queue (ActiveMQ)
```

## Endpoints Disponibles

### 1. Health Check
```http
GET /api/health
```

**Respuesta:**
```json
{
    "status": "ok",
    "message": "API Gateway is online!",
    "timestamp": "2025-10-22T00:35:00.000Z"
}
```

### 2. Test Broker Connection
```http
POST /api/test-broker-connection
```

**Respuesta:**
```json
{
    "status": "accepted",
    "message": "Test message successfully published to broker.",
    "destination": "/queue/test.hello"
}
```

### 3. Process Excel File ⭐ **NUEVO**
```http
POST /api/excel/process
Content-Type: application/json

{
    "base64Content": "UEsDBBQAAAAIAA..."
}
```

**Respuesta Exitosa (202 Accepted):**
```json
{
    "status": "accepted",
    "message": "Excel file successfully sent to processing queue",
    "destination": "/queue/excel-input-queue",
    "processingId": "excel-1737528900000",
    "timestamp": "2025-10-22T00:35:00.000Z"
}
```

**Respuesta de Error (400 Bad Request):**
```json
{
    "status": "error",
    "message": "Missing required field: base64Content",
    "details": "The request body must contain a base64Content field with the Excel file encoded in base64"
}
```

**Respuesta de Error (503 Service Unavailable):**
```json
{
    "status": "error",
    "message": "Failed to process Excel file. Broker service unavailable.",
    "details": "STOMP connection failed: Connection refused"
}
```

### 4. Add Therapist Profile
```http
POST /api/profiles-therapist/add-therapist
Content-Type: application/json

{
    "firstNames": "Juan",
    "paternalSurname": "Pérez",
    "maternalSurname": "García",
    "identityDocumentNumber": "12345678",
    "documentType": "DNI",
    "phone": "987654321",
    "email": "juan.perez@email.com",
    "specialtyName": "Cardiología",
    "attentionPlaceAddress": "Av. Principal 123"
}
```

## Configuración

### Variables de Entorno
```bash
# Puerto del servidor
SERVER_PORT=3000

# Configuración del broker (ActiveMQ)
BROKER_TYPE=STOMP
BROKER_URL=ws://localhost:61614/stomp
BROKER_USER=guest
BROKER_PASS=guest

# URLs de servicios (opcional)
USER_SERVICE_URL=http://localhost:4001
ORDER_SERVICE_URL=http://localhost:4002
```

### Dependencias
```json
{
    "@stomp/stompjs": "^7.2.1",
    "axios": "^1.12.2",
    "dotenv": "^17.2.3",
    "express": "^5.1.0",
    "ws": "^8.18.3"
}
```

## Instalación y Ejecución

### 1. Instalar Dependencias
```bash
cd api-gateway
npm install
```

### 2. Configurar Variables de Entorno
```bash
# Crear archivo .env
echo "SERVER_PORT=3000" > .env
echo "BROKER_URL=ws://localhost:61614/stomp" >> .env
echo "BROKER_USER=guest" >> .env
echo "BROKER_PASS=guest" >> .env
```

### 3. Ejecutar API Gateway
```bash
npm start
# o
node index.js
```

### 4. Verificar Funcionamiento
```bash
# Health check
curl http://localhost:3000/api/health

# Test broker connection
curl -X POST http://localhost:3000/api/test-broker-connection
```

## Ejemplo de Uso con cURL

### Procesar Archivo Excel
```bash
curl -X POST http://localhost:3000/api/excel/process \
  -H "Content-Type: application/json" \
  -d '{
    "base64Content": "UEsDBBQAAAAIAA..."
  }'
```

### Respuesta Esperada
```json
{
    "status": "accepted",
    "message": "Excel file successfully sent to processing queue",
    "destination": "/queue/excel-input-queue",
    "processingId": "excel-1737528900000",
    "timestamp": "2025-10-22T00:35:00.000Z"
}
```

## Validaciones

### Campo base64Content
- ✅ **Requerido**: El campo `base64Content` es obligatorio
- ✅ **Tipo**: Debe ser un string
- ✅ **Contenido**: No puede estar vacío
- ✅ **Formato**: Debe ser base64 válido

### Estructura del Mensaje Enviado
```json
{
    "base64Content": "string",
    "timestamp": "ISO 8601",
    "source": "api-gateway",
    "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

## Troubleshooting

### Error de Conexión al Broker
```
STOMP: Broker error: Connection refused
```
**Solución**: Verificar que ActiveMQ esté ejecutándose en puerto 61614

### Error de Validación
```
Missing required field: base64Content
```
**Solución**: Incluir el campo `base64Content` en el body del POST

### Error de Procesamiento
```
Failed to process Excel file. Broker service unavailable.
```
**Solución**: Verificar conexión STOMP y que la cola `excel-input-queue` exista

## Logs del Sistema

El API Gateway registra todas las operaciones:
```
[2025-10-22T00:35:00.000Z] POST /api/excel/process
STOMP: Published message to /queue/excel-input-queue
```

## Estado del Proyecto

✅ **Health Check**: Implementado  
✅ **Test Broker**: Implementado  
✅ **Excel Processing**: Implementado  
✅ **Therapist Profile**: Implementado  
✅ **Validaciones**: Implementadas  
✅ **Manejo de Errores**: Implementado  
✅ **Documentación**: Completa
