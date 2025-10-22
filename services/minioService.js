const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

class MinioService {
    constructor() {
        // Configurar AWS SDK para MinIO
        this.s3 = new AWS.S3({
            endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
            accessKeyId: process.env.S3_ACCESS_KEY || 'admin',
            secretAccessKey: process.env.S3_SECRET_KEY || 'admin12345',
            region: process.env.S3_REGION || 'us-east-1',
            s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' || true,
            signatureVersion: 'v4'
        });
        
        this.bucketName = process.env.S3_BUCKET || 'my-bucket';
        
        console.log('🗂️  MinIO Service initialized:');
        console.log(`   Endpoint: ${process.env.S3_ENDPOINT || 'http://localhost:9000'}`);
        console.log(`   Bucket: ${this.bucketName}`);
        console.log(`   Region: ${process.env.S3_REGION || 'us-east-1'}`);
    }

    /**
     * Genera una presigned URL para subir archivos
     * @param {string} key - Clave del archivo
     * @param {Object} options - Opciones adicionales
     * @returns {Promise<string>} Presigned URL
     */
    async generatePresignedPutUrl(key, options = {}) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: key,
                Expires: options.expiresIn || 900, // 15 minutos por defecto
                ContentType: options.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                ACL: 'private'
            };

            console.log(`🔗 Generating presigned PUT URL for key: ${key}`);
            console.log(`   Expires in: ${params.Expires} seconds`);
            console.log(`   Content-Type: ${params.ContentType}`);

            const presignedUrl = this.s3.getSignedUrl('putObject', params);
            
            console.log(`✅ Presigned URL generated successfully`);
            console.log(`   URL length: ${presignedUrl.length} characters`);
            
            return presignedUrl;
        } catch (error) {
            console.error('❌ Error generating presigned URL:', error.message);
            throw new Error(`Failed to generate presigned URL: ${error.message}`);
        }
    }

    /**
     * Genera una presigned URL para descargar archivos
     * @param {string} key - Clave del archivo
     * @param {number} expiresIn - Segundos hasta expiración
     * @returns {Promise<string>} Presigned URL
     */
    async generatePresignedGetUrl(key, expiresIn = 3600) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: key,
                Expires: expiresIn
            };

            console.log(`🔗 Generating presigned GET URL for key: ${key}`);
            const presignedUrl = this.s3.getSignedUrl('getObject', params);
            
            console.log(`✅ Presigned GET URL generated successfully`);
            return presignedUrl;
        } catch (error) {
            console.error('❌ Error generating presigned GET URL:', error.message);
            throw new Error(`Failed to generate presigned GET URL: ${error.message}`);
        }
    }

    /**
     * Verifica si un archivo existe en el bucket
     * @param {string} key - Clave del archivo
     * @returns {Promise<boolean>} True si existe
     */
    async fileExists(key) {
        try {
            await this.s3.headObject({
                Bucket: this.bucketName,
                Key: key
            }).promise();
            
            console.log(`✅ File exists: ${key}`);
            return true;
        } catch (error) {
            if (error.statusCode === 404) {
                console.log(`❌ File not found: ${key}`);
                return false;
            }
            console.error(`❌ Error checking file existence: ${error.message}`);
            throw error;
        }
    }

    /**
     * Descarga un archivo del bucket
     * @param {string} key - Clave del archivo
     * @returns {Promise<Buffer>} Contenido del archivo
     */
    async downloadFile(key) {
        try {
            console.log(`📥 Downloading file: ${key}`);
            
            const result = await this.s3.getObject({
                Bucket: this.bucketName,
                Key: key
            }).promise();
            
            console.log(`✅ File downloaded successfully: ${key}`);
            console.log(`   Size: ${result.Body.length} bytes`);
            console.log(`   Content-Type: ${result.ContentType}`);
            
            return result.Body;
        } catch (error) {
            console.error(`❌ Error downloading file: ${error.message}`);
            throw new Error(`Failed to download file ${key}: ${error.message}`);
        }
    }

    /**
     * Elimina un archivo del bucket
     * @param {string} key - Clave del archivo
     * @returns {Promise<void>}
     */
    async deleteFile(key) {
        try {
            console.log(`🗑️  Deleting file: ${key}`);
            
            await this.s3.deleteObject({
                Bucket: this.bucketName,
                Key: key
            }).promise();
            
            console.log(`✅ File deleted successfully: ${key}`);
        } catch (error) {
            console.error(`❌ Error deleting file: ${error.message}`);
            throw new Error(`Failed to delete file ${key}: ${error.message}`);
        }
    }

    /**
     * Obtiene información de un archivo
     * @param {string} key - Clave del archivo
     * @returns {Promise<Object>} Información del archivo
     */
    async getFileInfo(key) {
        try {
            const result = await this.s3.headObject({
                Bucket: this.bucketName,
                Key: key
            }).promise();
            
            return {
                key: key,
                size: result.ContentLength,
                contentType: result.ContentType,
                lastModified: result.LastModified,
                etag: result.ETag
            };
        } catch (error) {
            console.error(`❌ Error getting file info: ${error.message}`);
            throw new Error(`Failed to get file info for ${key}: ${error.message}`);
        }
    }

    /**
     * Genera una clave única para un archivo
     * @param {string} fileName - Nombre del archivo original
     * @param {string} prefix - Prefijo opcional
     * @returns {string} Clave única
     */
    generateUniqueKey(fileName, prefix = 'uploads') {
        const timestamp = Date.now();
        const uuid = uuidv4().substring(0, 8);
        const extension = fileName.split('.').pop() || 'xlsx';
        
        return `${prefix}/${timestamp}-${uuid}.${extension}`;
    }

    /**
     * Verifica la conexión con MinIO
     * @returns {Promise<boolean>} True si la conexión es exitosa
     */
    async testConnection() {
        try {
            console.log('🔍 Testing MinIO connection...');
            
            await this.s3.headBucket({
                Bucket: this.bucketName
            }).promise();
            
            console.log('✅ MinIO connection successful');
            return true;
        } catch (error) {
            console.error('❌ MinIO connection failed:', error.message);
            return false;
        }
    }
}

module.exports = new MinioService();
