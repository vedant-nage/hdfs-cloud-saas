/**
 * Global Error Handler Middleware
 */

const multer = require('multer');

function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message);

  // Multer file size limit error
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        detail: `Maximum file size is ${process.env.MAX_FILE_SIZE_MB || 500} MB`,
      });
    }
    return res.status(400).json({ error: 'File upload error', detail: err.message });
  }

  // Generic error
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorHandler;