# Backup & Restore Guide

Panduan lengkap untuk setup dan menjalankan backup otomatis di VM production.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Konfigurasi](#konfigurasi)
3. [Menjalankan Backup](#menjalankan-backup)
4. [Menjalankan Restore](#menjalankan-restore)
5. [Setup Cron Job](#setup-cron-job)
6. [Upload ke R2 (Optional)](#upload-ke-r2-optional)
7. [Monitoring & Alerts](#monitoring--alerts)
8. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# 1. Pastikan scripts executable
chmod +x scripts/backup.sh scripts/restore.sh scripts/backup-cron.sh

# 2. Test backup manual
./scripts/backup.sh

# 3. Cek hasil backup
ls -la backups/daily/

# 4. Setup cron untuk backup otomatis
crontab -e
# Tambahkan: 0 2 * * * /path/to/backend/scripts/backup-cron.sh
```

---

## Konfigurasi

### Environment Variables

Tambahkan ke `.env` atau set sebagai environment variable:

```bash
# Database (wajib - sudah ada di .env)
DB_USERNAME=waspread
DB_DATABASE=waspread

# Docker container names (optional, default sudah sesuai docker-compose)
POSTGRES_CONTAINER=waspread-postgres
BACKEND_CONTAINER=waspread-backend

# Retention policy (optional)
DAILY_RETENTION=7      # Simpan 7 backup harian terakhir
WEEKLY_RETENTION=4     # Simpan 4 backup mingguan terakhir
MONTHLY_RETENTION=3    # Simpan 3 backup bulanan terakhir

# Direktori backup (optional)
BACKUP_DIR=/path/to/backups
LOG_DIR=/path/to/logs

# Alerts (optional)
BACKUP_ALERT_EMAIL=admin@example.com
BACKUP_ALERT_WEBHOOK=https://hooks.slack.com/services/xxx

# R2 Upload (optional)
R2_BUCKET=your-bucket
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
```

### Struktur Direktori Backup

```
backups/
├── daily/          # Backup harian (7 terakhir)
├── weekly/         # Backup mingguan/Sunday (4 terakhir)
└── monthly/        # Backup bulanan/tanggal 1 (3 terakhir)

logs/
└── backup_YYYYMMDD.log
```

---

## Menjalankan Backup

### Backup Lengkap (Database + Sessions)

```bash
./scripts/backup.sh
```

### Backup Database Saja

```bash
./scripts/backup.sh --db-only
```

### Backup WhatsApp Sessions Saja

```bash
./scripts/backup.sh --sessions-only
```

### Backup dengan Upload ke R2

```bash
./scripts/backup.sh --upload-r2
```

### Backup Tanpa Kompresi

```bash
./scripts/backup.sh --no-compress
```

### Output Contoh

```
[2024-01-15 02:00:01] [INFO] ==========================================
[2024-01-15 02:00:01] [INFO] Waspread Backup Starting
[2024-01-15 02:00:01] [INFO] ==========================================
[2024-01-15 02:00:01] [INFO] Timestamp: 20240115_020001
[2024-01-15 02:00:01] [INFO] Backup directory: /home/user/backend/backups
[2024-01-15 02:00:02] [INFO] Starting database backup...
[2024-01-15 02:00:05] [INFO] Database backup complete: database.dump (45M)
[2024-01-15 02:00:05] [INFO] Starting WhatsApp sessions backup...
[2024-01-15 02:00:06] [INFO] WhatsApp sessions backup complete: 12 files
[2024-01-15 02:00:06] [INFO] Compressing backup...
[2024-01-15 02:00:08] [INFO] Compression complete: waspread_backup_20240115_020001.tar.gz (15M)
[2024-01-15 02:00:08] [INFO] Saved as daily backup
[2024-01-15 02:00:08] [INFO] Applying retention policy...
[2024-01-15 02:00:08] [INFO] ==========================================
[2024-01-15 02:00:08] [INFO] Backup Complete!
[2024-01-15 02:00:08] [INFO] ==========================================
[2024-01-15 02:00:08] [INFO] Daily backups: 7
[2024-01-15 02:00:08] [INFO] Weekly backups: 4
[2024-01-15 02:00:08] [INFO] Monthly backups: 3
```

---

## Menjalankan Restore

### Lihat Backup yang Tersedia

```bash
./scripts/restore.sh --list
```

Output:
```
Available Backups:
==================

📅 Daily Backups (last 7):
  waspread_backup_20240115_020001.tar.gz (15M, Mon Jan 15 02:00:08 2024)
  waspread_backup_20240114_020001.tar.gz (14M, Sun Jan 14 02:00:07 2024)
  ...

📆 Weekly Backups:
  waspread_backup_20240114_020001.tar.gz (14M, Sun Jan 14 02:00:07 2024)
  ...

📆 Monthly Backups:
  waspread_backup_20240101_020001.tar.gz (12M, Mon Jan 01 02:00:06 2024)
  ...
```

### Restore Lengkap

```bash
./scripts/restore.sh backups/daily/waspread_backup_20240115_020001.tar.gz
```

### Restore Database Saja

```bash
./scripts/restore.sh --db-only backups/daily/waspread_backup_20240115_020001.tar.gz
```

### Restore WhatsApp Sessions Saja

```bash
./scripts/restore.sh --sessions-only backups/daily/waspread_backup_20240115_020001.tar.gz
```

### Restore Tanpa Konfirmasi (untuk scripting)

```bash
./scripts/restore.sh --force backups/daily/waspread_backup_20240115_020001.tar.gz
```

### ⚠️ Peringatan Restore

1. **Database akan di-DROP dan dibuat ulang** - Semua data existing akan hilang
2. **WhatsApp sessions akan di-replace** - User perlu reconnect jika sessions corrupt
3. **Backend container akan di-restart** saat restore sessions

---

## Setup Cron Job

### Opsi 1: Crontab User

```bash
# Edit crontab
crontab -e

# Tambahkan baris berikut (backup jam 2 pagi setiap hari)
0 2 * * * /home/user/waspread/backend/scripts/backup-cron.sh
```

### Opsi 2: System Crontab

```bash
# Edit /etc/crontab
sudo nano /etc/crontab

# Tambahkan (ganti 'user' dengan username)
0 2 * * * user /home/user/waspread/backend/scripts/backup-cron.sh
```

### Opsi 3: Cron.d

```bash
# Buat file di /etc/cron.d/
sudo nano /etc/cron.d/waspread-backup

# Isi:
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

0 2 * * * user /home/user/waspread/backend/scripts/backup-cron.sh >> /var/log/waspread-backup.log 2>&1
```

### Verifikasi Cron

```bash
# Cek crontab terdaftar
crontab -l

# Cek cron service running
sudo systemctl status cron

# Monitor cron logs
sudo tail -f /var/log/syslog | grep CRON
```

---

## Upload ke R2 (Optional)

### Prerequisites

1. Install AWS CLI:
```bash
sudo apt install awscli
# atau
pip install awscli
```

2. Konfigurasi credentials di `.env`:
```bash
R2_BUCKET=waspread-backups
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
```

### Test Upload Manual

```bash
./scripts/backup.sh --upload-r2
```

### Verifikasi di R2

```bash
AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID \
AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
aws s3 ls s3://$R2_BUCKET/backups/ --endpoint-url $R2_ENDPOINT
```

---

## Monitoring & Alerts

### Email Alerts

Set `BACKUP_ALERT_EMAIL` untuk menerima notifikasi via email.

Requirements:
- `mailutils` atau `sendmail` terinstall
- SMTP configured di server

```bash
sudo apt install mailutils
```

### Webhook Alerts (Slack/Discord)

Set `BACKUP_ALERT_WEBHOOK` dengan URL webhook.

**Slack:**
1. Buat Incoming Webhook di Slack App
2. Copy webhook URL
3. Set: `BACKUP_ALERT_WEBHOOK=https://hooks.slack.com/services/xxx/yyy/zzz`

**Discord:**
1. Server Settings > Integrations > Webhooks
2. Copy webhook URL
3. Append `/slack` untuk compatibility: `https://discord.com/api/webhooks/xxx/yyy/slack`

### Cek Log Manual

```bash
# Log hari ini
cat logs/backup_$(date +%Y%m%d).log

# Tail real-time
tail -f logs/backup_*.log

# Cari error
grep -i error logs/backup_*.log
```

---

## Troubleshooting

### Error: Container not running

```
[ERROR] PostgreSQL container 'waspread-postgres' is not running
```

**Solusi:**
```bash
docker-compose up -d postgres
# Tunggu beberapa detik
./scripts/backup.sh
```

### Error: Permission denied

```
permission denied: ./scripts/backup.sh
```

**Solusi:**
```bash
chmod +x scripts/*.sh
```

### Error: pg_dump failed

```
[ERROR] Database backup failed!
```

**Kemungkinan penyebab:**
1. Database credentials salah di `.env`
2. Container name berbeda

**Solusi:**
```bash
# Cek container name
docker ps --format '{{.Names}}'

# Test koneksi manual
docker exec waspread-postgres psql -U waspread -d waspread -c "SELECT 1"

# Jika container name berbeda, set:
export POSTGRES_CONTAINER=nama-container-anda
```

### Error: No space left on device

**Solusi:**
```bash
# Cek disk usage
df -h

# Hapus backup lama manual
rm backups/daily/waspread_backup_old*.tar.gz

# Atau kurangi retention
export DAILY_RETENTION=3
```

### Error: Restore gagal - database in use

```
database "waspread" is being accessed by other users
```

**Solusi:**
```bash
# Stop backend dulu
docker-compose stop backend

# Jalankan restore
./scripts/restore.sh backup.tar.gz

# Start backend
docker-compose start backend
```

### WhatsApp Sessions Tidak Terestore

**Kemungkinan:**
1. Sessions kosong di backup
2. Sessions corrupt

**Solusi:**
```bash
# Cek isi backup
tar -tzf backup.tar.gz | grep baileys

# Jika kosong, user perlu scan QR ulang
# Cek status WhatsApp via API setelah restore
```

### Cron Tidak Jalan

```bash
# Cek cron service
sudo systemctl status cron

# Cek permission script
ls -la scripts/

# Test manual
./scripts/backup-cron.sh

# Cek cron logs
grep CRON /var/log/syslog | tail -20
```

---

## Best Practices

1. **Test restore secara berkala** - Minimal 1x sebulan test restore di environment terpisah
2. **Monitor disk space** - Set alert jika disk > 80%
3. **Simpan backup offsite** - Gunakan R2 atau copy ke server lain
4. **Dokumentasikan restore procedure** - Pastikan tim tahu cara restore
5. **Encrypt sensitive backups** - Terutama jika upload ke cloud

### Enkripsi Backup (Optional)

```bash
# Encrypt
gpg --symmetric --cipher-algo AES256 backup.tar.gz

# Decrypt
gpg --decrypt backup.tar.gz.gpg > backup.tar.gz
```

---

## Migrasi ke VM Baru

Untuk migrasi lengkap ke VM baru, lihat bagian "Manual Migration Guide" di `CLAUDE.md`.

Quick steps:
```bash
# Di VM lama
./scripts/backup.sh
scp backups/daily/latest_backup.tar.gz user@new-vm:/path/

# Di VM baru
git clone <repo>
cd backend
cp .env.example .env
# Edit .env
docker-compose up -d postgres redis
./scripts/restore.sh /path/latest_backup.tar.gz
docker-compose up -d
```
