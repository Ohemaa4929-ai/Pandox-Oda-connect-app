'use strict';
/** Security primitives: hashing, encryption-at-rest, tokens, rate limiting. */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');

const BCRYPT_ROUNDS = 12;

function hashPassword(pw) { return bcrypt.hashSync(pw, BCRYPT_ROUNDS); }
function verifyPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function sha256(v) { return crypto.createHash('sha256').update(v).digest('hex'); }

/** AES-256-GCM encryption for sensitive data at rest (e.g. ID numbers). */
function encryptSecret(plain) {
  if (!config.encryptionKey) throw new Error('ENCRYPTION_KEY not configured');
  const key = Buffer.from(config.encryptionKey, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}
function decryptSecret(payload) {
  if (!payload) return null;
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/** Generic rate limiter factory (in-memory; production: Redis). */
function createRateLimiter({ windowMs = 60000, max = 100, keyFn = (req) => req.ip }) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const bucket = hits.get(key) || { count: 0, resetAt: now + windowMs };
    if (bucket.resetAt <= now) { bucket.count = 0; bucket.resetAt = now + windowMs; }
    bucket.count += 1;
    hits.set(key, bucket);
    if (hits.size > 100000) { for (const [k, b] of hits) if (b.resetAt <= now) hits.delete(k); }
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, randomToken, sha256, encryptSecret, decryptSecret, createRateLimiter };
