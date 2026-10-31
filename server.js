const express = require('express');
const multer = require('multer');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

// Trust reverse proxy headers (e.g. Nginx, Cloudflare, Caddy behind qr.fardin.com.bd)
app.set('trust proxy', true);

// Configuration
const PORT = parseInt(process.env.PORT, 10) || 3055;
const DEFAULT_DOMAIN = 'https://qr.fardin.com.bd';
const PUBLIC_URL = process.env.PUBLIC_URL || DEFAULT_DOMAIN;
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 150;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const FILE_TTL_MINUTES = parseInt(process.env.FILE_TTL_MINUTES, 10) || 60;
const FILE_TTL_MS = FILE_TTL_MINUTES * 60 * 1000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// In-memory metadata store with disk sync
let metadataStore = new Map();

function loadMetadata() {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
      metadataStore = new Map(Object.entries(data));
    }
  } catch (err) {
    console.error('Failed to load metadata.json:', err.message);
    metadataStore = new Map();
  }
}

function saveMetadata() {
  try {
    const obj = Object.fromEntries(metadataStore);
    fs.writeFileSync(METADATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save metadata.json:', err.message);
  }
}

// Initial load
loadMetadata();

// Helper to get local network IPv4 addresses
function getNetworkIps() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          address: iface.address
        });
      }
    }
  }
  return addresses;
}

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
function cleanupExpiredFiles() {
  const now = Date.now();
  let changed = false;

  for (const [id, meta] of metadataStore.entries()) {
    if (now > meta.expiresAt) {
      const filePath = path.join(UPLOADS_DIR, id);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[Auto-Cleanup] Deleted expired file: ${meta.originalName} (${id})`);
        }
      } catch (err) {
        console.error(`[Auto-Cleanup] Error deleting file ${id}:`, err.message);
      }
      metadataStore.delete(id);
      changed = true;
    }
  }

  // Also check disk for orphaned files
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const file of files) {
      if (file === 'metadata.json') continue;
      if (!metadataStore.has(file)) {
        const filePath = path.join(UPLOADS_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          // If file is older than TTL, delete
          if (now - stats.mtimeMs > FILE_TTL_MS) {
            fs.unlinkSync(filePath);
            console.log(`[Auto-Cleanup] Deleted orphaned file from disk: ${file}`);
          }
        } catch (e) {
          // ignore stat errors
        }
      }
    }
  } catch (err) {
    console.error('[Auto-Cleanup] Error scanning uploads dir:', err.message);
  }

  if (changed) {
    saveMetadata();
  }
}

// Start cleanup interval
setInterval(cleanupExpiredFiles, 30 * 1000);
cleanupExpiredFiles(); // Run immediately on start

// --- API ROUTES ---

// System Config and Network IPs
app.get('/api/config', (req, res) => {
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const autoUrl = `${protocol}://${hostHeader}`;

  res.json({
    port: PORT,
    maxFileSizeMB: MAX_FILE_SIZE_MB,
    fileTtlMinutes: FILE_TTL_MINUTES,
    detectedHost: autoUrl,
    configuredPublicUrl: PUBLIC_URL,
    networkIps: getNetworkIps()
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
    res.status(500).json({ error: 'Failed to generate QR code', details: err.message });
  }
});

// File Upload Endpoint
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
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

    // Determine host for download link
    const customHost = req.body.customHost;
    let baseUrl = PUBLIC_URL;
    if (customHost) {
      baseUrl = customHost;
    } else if (!baseUrl) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      baseUrl = `${protocol}://${host}`;
    }
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
      console.error('Error generating initial QR code:', qrErr);
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
    // Delete immediately
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

// Direct File Download
app.get('/api/file/:id/download', (req, res) => {
  const { id } = req.params;
  const meta = metadataStore.get(id);

  if (!meta) {
    return res.status(404).send('File not found or has expired.');
  }

  const now = Date.now();
  if (now > meta.expiresAt) {
    // Delete immediately
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

  // Safely encode original name for Content-Disposition header
  const encodedFilename = encodeURIComponent(meta.originalName).replace(/['()]/g, escape).replace(/\*/g, '%2A');

  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', meta.size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${meta.originalName.replace(/"/g, '')}"; filename*=UTF-8''${encodedFilename}`
  );

  const stream = fs.createReadStream(filePath);
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

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚀 BeamDrop QR File Transfer Server is running!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`📦 Max File Size: ${MAX_FILE_SIZE_MB} MB`);
  console.log(`⏳ Auto-Delete TTL: ${FILE_TTL_MINUTES} Minutes`);
  console.log(`🌐 Local: http://localhost:${PORT}`);
  if (PUBLIC_URL) {
    console.log(`🌍 Public Domain: ${PUBLIC_URL}`);
  }

  const ips = getNetworkIps();
  if (ips.length > 0) {
    console.log(`📱 LAN Access (for phone scanning on same Wi-Fi):`);
    ips.forEach(ip => {
      console.log(`   - http://${ip.address}:${PORT} (${ip.interface})`);
    });
  }
  console.log(`===============================================`);
});
