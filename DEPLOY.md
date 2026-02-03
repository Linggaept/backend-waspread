# Deployment Guide - WhatsApp Blasting SaaS Backend

Panduan lengkap untuk deploy backend ke VPS.

## Prerequisites

- VPS dengan minimal **2GB RAM** (recommended 4GB untuk production)
- Ubuntu 20.04/22.04 atau Debian 11+
- Domain yang sudah pointing ke IP VPS (optional, untuk SSL)

---

## 1. Setup VPS

### Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### Install Docker & Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group (logout/login after this)
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

### Install Git

```bash
sudo apt install git -y
```

---

## 2. Clone Repository

```bash
cd /home/$USER
git clone <repository_url> waspread-backend
cd waspread-backend
```

---

## 3. Konfigurasi Environment

### Copy dan edit file .env

```bash
cp .env.example .env
nano .env
```

### Isi konfigurasi production:

```env
# Database (GANTI PASSWORD!)
DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=waspread
DB_PASSWORD=GANTI_PASSWORD_YANG_KUAT_123!
DB_DATABASE=waspread

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# JWT (GANTI SECRET!)
JWT_SECRET=GANTI_DENGAN_RANDOM_STRING_PANJANG_DAN_AMAN
JWT_EXPIRES_IN=604800

# App
APP_PORT=2004
NODE_ENV=production

# Midtrans
MIDTRANS_SERVER_KEY=your-server-key
MIDTRANS_CLIENT_KEY=your-client-key
MIDTRANS_IS_PRODUCTION=true

# Cloudflare R2 (Optional)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=your-bucket
R2_PUBLIC_URL=https://your-bucket.r2.dev

# Mail (Optional)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password
MAIL_FROM=noreply@yourdomain.com
```

> **PENTING**: Ganti semua password dan secret dengan nilai yang aman!

---

## 4. Deploy dengan Docker

### Production Mode

```bash
# Build dan jalankan
docker compose -f docker-compose.prod.yml up -d --build

# Cek status
docker compose -f docker-compose.prod.yml ps

# Lihat logs
docker compose -f docker-compose.prod.yml logs -f backend
```

### Verifikasi

```bash
# Cek health endpoint
curl http://localhost:2004/api/health

# Expected response:
# {"status":"ok","info":{"database":{"status":"up"},"redis":{"status":"up"}}}
```

---

## 5. Setup Nginx Reverse Proxy (Recommended)

### Install Nginx

```bash
sudo apt install nginx -y
```

### Buat konfigurasi

```bash
sudo nano /etc/nginx/sites-available/waspread
```

### Isi dengan:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;  # Ganti dengan domain kamu

    # Max upload size (untuk CSV/Excel/Image)
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:2004;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # WebSocket support (untuk QR code real-time)
        proxy_read_timeout 86400;
    }
}
```

### Aktifkan site

```bash
sudo ln -s /etc/nginx/sites-available/waspread /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 6. Setup SSL dengan Certbot (HTTPS)

### Install Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
```

### Generate SSL

```bash
sudo certbot --nginx -d api.yourdomain.com
```

Ikuti instruksi dan pilih redirect HTTP to HTTPS.

### Auto-renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Crontab akan otomatis dibuat oleh certbot
```

---

## 7. Firewall Setup

```bash
# Install UFW
sudo apt install ufw -y

# Allow SSH, HTTP, HTTPS
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https

# Enable firewall
sudo ufw enable

# Cek status
sudo ufw status
```

---

## 8. Perintah Maintenance

### Logs

```bash
# Lihat logs backend
docker compose -f docker-compose.prod.yml logs -f backend

# Lihat logs database
docker compose -f docker-compose.prod.yml logs -f postgres

# Lihat semua logs
docker compose -f docker-compose.prod.yml logs -f
```

### Restart Services

```bash
# Restart semua
docker compose -f docker-compose.prod.yml restart

# Restart backend saja
docker compose -f docker-compose.prod.yml restart backend
```

### Update Deployment

```bash
# Pull latest code
git pull origin main

# Rebuild dan restart
docker compose -f docker-compose.prod.yml up -d --build

# Atau tanpa downtime (rolling update)
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d --no-deps backend
```

### Database Backup

```bash
# Backup
docker exec waspread-postgres pg_dump -U waspread waspread > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore
cat backup_file.sql | docker exec -i waspread-postgres psql -U waspread waspread
```

### Stop Services

```bash
# Stop semua (data tetap aman di volume)
docker compose -f docker-compose.prod.yml down

# Stop dan hapus volume (HATI-HATI! Data hilang!)
docker compose -f docker-compose.prod.yml down -v
```

---

## 9. Monitoring

### Cek Resource Usage

```bash
# Docker stats
docker stats

# Disk usage
df -h

# Memory usage
free -m
```

### Health Check Script

Buat file `/home/$USER/health-check.sh`:

```bash
#!/bin/bash
HEALTH=$(curl -s http://localhost:2004/api/health | jq -r '.status')

if [ "$HEALTH" != "ok" ]; then
    echo "$(date): Health check failed, restarting..."
    cd /home/$USER/waspread-backend
    docker compose -f docker-compose.prod.yml restart backend
fi
```

Jadwalkan dengan cron:

```bash
chmod +x /home/$USER/health-check.sh
crontab -e

# Tambahkan (cek setiap 5 menit):
*/5 * * * * /home/$USER/health-check.sh >> /home/$USER/health-check.log 2>&1
```

---

## 10. Troubleshooting

### Container tidak start

```bash
# Cek logs
docker compose -f docker-compose.prod.yml logs backend

# Cek apakah port sudah dipakai
sudo lsof -i :2004
```

### Database connection refused

```bash
# Pastikan postgres sudah running
docker compose -f docker-compose.prod.yml ps postgres

# Cek logs postgres
docker compose -f docker-compose.prod.yml logs postgres
```

### WhatsApp session error

```bash
# Hapus session dan restart
docker compose -f docker-compose.prod.yml down
sudo rm -rf .wwebjs_auth .wwebjs_cache
docker compose -f docker-compose.prod.yml up -d
```

### Out of memory

```bash
# Tambah swap (jika RAM terbatas)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Endpoints Penting

| Endpoint | Deskripsi |
|----------|-----------|
| `GET /api/health` | Health check |
| `GET /docs` | Swagger API Documentation |
| `POST /api/auth/login` | Login |
| `POST /api/auth/register` | Register |
| `WS /` | WebSocket untuk QR code |

---

## Quick Commands Reference

```bash
# Start
docker compose -f docker-compose.prod.yml up -d

# Stop
docker compose -f docker-compose.prod.yml down

# Logs
docker compose -f docker-compose.prod.yml logs -f

# Restart
docker compose -f docker-compose.prod.yml restart

# Rebuild
docker compose -f docker-compose.prod.yml up -d --build

# Status
docker compose -f docker-compose.prod.yml ps

# Backup DB
docker exec waspread-postgres pg_dump -U waspread waspread > backup.sql
```
