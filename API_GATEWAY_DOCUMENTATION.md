# API Gateway Documentation

## Overview
API Gateway para el procesamiento de archivos Excel con integración a MinIO y ActiveMQ.

## Endpoints

### Health Check
- **URL:** `GET /api/health`
- **Description:** Verifica el estado del API Gateway
- **Response:**
```json
{
  "status": "ok",
  "message": "API Gateway is online!",
  "timestamp": "2025-10-22T12:00:00.000Z"
}
```

### MinIO Health Check
- **URL:** `GET /api/minio/health`
- **Description:** Verifica la conexión con MinIO
- **Response:**
```json
{
  "status": "ok",
  "message": "MinIO connection successful",
  "endpoint": "http://localhost:9000",
  "bucket": "my-bucket",
  "timestamp": "2025-10-22T12:00:00.000Z"
}
```

### Excel Upload and Process (NUEVO - RECOMENDADO)
- **URL:** `POST /api/excel/upload-and-process`
- **Description:** Sube un archivo Excel y lo procesa automáticamente
- **Content-Type:** `multipart/form-data`
- **Body:**
  - **Key:** `file` (tipo: File)
  - **Value:** Archivo Excel (.xlsx o .xls)

#### Ejemplo con Postman:
1. **Method:** `POST`
2. **URL:** `http://localhost:3001/api/excel/upload-and-process`
3. **Body:** Seleccionar `form-data`
4. **Key:** `file` (dropdown: **File**)
5. **Value:** Seleccionar archivo Excel
6. **Send**

#### Ejemplo con cURL:
```bash
curl -X POST http://localhost:3001/api/excel/upload-and-process \
  -F "file=@mi-archivo.xlsx"
```

#### Response:
```json
{
  "status": "success",
  "message": "Excel file uploaded and processing queued successfully",
  "processingId": "excel-upload-1234567890",
  "fileKey": "uploads/excel-1234567890-abc123.xlsx",
  "fileName": "mi-archivo.xlsx",
  "fileSize": 12345,
  "minioLocation": "http://localhost:9000/my-bucket/uploads/...",
  "timestamp": "2025-10-22T12:00:00.000Z",
  "brokerStatus": "connected",
  "instructions": {
    "note": "File has been automatically uploaded to MinIO and queued for processing",
    "nextSteps": "Check the patient-data-queue for processed results"
  }
}
```

### Excel Presigned URL (MÉTODO ALTERNATIVO)
- **URL:** `POST /api/excel/presigned-url`
- **Description:** Genera una URL presignada para subir archivos a MinIO
- **Body:**
```json
{
  "fileName": "mi-archivo.xlsx"
}
```

#### Response:
```json
{
  "status": "success",
  "presignedUrl": "http://localhost:9000/my-bucket/uploads/...",
  "fileKey": "uploads/excel-1234567890-abc123.xlsx",
  "fileName": "mi-archivo.xlsx",
  "expiresIn": 900,
  "instructions": {
    "method": "PUT",
    "headers": {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    "note": "Upload your Excel file directly to this URL within 15 minutes"
  },
  "automaticProcessing": {
    "enabled": true,
    "delaySeconds": 30,
    "message": "File will be automatically processed 30 seconds after presigned URL generation",
    "note": "No need to call /api/excel/process manually - it will happen automatically!"
  }
}
```

### Excel Process (MÉTODO ALTERNATIVO)
- **URL:** `POST /api/excel/process`
- **Description:** Procesa un archivo Excel usando su fileKey de MinIO
- **Body:**
```json
{
  "fileKey": "uploads/excel-1234567890-abc123.xlsx",
  "fileName": "mi-archivo.xlsx"
}
```

### Test Broker Connection
- **URL:** `POST /api/test-broker-connection`
- **Description:** Prueba la conexión con ActiveMQ
- **Response:**
```json
{
  "status": "accepted",
  "message": "Test message successfully published to broker.",
  "destination": "/queue/test.hello"
}
```

### Add Therapist Profile
- **URL:** `POST /api/profiles-therapist/add-therapist`
- **Description:** Agrega un perfil de terapeuta
- **Body:**
```json
{
  "firstNames": "Juan",
  "paternalSurname": "Pérez",
  "maternalSurname": "García",
  "identityDocumentNumber": "12345678",
  "documentType": "DNI",
  "phone": "987654321",
  "email": "juan.perez@example.com",
  "specialtyName": "Psicología",
  "attentionPlaceAddress": "Av. Principal 123"
}
```

## Configuración

### Variables de Entorno
Crear archivo `.env` en la raíz del proyecto:

```env
# MinIO Configuration
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=admin
S3_SECRET_KEY=admin12345
S3_BUCKET=my-bucket
S3_FORCE_PATH_STYLE=true

# Broker Configuration
BROKER_URL=ws://localhost:61614
BROKER_USER=admin
BROKER_PASS=admin

# Server Configuration
NODE_ENV=development
PORT=3001
```

### Instalación
```bash
npm install
```

### Ejecución
```bash
node index.js
```

## Flujo Recomendado

### Opción 1: Endpoint Único (RECOMENDADO)
1. **POST** `/api/excel/upload-and-process` con archivo Excel
2. **Automático:** Subida a MinIO + Procesamiento

### Opción 2: Flujo con Presigned URL
1. **POST** `/api/excel/presigned-url` → Obtener URL
2. **PUT** presigned URL → Subir archivo
3. **Automático:** Procesamiento después de 30 segundos

## Validaciones

### Archivos Excel
- **Tipos permitidos:** `.xlsx`, `.xls`
- **Tamaño máximo:** 50MB
- **Campo requerido:** `file` (multipart/form-data)

### Respuestas de Error
```json
{
  "status": "error",
  "message": "Error description",
  "details": "Detailed error information"
}
```

## Logs
El API Gateway genera logs detallados para debugging:
- Conexiones de broker
- Subidas a MinIO
- Procesamiento de archivos
- Errores y excepciones