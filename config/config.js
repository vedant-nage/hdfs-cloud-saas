require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
  },
  hdfs: {
    host: process.env.HDFS_HOST || 'localhost',
    port: parseInt(process.env.HDFS_PORT) || 9870,
    user: process.env.HDFS_USER || 'ubuntu',
    basePath: process.env.HDFS_BASE_PATH || '/cloud-storage',
    get baseUrl() {
      return `http://${this.host}:${this.port}/webhdfs/v1`;
    },
  },
  encryption: {
    secretKey: process.env.AES_SECRET_KEY || 'default-dev-key-change-in-production!!',
    ivLength: parseInt(process.env.AES_IV_LENGTH) || 16,
    algorithm: 'AES-CBC',
    keySize: 32, // 256-bit
  },
  files: {
    maxSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB) || 500,
    chunkSizeMB: parseInt(process.env.CHUNK_SIZE_MB) || 4,
    get maxSizeBytes() { return this.maxSizeMB * 1024 * 1024; },
    get chunkSizeBytes() { return this.chunkSizeMB * 1024 * 1024; },
    uploadDir: '/tmp/hdfs-cloud-uploads',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  },
  
};
