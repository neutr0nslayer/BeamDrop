# 🚀 BeamDrop — Ephemeral QR File Transfer & Link Shortener

A modern, self-hosted, QR-code-based **ephemeral file transfer** and **URL shortener** web application designed for instant sharing between PCs, laptops, smartphones, and tablets.

Drop any file up to **150 MB** or shorten any long URL, scan the generated QR code on any device, and access it immediately. Everything **self-destructs automatically** when its timer expires.

---

## ✨ Key Features

- **📁 Instant QR File Transfer**: Drop a file up to 150 MB and immediately scan the generated high-contrast QR code with any phone camera to download.
- **🔗 Built-in Link Shortener & QR Generator**: Shorten long URLs directly from the top navigation menu with optional custom aliases (`/s/my-link`), configurable expiration (`15m`, `1h`, `6h`, `24h`, `7d`), click tracking, and downloadable QR codes.
- **⏳ Automatic Self-Destruction (TTL)**: Files and shortened links are automatically purged from disk and memory by a background garbage collector.
- **🔥 Instant Burn Button**: Both sender and recipient can permanently erase any file or short link on demand before the timer expires.
- **📡 Zero-Config LAN & Domain Detection**: Automatically detects your local Wi-Fi LAN IP when run locally (so mobile QR scanning works out of the box) or uses your custom domain (`PUBLIC_URL`) behind any reverse proxy.
- **📱 Mobile-First Glassmorphism UI**: Symmetrical, uniform button grids and responsive layout optimized for smartphones, tablets, and desktops.
- **🛠️ Standalone Deployment Tool**: Deploy with a single command (`./deploy.sh` or `node deploy.js`) as a standalone background daemon, Linux `systemd` service, or Docker container.

---

## 🛠️ Quick Start — Standalone Deployment Tool

BeamDrop includes a cross-platform standalone deployment CLI ([`deploy.js`](deploy.js) and [`deploy.sh`](deploy.sh)) so you can deploy with or without Docker in seconds.

### 1. Standalone Background Daemon (No Docker Required)

Requires **Node.js 18+**:

```bash
# Clone the repository
git clone https://github.com/your-username/beamdrop.git
cd beamdrop

# One-command standalone deployment (installs dependencies, creates .env, starts daemon)
./deploy.sh standalone
```

Or configure your port and custom domain on launch:

```bash
node deploy.js standalone --port 3055 --url https://qr.example.com
```

**Manage your standalone server:**
```bash
npm run status          # Check server health, uptime, active files & links
npm run stop            # Stop standalone background daemon
node deploy.js systemd  # Generate/install a Linux systemd service (beamdrop.service)
```

---

### 2. Deploy with Docker Compose

```bash
# Using the deployment tool
./deploy.sh docker

# Or directly via Docker Compose
docker compose up -d --build
```

To stop the container:
```bash
docker compose down
```

---

### 3. Deploy with Plain Docker CLI

```bash
docker build -t beamdrop .

docker run -d \
  -p 3055:3055 \
  -e PORT=3055 \
  -e MAX_FILE_SIZE_MB=150 \
  -e FILE_TTL_MINUTES=60 \
  -v beamdrop_uploads:/app/uploads \
  --name beamdrop \
  beamdrop
```

*(Optional: Add `-e PUBLIC_URL=https://qr.example.com` when hosting behind a custom domain).*

---

## ⚙️ Environment Configuration

Copy `.env.example` to `.env` (or run `node deploy.js init`):

```bash
cp .env.example .env
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3055` | Port the HTTP server listens on |
| `MAX_FILE_SIZE_MB` | `150` | Maximum allowed file upload size in megabytes |
| `FILE_TTL_MINUTES` | `60` | Default lifetime in minutes before files/links auto-destruct |
| `PUBLIC_URL` | *(Auto-detected)* | Optional public domain URL (e.g. `https://qr.example.com`). When empty, auto-detects from reverse proxy headers or local Wi-Fi LAN IP. |

---

## 🌐 Reverse Proxy Configuration (Optional)

If you are hosting BeamDrop on a custom domain (e.g. `qr.example.com`), ensure your reverse proxy allows uploads up to `160M`.

### Nginx
```nginx
server {
    listen 80;
    server_name qr.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name qr.example.com;

    ssl_certificate /etc/letsencrypt/live/qr.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/qr.example.com/privkey.pem;

    # Allow 150MB file uploads
    client_max_body_size 160M;

    location / {
        proxy_pass http://127.0.0.1:3055;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
```

### Caddy
```caddy
qr.example.com {
    request_body {
        max_size 160MB
    }
    reverse_proxy 127.0.0.1:3055
}
```

---

## 📡 API Reference

### File Transfer Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/upload` | Multipart file upload (`file` field). Returns `fileId`, QR data URL, and download links. |
| `GET` | `/api/file/:id` | Retrieve file metadata, download count, and remaining TTL in seconds. |
| `GET` | `/api/file/:id/download` | Direct binary file download stream. |
| `DELETE` | `/api/file/:id` | Immediately burn/delete the file from disk and memory. |
| `GET` | `/d/:id` | Recipient file download web page. |

### Link Shortener Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/shorten` | JSON body `{ url, customCode?, ttlMinutes? }`. Returns `shortUrl`, `code`, and `qrDataUrl`. |
| `GET` | `/api/link/:code` | Retrieve shortened link metadata, click count, and remaining TTL. |
| `DELETE` | `/api/link/:code` | Immediately burn/delete the shortened link. |
| `GET` | `/s/:code` | Redirect (`HTTP 302`) to the target URL and increment click counter. |

### System Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/qr?text=<value>` | Generate a standalone PNG QR code for any URL or text. |
| `GET` | `/api/config` | Query active server configuration and resolved public URL. |
| `GET` | `/health` | Health check endpoint returning uptime and active file/link counts. |

---

## 🔒 Security & Privacy

- Uploaded files are stored in `uploads/` with randomized 16-character hexadecimal IDs; original filenames are never used as disk paths.
- An automatic background cleanup worker runs every 30 seconds to purge expired files, orphaned uploads, and expired short links.
- Runs as a non-root user (`node`) inside Docker.

---

## 📄 License

Released under the [MIT License](https://opensource.org/licenses/MIT).
