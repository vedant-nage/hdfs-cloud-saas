/**
 * Metadata Manager
 * Stores file metadata in-memory and persists to HDFS as JSON
 * Maps file IDs to chunk information for correct retrieval ordering
 */

const hdfs = require('./hdfs');
const config = require('../config/config');

// In-memory metadata store (also persisted to HDFS)
const store = new Map();

const METADATA_HDFS_PATH = `${config.hdfs.basePath}/metadata.json`;

/**
 * Load metadata from HDFS on startup
 */
async function loadFromHDFS() {
  try {
    const exists = await hdfs.exists(METADATA_HDFS_PATH);
    if (exists) {
      const buf = await hdfs.readFile(METADATA_HDFS_PATH);
      const data = JSON.parse(buf.toString('utf8'));
      for (const [k, v] of Object.entries(data)) {
        store.set(k, v);
      }
      console.log(`[Metadata] Loaded ${store.size} file record(s) from HDFS`);
    }
  } catch (err) {
    console.warn('[Metadata] Could not load from HDFS (may be first run):', err.message);
  }
}

/**
 * Persist metadata to HDFS
 */
async function saveToHDFS() {
  try {
    const obj = Object.fromEntries(store);
    const buf = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
    await hdfs.writeFile(METADATA_HDFS_PATH, buf);
  } catch (err) {
    console.error('[Metadata] Failed to persist to HDFS:', err.message);
  }
}

/**
 * Add a new file record
 * @param {object} meta - { id, originalName, mimeType, totalSize, chunkCount, uploadedAt }
 */
async function addFile(meta) {
  store.set(meta.id, {
    ...meta,
    status: 'active',
  });
  await saveToHDFS();
  return store.get(meta.id);
}

/**
 * Get file metadata by ID
 */
function getFile(fileId) {
  return store.get(fileId) || null;
}

/**
 * Get all files
 */
function listFiles() {
  return Array.from(store.values()).filter(f => f.status === 'active');
}

/**
 * Delete file metadata
 */
async function deleteFile(fileId) {
  const meta = store.get(fileId);
  if (!meta) return false;
  store.delete(fileId);
  await saveToHDFS();
  return true;
}

/**
 * Update file status
 */
async function updateFile(fileId, updates) {
  const meta = store.get(fileId);
  if (!meta) return null;
  store.set(fileId, { ...meta, ...updates });
  await saveToHDFS();
  return store.get(fileId);
}

module.exports = {
  loadFromHDFS,
  addFile,
  getFile,
  listFiles,
  deleteFile,
  updateFile,
};