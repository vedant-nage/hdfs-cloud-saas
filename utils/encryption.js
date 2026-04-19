/**
 * AES-256-CBC Encryption Utility
 * Handles per-chunk encryption and decryption for secure HDFS storage
 */

const forge = require('node-forge');
const config = require('../config/config');

/**
 * Derives a consistent 32-byte key from the configured secret
 */
function deriveKey(secret) {
  const md = forge.md.sha256.create();
  md.update(secret, 'utf8');
  return md.digest().getBytes();
}

/**
 * Encrypts a Buffer using AES-256-CBC
 * Returns a Buffer with format: [16-byte IV][encrypted data]
 */
function encryptChunk(plainBuffer) {
  const key = deriveKey(config.encryption.secretKey);
  const iv = forge.random.getBytesSync(config.encryption.ivLength);

  const cipher = forge.cipher.createCipher('AES-CBC', key);
  cipher.start({ iv });
  cipher.update(forge.util.createBuffer(plainBuffer));
  cipher.finish();

  const encryptedBytes = cipher.output.getBytes();

  // Prepend IV to encrypted data
  const ivBuffer = Buffer.from(iv, 'binary');
  const encBuffer = Buffer.from(encryptedBytes, 'binary');

  return Buffer.concat([ivBuffer, encBuffer]);
}

/**
 * Decrypts a Buffer that was encrypted with encryptChunk
 * Expects format: [16-byte IV][encrypted data]
 */
function decryptChunk(encryptedBuffer) {
  const key = deriveKey(config.encryption.secretKey);
  const ivLength = config.encryption.ivLength;

  // Extract IV and ciphertext
  const iv = encryptedBuffer.slice(0, ivLength).toString('binary');
  const ciphertext = encryptedBuffer.slice(ivLength).toString('binary');

  const decipher = forge.cipher.createDecipher('AES-CBC', key);
  decipher.start({ iv });
  decipher.update(forge.util.createBuffer(ciphertext));
  const result = decipher.finish();

  if (!result) {
    throw new Error('Decryption failed: invalid key or corrupted data');
  }

  return Buffer.from(decipher.output.getBytes(), 'binary');
}

/**
 * Splits a Buffer into fixed-size chunks
 */
function splitIntoChunks(buffer, chunkSize) {
  const chunks = [];
  let offset = 0;
  let index = 0;

  while (offset < buffer.length) {
    const end = Math.min(offset + chunkSize, buffer.length);
    chunks.push({
      index,
      data: buffer.slice(offset, end),
      size: end - offset,
    });
    offset = end;
    index++;
  }

  return chunks;
}

/**
 * Merges sorted chunk buffers into a single Buffer
 */
function mergeChunks(chunkBuffers) {
  return Buffer.concat(chunkBuffers);
}

module.exports = {
  encryptChunk,
  decryptChunk,
  splitIntoChunks,
  mergeChunks,
};