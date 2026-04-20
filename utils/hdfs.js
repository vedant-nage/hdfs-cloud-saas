/**
 * HDFS Client using WebHDFS REST API
 * Communicates with Hadoop NameNode via HTTP
 */

const axios = require('axios');
const config = require('../config/config');

const { baseUrl, user, basePath, host } = config.hdfs;

/**
 * Build HDFS URL with operation + user
 */
function hdfsUrl(path, op, extra = {}) {
  const params = new URLSearchParams({
    op: op,
    'user.name': user,
    ...extra,
  });
  return `${baseUrl}${path}?${params}`;
}

/**
 * Fix redirect URL (IMPORTANT for EC2)
 * Replaces private IP with public EC2 IP
 */
function fixRedirectUrl(url) {
  if (!url) return url;

  try {
    const publicHost = host;

    // Replace any host with public EC2 IP
    return url.replace(/\/\/.*?:/, `//${publicHost}:`);
  } catch (err) {
    return url;
  }
}

/**
 * Create directory (mkdir -p)
 */
async function mkdirs(path) {
  const url = hdfsUrl(path, 'MKDIRS');
  const res = await axios.put(url);
  return res.data;
}

/**
 * Write file (handles redirect properly)
 */
async function writeFile(hdfsPath, buffer) {
  // Step 1: Request to NameNode
  const initUrl = hdfsUrl(hdfsPath, 'CREATE', { overwrite: 'true' });

  const initRes = await axios.put(initUrl, null, {
    maxRedirects: 0,
    validateStatus: (s) => s === 307 || s === 201,
  });

  let writeUrl;

  if (initRes.status === 307) {
    // Step 2: Redirect to DataNode
    writeUrl = initRes.headers['location'];

    // 🔥 FIX: Replace private IP with public EC2 IP
    writeUrl = fixRedirectUrl(writeUrl);
  } else {
    writeUrl = initUrl;
  }

  // Step 3: Upload file
  await axios.put(writeUrl, buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    maxRedirects: 5,
  });
}

/**
 * Read file
 */
async function readFile(hdfsPath) {
  const url = hdfsUrl(hdfsPath, 'OPEN');

  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    maxRedirects: 5,
  });

  return Buffer.from(res.data);
}

/**
 * Delete file
 */
async function deleteFile(hdfsPath, recursive = false) {
  const url = hdfsUrl(hdfsPath, 'DELETE', {
    recursive: String(recursive),
  });

  const res = await axios.delete(url);
  return res.data;
}

/**
 * Check existence
 */
async function exists(hdfsPath) {
  try {
    const url = hdfsUrl(hdfsPath, 'GETFILESTATUS');
    await axios.get(url);
    return true;
  } catch (err) {
    if (err.response && err.response.status === 404) return false;
    throw err;
  }
}

/**
 * List directory
 */
async function listDir(hdfsPath) {
  const url = hdfsUrl(hdfsPath, 'LISTSTATUS');
  const res = await axios.get(url);
  return res.data.FileStatuses.FileStatus;
}

/**
 * File metadata
 */
async function fileStatus(hdfsPath) {
  const url = hdfsUrl(hdfsPath, 'GETFILESTATUS');
  const res = await axios.get(url);
  return res.data.FileStatus;
}

/**
 * Ensure base directory exists
 */
async function ensureBaseDir() {
  await mkdirs(basePath);
}

/**
 * Chunk path
 */
function chunkPath(fileId, chunkIndex) {
  return `${basePath}/files/${fileId}/chunk_${String(chunkIndex).padStart(6, '0')}`;
}

/**
 * File directory path
 */
function fileDirPath(fileId) {
  return `${basePath}/files/${fileId}`;
}

module.exports = {
  mkdirs,
  writeFile,
  readFile,
  deleteFile,
  exists,
  listDir,
  fileStatus,
  ensureBaseDir,
  chunkPath,
  fileDirPath,
  basePath,
};
