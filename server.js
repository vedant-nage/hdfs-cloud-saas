/**
 * HDFS Cloud Storage SaaS - Main Server
 * Node.js + Express backend with WebHDFS integration
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config/config');
const metadata = require('./utils/metadata');
const hdfs = require('./utils/hdfs');
const filesRouter = require('./routes/files');
const healthRouter = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const hdfs = require('./utils/hdfs');

hdfs.ensureBaseDir()
  .then(() => console.log("HDFS base directory ready"))
  .catch(console.error);
// ── Security Middleware ─────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Relaxed for SaaS UI
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());

// ── Logging ─────────────────────────────────────────
app.use(morgan(config.server.env === 'production' ? 'combined' : 'dev'));

// ── Body Parsing ─────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ── Static Frontend ──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ───────────────────────────────────────
app.use('/api/health', healthRouter);
app.use('/api/files', filesRouter);

// ── SPA Fallback ─────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global Error Handler ─────────────────────────────
app.use(errorHandler);

// ── Startup ──────────────────────────────────────────
async function start() {
  try {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║     HDFS Cloud Storage SaaS v1.0.0       ║');
    console.log('╚══════════════════════════════════════════╝');

    // Initialize HDFS base directory
    console.log('[Init] Connecting to HDFS...');
    await hdfs.ensureBaseDir();
    console.log(`[Init] HDFS ready at ${config.hdfs.baseUrl}${config.hdfs.basePath}`);

    // Load metadata from HDFS
    console.log('[Init] Loading metadata from HDFS...');
    await metadata.loadFromHDFS();

    // Start HTTP server
    app.listen(config.server.port, '0.0.0.0', () => {
      console.log(`[Init] Server running on port ${config.server.port}`);
      console.log(`[Init] Access: http://0.0.0.0:${config.server.port}`);
      console.log(`[Init] Env: ${config.server.env}`);
      console.log('[Init] Ready to accept requests ✓');
    });
  } catch (err) {
    console.error('[Init] Startup failed:', err.message);
    console.error('[Init] Ensure HDFS NameNode is running and reachable.');
    process.exit(1);
  }
}

start();
