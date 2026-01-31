# WhatsApp Blasting SaaS Backend 🚀

Backend API untuk aplikasi SaaS pengiriman pesan WhatsApp massal (Blasting), dilengkapi dengan sistem langganan, manajemen device multi-session, dan pelaporan real-time.

## 🛠 Tech Stack

- **Framework**: NestJS (Node.js)
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: TypeORM
- **Queue**: BullMQ (Redis)
- **WhatsApp Engine**: whatsapp-web.js (Puppeteer)
- **Payment Gateway**: Midtrans
- **Documentation**: Swagger / OpenAPI
- **Containerization**: Docker & Docker Compose

---

## 📋 Prerequisites

Sebelum memulai, pastikan Anda telah menginstal:

- **Docker & Docker Compose** (Recommended way)
- **Node.js v18+** (Optional, jika ingin run manual)
- **Git**

---

## ⚡️ Quick Start (Docker)

Cara termudah menjalankan aplikasi ini adalah menggunakan Docker. Tidak perlu install Node.js/Postgres/Redis manual.

### 1. Clone Repository

```bash
git clone <repository_url>
cd backend
```

### 2. Konfigurasi Environment

Copy file `.env.example` ke `.env` dan sesuaikan isinya:

```bash
cp .env.example .env
```

> **Penting**: Pastikan variable `DB_HOST=postgres` jika menggunakan Docker (sudah dihandle otomatis oleh docker-compose, tapi biarkan `.env` default untuk development lokal).
> Untuk `APP_PORT` default adalah `2004`.
> Untuk `DB_PORT` default eksternal adalah `5433` (agar tidak bentrok dengan Postgres lokal di 5432).

### 3. Jalankan Aplikasi

```bash
docker-compose up -d --build
```

Tunggu beberapa saat hingga proses build selesai dan container berjalan.

### 4. Akses Aplikasi

- **API**: [http://localhost:2004/api](http://localhost:2004/api)
- **Swagger Documentation**: [http://localhost:2004/docs](http://localhost:2004/docs)
- **Database (via Host)**: `localhost:5433`
- **Redis (via Host)**: `localhost:6379`

---

## 🛠 Manual Installation (Tanpa Docker)

Jika Anda ingin menjalankan secara manual di local machine:

1. **Jalankan Database**: Pastikan PostgreSQL & Redis berjalan di komputer Anda.
2. **Update .env**: Sesuaikan `DB_HOST`, `DB_PORT` (biasanya 5432), `DB_USERNAME`, `DB_PASSWORD` sesuai database lokal Anda.
3. **Install Dependencies**:
   ```bash
   npm install
   ```
4. **Jalankan Migration** (jika `synchronize: false`):
   ```bash
   npm run typeorm migration:run
   ```
5. **Start Server**:
   ```bash
   npm run start:dev
   ```

---

## 🚢 Deployment (Production)

Untuk deployment ke server production:

1. Gunakan file `docker-compose.prod.yml`.
2. Pastikan file `.env` sudah menggunakan setting production (password kuat, debug false).
3. Jalankan command:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d --build
   ```
4. Aplikasi akan berjalan dengan restart policy `always` dan optimasi production.

---

## 🧪 Testing

Untuk panduan testing manual endpoint-endpoint utama (Auth, WhatsApp Connect, Blasting), silakan baca file:
👉 **[testing.md](./testing.md)**

---

## 🔍 Troubleshooting

- **Error Connect ECONNREFUSED (DB)**:
  - Cek apakah container database jalan: `docker ps`.
  - Pastikan tidak ada service lain yang menggunakan port 5433 (atau 5432 internal).
- **Error WhatsApp Browser/Puppeteer**:
  - Jika muncul error library linux (`qemu-x86_64` atau library missing), pastikan menggunakan `Dockerfile` terbaru yang sudah menginstal Chromium secara manual.
  - Rebuild image: `docker-compose build --no-cache`.
- **Port Conflict**:
  - Jika port 3000 terpakai, ubah `APP_PORT` di `.env` dan restart docker.

---

## 📝 License

This project is [MIT licensed](LICENSE).
