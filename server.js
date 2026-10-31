const express = require('express');
const multer = require('multer');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const cors = require('cors');

// Load .env file if present (zero-dependency parser for standalone deployment)
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  try {
    const envLines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch (err) {
    console.warn('[Config] Could not read .env file:', err.message);
  }
}

// Process-level crash prevention: Ensure unhandled exceptions or rejected promises never kill the server abruptly
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled promise rejection at:', promise, 'reason:', reason);
});

const app = express();

// Trust reverse proxy headers (e.g. Nginx, Cloudflare, Caddy, Traefik)
app.set('trust proxy', true);

// Configuration
const PORT = parseInt(process.env.PORT, 10) || 3055;
const RAW_PUBLIC_URL = (process.env.PUBLIC_URL || '').trim();
const PUBLIC_URL = RAW_PUBLIC_URL ? RAW_PUBLIC_URL.replace(/\/+$/, '') : '';
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 150;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const FILE_TTL_MINUTES = parseInt(process.env.FILE_TTL_MINUTES, 10) || 60;
const FILE_TTL_MS = FILE_TTL_MINUTES * 60 * 1000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');
const LINKS_FILE = path.join(UPLOADS_DIR, 'links.json');

// Detect local LAN IPv4 address for seamless mobile QR scanning when running natively on host
function getLocalNetworkIp() {
  try {
    // Inside a Docker bridge container, os.networkInterfaces() returns the internal container IP (172.x.x.x)
    if (fs.existsSync('/.dockerenv')) {
      return 'localhost';
    }
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (e) {
    // fallback
  }
  return 'localhost';
}

const LOCAL_LAN_IP = getLocalNetworkIp();

// Ensure uploads directory exists and verify write permissions
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (err) {
  console.error('[Storage Error] Failed to create uploads directory:', err.message);
}

// In-memory stores with crash-resilient atomic disk sync
let metadataStore = new Map();
let linksStore = new Map();

function loadMetadata() {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      const content = fs.readFileSync(METADATA_FILE, 'utf8').trim();
      if (content) {
        const data = JSON.parse(content);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const validEntries = [];
          for (const [key, val] of Object.entries(data)) {
            if (val && typeof val === 'object' && val.expiresAt) {
              validEntries.push([key, val]);
            }
          }
          metadataStore = new Map(validEntries);
          console.log(`[Storage] Loaded ${metadataStore.size} active file transfers from metadata.`);
          return;
        }
      }
    }
  } catch (err) {
    console.error('[Storage] Failed to load metadata.json (initializing clean store):', err.message);
  }
  metadataStore = new Map();
}

function saveMetadata() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const obj = Object.fromEntries(metadataStore);
    const jsonStr = JSON.stringify(obj, null, 2);
    const tmpFile = path.join(UPLOADS_DIR, `metadata.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
    fs.writeFileSync(tmpFile, jsonStr, 'utf8');
    fs.renameSync(tmpFile, METADATA_FILE);
  } catch (err) {
    console.error('[Storage] Failed to save metadata.json:', err.message);
  }
}

function loadLinks() {
  try {
    if (fs.existsSync(LINKS_FILE)) {
      const content = fs.readFileSync(LINKS_FILE, 'utf8').trim();
      if (content) {
        const data = JSON.parse(content);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const validEntries = [];
          for (const [key, val] of Object.entries(data)) {
            if (val && typeof val === 'object' && val.originalUrl) {
              validEntries.push([key, val]);
            }
          }
          linksStore = new Map(validEntries);
          console.log(`[Storage] Loaded ${linksStore.size} active shortened links.`);
          return;
        }
      }
    }
  } catch (err) {
    console.error('[Storage] Failed to load links.json (initializing clean store):', err.message);
  }
  linksStore = new Map();
}

function saveLinks() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const obj = Object.fromEntries(linksStore);
    const jsonStr = JSON.stringify(obj, null, 2);
    const tmpFile = path.join(UPLOADS_DIR, `links.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
    fs.writeFileSync(tmpFile, jsonStr, 'utf8');
    fs.renameSync(tmpFile, LINKS_FILE);
  } catch (err) {
    console.error('[Storage] Failed to save links.json:', err.message);
  }
}

// Initial load
loadMetadata();
loadLinks();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const fileId = crypto.randomBytes(8).toString('hex');
    req.uploadedFileId = fileId;
    cb(null, fileId);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES
  }
});

// Periodic cleanup worker (runs every 30 seconds)
function cleanupExpiredItems() {
  const now = Date.now();
  let filesChanged = false;
  let linksChanged = false;

  for (const [id, meta] of metadataStore.entries()) {
    if (!meta || typeof meta !== 'object' || !meta.expiresAt || now > meta.expiresAt) {
      const filePath = path.join(UPLOADS_DIR, id);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[Auto-Cleanup] Deleted expired file: ${meta && meta.originalName ? meta.originalName : id}`);
        }
      } catch (err) {
        console.error(`[Auto-Cleanup] Error deleting file ${id}:`, err.message);
      }
      metadataStore.delete(id);
      filesChanged = true;
    }
  }

  for (const [code, link] of linksStore.entries()) {
    if (!link || typeof link !== 'object' || (link.expiresAt && now > link.expiresAt)) {
      linksStore.delete(code);
      linksChanged = true;
      console.log(`[Auto-Cleanup] Deleted expired short link: /s/${code}`);
    }
  }

  // Also check disk for orphaned files (safety check)
  try {
    if (fs.existsSync(UPLOADS_DIR)) {
      const files = fs.readdirSync(UPLOADS_DIR);
      for (const file of files) {
        if (
          file === 'metadata.json' ||
          file.startsWith('metadata.') ||
          file === 'links.json' ||
          file.startsWith('links.') ||
          file === '.gitkeep'
        ) {
          continue;
        }
        if (!metadataStore.has(file)) {
          const filePath = path.join(UPLOADS_DIR, file);
          try {
            const stats = fs.statSync(filePath);
            if (stats.isFile() && (now - stats.mtimeMs > FILE_TTL_MS)) {
              fs.unlinkSync(filePath);
              console.log(`[Auto-Cleanup] Deleted orphaned file from disk: ${file}`);
            }
          } catch (e) {
            // ignore stat errors
          }
        }
      }
    }
  } catch (err) {
    console.error('[Auto-Cleanup] Error scanning uploads dir:', err.message);
  }

  if (filesChanged) {
    saveMetadata();
  }
  if (linksChanged) {
    saveLinks();
  }
}

// Start cleanup interval
setInterval(cleanupExpiredItems, 30 * 1000);
cleanupExpiredItems(); // Run immediately on start

// Helper to determine active public URL for links and QR codes
function getBaseUrl(req) {
  if (PUBLIC_URL) {
    return PUBLIC_URL;
  }
  let host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';

  // If accessed via localhost/127.0.0.1 and a LAN IP is available, substitute LAN IP so phone QR scans work automatically
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) && LOCAL_LAN_IP && LOCAL_LAN_IP !== 'localhost') {
    const portPart = host.includes(':') ? host.slice(host.indexOf(':')) : `:${PORT}`;
    host = `${LOCAL_LAN_IP}${portPart}`;
  }

  return `${protocol}://${host}`.replace(/\/+$/, '');
}

// Generate short alphanumeric code
const BASE62_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function generateShortCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += BASE62_CHARS[bytes[i] % BASE62_CHARS.length];
  }
  return code;
}

const RESERVED_SLUGS = new Set(['api', 'd', 's', 'health', 'css', 'js', 'uploads', 'admin', 'login', 'static']);

// --- API ROUTES ---

// Health Check Endpoint (used by Docker container healthcheck and deployment tools)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    activeFiles: metadataStore.size,
    activeLinks: linksStore.size
  });
});

// System Config
app.get('/api/config', (req, res) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    port: PORT,
    maxFileSizeMB: MAX_FILE_SIZE_MB,
    fileTtlMinutes: FILE_TTL_MINUTES,
    publicUrl: baseUrl
  });
});

// Generate dynamic QR code for any given URL/text
app.get('/api/qr', async (req, res) => {
  const text = req.query.text;
  if (!text) {
    return res.status(400).send('Missing "text" query parameter');
  }

  try {
    const qrBuffer = await qrcode.toBuffer(text, {
      type: 'png',
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(qrBuffer);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate QR code', details: err.message });
    }
  }
});

// --- LINK SHORTENER ENDPOINTS ---

// Create Short Link
app.post('/api/shorten', async (req, res) => {
  try {
    let rawUrl = (req.body.url || '').trim();
    const customCode = (req.body.customCode || '').trim();
    const requestedTtl = parseInt(req.body.ttlMinutes, 10);

    if (!rawUrl) {
      return res.status(400).json({ error: 'Please provide a URL to shorten.' });
    }

    // Auto-prepend https:// if scheme is missing
    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'Only HTTP and HTTPS links are supported.' });
      }
      if (!parsedUrl.hostname || !parsedUrl.hostname.includes('.')) {
        if (parsedUrl.hostname !== 'localhost') {
          return res.status(400).json({ error: 'Please enter a valid domain or URL.' });
        }
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format. Please enter a valid web address.' });
    }

    let code = '';
    if (customCode) {
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(customCode)) {
        return res.status(400).json({
          error: 'Custom alias must be 3–32 characters and contain only letters, numbers, hyphens, or underscores.'
        });
      }
      if (RESERVED_SLUGS.has(customCode.toLowerCase())) {
        return res.status(400).json({ error: 'This custom alias is reserved. Please choose another.' });
      }
      const existing = linksStore.get(customCode);
      if (existing && (!existing.expiresAt || Date.now() < existing.expiresAt)) {
        return res.status(409).json({ error: 'Custom alias is already in use. Try another one.' });
      }
      code = customCode;
    } else {
      let attempts = 0;
      do {
        code = generateShortCode(6);
        attempts++;
      } while (linksStore.has(code) && attempts < 10);
    }

    // Determine TTL (default to FILE_TTL_MINUTES, allow 15m up to 7 days = 10080m)
    const validTtlMinutes = !isNaN(requestedTtl) && requestedTtl >= 5 && requestedTtl <= 10080
      ? requestedTtl
      : FILE_TTL_MINUTES;

    const now = Date.now();
    const expiresAt = now + validTtlMinutes * 60 * 1000;

    const linkData = {
      code,
      originalUrl: parsedUrl.toString(),
      createdAt: now,
      expiresAt,
      ttlMinutes: validTtlMinutes,
      clicks: 0
    };

    linksStore.set(code, linkData);
    saveLinks();

    const baseUrl = getBaseUrl(req);
    const shortUrl = `${baseUrl}/s/${code}`;

    let qrDataUrl = '';
    try {
      qrDataUrl = await qrcode.toDataURL(shortUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      });
    } catch (qrErr) {
      console.error('Error generating short link QR code:', qrErr.message);
    }

    res.status(201).json({
      success: true,
      link: {
        code,
        originalUrl: linkData.originalUrl,
        shortUrl,
        createdAt: linkData.createdAt,
        expiresAt: linkData.expiresAt,
        ttlMinutes: linkData.ttlMinutes,
        clicks: linkData.clicks,
        qrDataUrl
      }
    });
  } catch (err) {
    console.error('[Shorten Error]', err);
    res.status(500).json({ error: 'Failed to shorten link.' });
  }
});

// Get Short Link Metadata
app.get('/api/link/:code', (req, res) => {
  const { code } = req.params;
  const link = linksStore.get(code);

  if (!link) {
    return res.status(404).json({ error: 'Short link not found or has expired.' });
  }

  const now = Date.now();
  if (link.expiresAt && now > link.expiresAt) {
    linksStore.delete(code);
    saveLinks();
    return res.status(410).json({ error: 'This short link has expired and been deleted.' });
  }

  const baseUrl = getBaseUrl(req);
  const remainingSeconds = link.expiresAt ? Math.max(0, Math.floor((link.expiresAt - now) / 1000)) : null;

  res.json({
    code: link.code,
    originalUrl: link.originalUrl,
    shortUrl: `${baseUrl}/s/${link.code}`,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    ttlMinutes: link.ttlMinutes,
    remainingSeconds,
    clicks: link.clicks || 0
  });
});

// Burn / Delete Short Link
app.delete('/api/link/:code', (req, res) => {
  const { code } = req.params;
  if (!linksStore.has(code)) {
    return res.status(404).json({ error: 'Short link not found or already deleted.' });
  }

  linksStore.delete(code);
  saveLinks();
  res.json({ success: true, message: 'Short link burned and permanently deleted.' });
});

// Short Link Redirect Endpoint
app.get('/s/:code', (req, res) => {
  const { code } = req.params;
  const link = linksStore.get(code);

  if (!link) {
    return res.redirect('/?expired=link');
  }

  const now = Date.now();
  if (link.expiresAt && now > link.expiresAt) {
    linksStore.delete(code);
    saveLinks();
    return res.redirect('/?expired=link');
  }

  link.clicks = (link.clicks || 0) + 1;
  saveLinks();

  return res.redirect(302, link.originalUrl);
});

// --- FILE TRANSFER ENDPOINTS ---

// File Upload Endpoint
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (req.uploadedFileId) {
        const partialPath = path.join(UPLOADS_DIR, req.uploadedFileId);
        try {
          if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
        } catch (e) {}
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `File exceeds maximum limit of ${MAX_FILE_SIZE_MB}MB.`
        });
      }
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const fileId = req.uploadedFileId;
    const now = Date.now();
    const expiresAt = now + FILE_TTL_MS;

    const fileMetadata = {
      id: fileId,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      uploadedAt: now,
      expiresAt: expiresAt,
      downloads: 0
    };

    metadataStore.set(fileId, fileMetadata);
    saveMetadata();

    const baseUrl = getBaseUrl(req);
    const downloadPageUrl = `${baseUrl}/d/${fileId}`;
    const directDownloadUrl = `${baseUrl}/api/file/${fileId}/download`;

    // Pre-generate QR code as data URL for instant frontend render
    let qrDataUrl = '';
    try {
      qrDataUrl = await qrcode.toDataURL(downloadPageUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      });
    } catch (qrErr) {
      console.error('Error generating initial QR code:', qrErr.message);
    }

    res.status(201).json({
      success: true,
      file: {
        id: fileId,
        name: fileMetadata.originalName,
        size: fileMetadata.size,
        mimeType: fileMetadata.mimeType,
        uploadedAt: fileMetadata.uploadedAt,
        expiresAt: fileMetadata.expiresAt,
        ttlMinutes: FILE_TTL_MINUTES,
        downloadPageUrl,
        directDownloadUrl,
        qrDataUrl
      }
    });
  });
});

// File Metadata Query
app.get('/api/file/:id', (req, res) => {
  const { id } = req.params;
  const meta = metadataStore.get(id);

  if (!meta) {
    return res.status(404).json({ error: 'File not found or has already expired.' });
  }

  const now = Date.now();
  if (now > meta.expiresAt) {
    try {
      const filePath = path.join(UPLOADS_DIR, id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
    metadataStore.delete(id);
    saveMetadata();
    return res.status(410).json({ error: 'This file has expired and been securely deleted.' });
  }

  const remainingSeconds = Math.max(0, Math.floor((meta.expiresAt - now) / 1000));

  res.json({
    id: meta.id,
    name: meta.originalName,
    size: meta.size,
    mimeType: meta.mimeType,
    uploadedAt: meta.uploadedAt,
    expiresAt: meta.expiresAt,
    remainingSeconds,
    downloads: meta.downloads
  });
});

// Direct File Download with Resilient Stream Handling
app.get('/api/file/:id/download', (req, res) => {
  const { id } = req.params;
  const meta = metadataStore.get(id);

  if (!meta) {
    return res.status(404).send('File not found or has expired.');
  }

  const now = Date.now();
  if (now > meta.expiresAt) {
    try {
      const filePath = path.join(UPLOADS_DIR, id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
    metadataStore.delete(id);
    saveMetadata();
    return res.status(410).send('This file has expired and has been deleted.');
  }

  const filePath = path.join(UPLOADS_DIR, id);
  if (!fs.existsSync(filePath)) {
    metadataStore.delete(id);
    saveMetadata();
    return res.status(404).send('File not found on storage.');
  }

  // Increment download count
  meta.downloads = (meta.downloads || 0) + 1;
  saveMetadata();

  // Safely encode original name for Content-Disposition header (prevents ERR_INVALID_CHAR crash on non-ASCII names)
  const safeAsciiName = (meta.originalName || 'file')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '');
  const encodedFilename = encodeURIComponent(meta.originalName || 'file')
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');

  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', meta.size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeAsciiName || 'download'}"; filename*=UTF-8''${encodedFilename}`
  );

  const stream = fs.createReadStream(filePath);

  // Catch stream errors cleanly without crashing process
  stream.on('error', (err) => {
    console.error(`[Download Stream Error] File ${id}:`, err.message);
    if (!res.headersSent) {
      res.status(500).send('File stream read error');
    }
  });

  // Handle client or reverse proxy disconnects
  req.on('close', () => {
    stream.destroy();
  });

  res.on('close', () => {
    stream.destroy();
  });

  res.on('error', (err) => {
    console.error(`[Download Response Error] File ${id}:`, err.message);
    stream.destroy();
  });

  stream.pipe(res);
});

// Manual Instant Burn / Delete Endpoint
app.delete('/api/file/:id', (req, res) => {
  const { id } = req.params;
  const meta = metadataStore.get(id);

  if (!meta) {
    return res.status(404).json({ error: 'File not found or already deleted.' });
  }

  try {
    const filePath = path.join(UPLOADS_DIR, id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Error deleting file ${id}:`, err);
  }

  metadataStore.delete(id);
  saveMetadata();

  res.json({ success: true, message: 'File burned and permanently deleted.' });
});

// HTML page routing
app.get('/d/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Express Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Express Unhandled Error]', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({ error: 'Internal Server Error' });
});

// Start Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚀 BeamDrop Transfer & Shortener Server Running`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`📦 Max File Size: ${MAX_FILE_SIZE_MB} MB`);
  console.log(`⏳ Default Auto-Delete TTL: ${FILE_TTL_MINUTES} Minutes`);
  console.log(`🌐 Local:   http://localhost:${PORT}`);
  if (LOCAL_LAN_IP && LOCAL_LAN_IP !== 'localhost') {
    console.log(`📱 Network: http://${LOCAL_LAN_IP}:${PORT}`);
  }
  if (PUBLIC_URL) {
    console.log(`🌍 Domain:  ${PUBLIC_URL}`);
  } else {
    console.log(`🌍 Domain:  Auto-detected from request / LAN IP`);
  }
  console.log(`===============================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[FATAL] Port ${PORT} is already in use.`);
  } else {
    console.error('[FATAL] Server error:', err);
  }
  process.exit(1);
});

// Graceful Shutdown for Docker container stop/restart
let isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[SHUTDOWN] Received ${signal}. Gracefully stopping server...`);

  saveMetadata();
  saveLinks();

  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed cleanly.');
    process.exit(0);
  });

  // Force shutdown after 5 seconds if connections linger
  setTimeout(() => {
    console.warn('[SHUTDOWN] Force exiting after 5s timeout.');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
