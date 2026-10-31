# 🚀 BeamDrop — QR-Based Ephemeral File Transfer

A modern, high-speed, QR-code-based file transfer application designed for seamless file sharing between PCs, laptops, smartphones, and tablets.

Drop any file up to **150 MB**, scan the generated QR code on any device connected to your network, and download it instantly. Files automatically **self-destruct permanently after 1 hour**.

---

## ✨ Features

- **📱 Instant QR Code Transfer**: Drop a file and immediately scan the generated high-resolution QR code using any phone's camera.
- **⏳ 1-Hour Automatic Expiration (TTL)**: Files and metadata are wiped automatically from disk and memory after 60 minutes.
- **🛡️ 150 MB File Size Limitation**: Hard limit strictly enforced both on the client UI and the server backend (`HTTP 413 Payload Too Large`).
- **🌐 Public Domain & Reverse Proxy Ready**: Designed for direct domain deployment (e.g. `https://qr.fardin.com.bd`) behind Nginx, Caddy, Cloudflare, or Traefik with seamless SSL support.
- **🛡️ Docker & Restart Resilient**: Crash-proof architecture featuring atomic metadata disk writes, graceful SIGTERM shutdown, stream disconnect error traps, and dedicated Docker container health checks.
- **🔥 Instant Burn / Self-Destruct Button**: Both sender and recipient can securely erase the file on-demand before the 1-hour timer expires.
- **🖼️ Built-in Image Preview**: View previews directly on the download page for image formats before downloading.
- **🐳 Docker & Docker-Compose Ready**: Built on top of `node:20-alpine`, runs as a non-root secure user with health checks, volume persistence, and `init: true` signal management.
- **🎨 Glassmorphism Cyberpunk UI**: Sleek, modern responsive interface with real-time upload progress, animated dropzone, and live countdown timer.

---

## 🚀 Quick Start with Docker

### Option 1: Using Docker Compose (Recommended)

1. Make sure **Docker Desktop** is running.
2. In the project directory, start the container:
   ```bash
   docker compose up -d
   ```
3. Access:
   - **Public domain**: [https://qr.fardin.com.bd](https://qr.fardin.com.bd) (via your reverse proxy)
   - **Direct port**: [http://localhost:3055](http://localhost:3055)

To stop the container:
```bash
docker compose down
```

---

### Option 2: Using Plain Docker CLI

1. Build the Docker image:
   ```bash
   docker build -t beamdrop .
   ```
2. Run the container:
   ```bash
   docker run -d -p 3055:3055 -e PUBLIC_URL=https://qr.fardin.com.bd -v beamdrop_uploads:/app/uploads --name beamdrop beamdrop
   ```

---

## 💻 Running Natively (Without Docker)

Requires **Node.js 18+**:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Access at [http://localhost:3055](http://localhost:3055)

---

## 🌐 Reverse Proxy Configuration (`qr.fardin.com.bd`)

Because BeamDrop accepts files up to **150 MB**, ensure your reverse proxy client body size is set accordingly (`client_max_body_size 160M;`).

### Nginx Configuration
```nginx
server {
    listen 80;
    server_name qr.fardin.com.bd;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name qr.fardin.com.bd;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

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

### Caddy Configuration
```caddy
qr.fardin.com.bd {
    request_body {
        max_size 160MB
    }
    reverse_proxy 127.0.0.1:3055
}
```

---

## ⚙️ Environment Configuration

You can configure BeamDrop by setting environment variables in `docker-compose.yml` or a `.env` file:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3055` | Port the web server listens on |
| `MAX_FILE_SIZE_MB` | `150` | Maximum allowed upload size in megabytes |
| `FILE_TTL_MINUTES` | `60` | File lifetime in minutes before auto-destruction |
| `PUBLIC_URL` | `https://qr.fardin.com.bd` | Public domain used in generated QR code links |

---

## 📡 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/upload` | Multipart file upload (max 150MB, returns fileId, QR code, and download URLs) |
| `GET` | `/api/file/:id` | Get file metadata and remaining TTL in seconds |
| `GET` | `/api/file/:id/download` | Direct file binary download stream |
| `GET` | `/api/qr?text=<url>` | Generate a standalone PNG QR code for any URL |
| `GET` | `/api/config` | Query server settings and public domain URL |
| `GET` | `/health` | Lightweight container health check endpoint |
| `DELETE` | `/api/file/:id` | Immediately burn/delete the file from storage |
| `GET` | `/d/:id` | Recipient download landing page |

---

## 🔒 Security & Privacy

- Files are stored in an isolated `uploads/` directory with randomized 16-character hexadecimal IDs.
- Stored files do not expose their original names on disk.
- An automatic background garbage collector executes every 30 seconds to purge expired transfers.
- Non-root user `node` in Docker to adhere to least-privilege security best practices.
