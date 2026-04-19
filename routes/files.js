/**
 * File API Routes
 * POST   /api/files/upload    - Upload and chunk+encrypt file to HDFS
 * GET    /api/files           - List all stored files
 * GET    /api/files/:id       - Download a file (decrypt+merge chunks from HDFS)
 * DELETE /api/files/:id       - Delete file and its HDFS chunks
 * GET    /api/files/:id/info  - Get file metadata
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const config = require('../config/config');
const hdfs = require('../utils/hdfs');
const metadata = require('../utils/metadata');
const { encryptChunk, decryptChunk, splitIntoChunks, mergeChunks } = require('../utils/encryption');

const router = express.Router();

// Ensure upload temp dir exists
const uploadDir = config.files.uploadDir;
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer configuration - disk storage for large files
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${Date.now()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: config.files.maxSizeBytes },
  fileFilter: (req, file, cb) => {
    // Allow all file types
    cb(null, true);
  },
});

// ─────────────────────────────────────────────
// POST /api/files/upload
// ─────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  const tempPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const fileId = uuidv4();
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const totalSize = req.file.size;
    const mimeType = req.file.mimetype || 'application/octet-stream';

    console.log(`[Upload] Starting: "${originalName}" (${(totalSize / 1024 / 1024).toFixed(2)} MB) → ${fileId}`);

    // Read file into memory (for files up to maxSizeMB)
    const fileBuffer = fs.readFileSync(tempPath);

    // Split into chunks
    const chunks = splitIntoChunks(fileBuffer, config.files.chunkSizeBytes);
    console.log(`[Upload] Split into ${chunks.length} chunk(s) of ${config.files.chunkSizeMB} MB each`);

    // Ensure HDFS directory exists for this file
    const fileDir = hdfs.fileDirPath(fileId);
    await hdfs.mkdirs(fileDir);

    // Encrypt and upload each chunk to HDFS
    const chunkMeta = [];
    for (const chunk of chunks) {
      const encrypted = encryptChunk(chunk.data);
      const cPath = hdfs.chunkPath(fileId, chunk.index);

      await hdfs.writeFile(cPath, encrypted);

      chunkMeta.push({
        index: chunk.index,
        hdfsPath: cPath,
        originalSize: chunk.size,
        encryptedSize: encrypted.length,
      });

      console.log(`[Upload] Chunk ${chunk.index + 1}/${chunks.length} encrypted & stored → ${cPath}`);
    }

    // Save metadata
    const meta = await metadata.addFile({
      id: fileId,
      originalName,
      mimeType,
      totalSize,
      chunkCount: chunks.length,
      chunks: chunkMeta,
      uploadedAt: new Date().toISOString(),
    });

    // Clean up temp file
    fs.unlinkSync(tempPath);

    console.log(`[Upload] Complete: ${fileId}`);

    res.status(201).json({
      success: true,
      file: {
        id: meta.id,
        name: meta.originalName,
        size: meta.totalSize,
        chunks: meta.chunkCount,
        uploadedAt: meta.uploadedAt,
      },
    });
  } catch (err) {
    // Clean up temp file on error
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    console.error('[Upload] Error:', err.message);
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/files
// ─────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const files = metadata.listFiles().map(f => ({
      id: f.id,
      name: f.originalName,
      size: f.totalSize,
      mimeType: f.mimeType,
      chunks: f.chunkCount,
      uploadedAt: f.uploadedAt,
    }));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list files', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/files/:id/info
// ─────────────────────────────────────────────
router.get('/:id/info', (req, res) => {
  const meta = metadata.getFile(req.params.id);
  if (!meta) return res.status(404).json({ error: 'File not found' });
  res.json({ file: meta });
});

// ─────────────────────────────────────────────
// GET /api/files/:id  (download)
// ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const fileId = req.params.id;

  try {
    const meta = metadata.getFile(fileId);
    if (!meta) return res.status(404).json({ error: 'File not found' });

    console.log(`[Download] Starting: "${meta.originalName}" (${meta.chunkCount} chunks)`);

    // Sort chunks by index (ensures correct order)
    const sortedChunks = [...meta.chunks].sort((a, b) => a.index - b.index);

    // Retrieve, decrypt, and collect chunk buffers
    const decryptedBuffers = [];
    for (const chunk of sortedChunks) {
      const encryptedBuf = await hdfs.readFile(chunk.hdfsPath);
      const decryptedBuf = decryptChunk(encryptedBuf);
      decryptedBuffers.push(decryptedBuf);
      console.log(`[Download] Chunk ${chunk.index + 1}/${meta.chunkCount} retrieved & decrypted`);
    }

    // Merge all chunks into the original file
    const fileBuffer = mergeChunks(decryptedBuffers);
    console.log(`[Download] Merged ${meta.chunkCount} chunks → ${fileBuffer.length} bytes`);

    // Set headers and stream file to client
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.originalName)}"`);
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('X-File-Id', fileId);
    res.setHeader('X-Chunk-Count', meta.chunkCount);

    res.send(fileBuffer);
    console.log(`[Download] Complete: ${fileId}`);
  } catch (err) {
    console.error('[Download] Error:', err.message);
    res.status(500).json({ error: 'Download failed', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/files/:id
// ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const fileId = req.params.id;

  try {
    const meta = metadata.getFile(fileId);
    if (!meta) return res.status(404).json({ error: 'File not found' });

    // Delete all HDFS chunks and directory
    await hdfs.deleteFile(hdfs.fileDirPath(fileId), true);
    console.log(`[Delete] HDFS chunks removed for: ${fileId}`);

    // Remove metadata
    await metadata.deleteFile(fileId);

    res.json({ success: true, message: `File "${meta.originalName}" deleted` });
  } catch (err) {
    console.error('[Delete] Error:', err.message);
    res.status(500).json({ error: 'Delete failed', detail: err.message });
  }
});

module.exports = router;