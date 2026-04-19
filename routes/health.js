/**
 * Health & Status Routes
 * GET /api/health        - Basic health check
 * GET /api/health/hdfs   - HDFS connectivity check
 */

const express = require('express');
const hdfs = require('../utils/hdfs');
const config = require('../config/config');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'HDFS Cloud Storage SaaS',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    config: {
      chunkSizeMB: config.files.chunkSizeMB,
      maxFileSizeMB: config.files.maxSizeMB,
      hdfsHost: config.hdfs.host,
      hdfsPort: config.hdfs.port,
    },
  });
});

router.get('/hdfs', async (req, res) => {
  try {
    await hdfs.ensureBaseDir();
    const exists = await hdfs.exists(config.hdfs.basePath);
    res.json({
      status: 'connected',
      hdfsUrl: config.hdfs.baseUrl,
      basePath: config.hdfs.basePath,
      exists,
    });
  } catch (err) {
    res.status(503).json({
      status: 'disconnected',
      error: err.message,
      hdfsUrl: config.hdfs.baseUrl,
    });
  }
});

module.exports = router;