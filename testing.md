# WhatsApp Blasting SaaS - Testing Guide

Panduan ini akan membantu Anda melakukan pengujian (testing) fungsionalitas Backend WhatsApp Blasting SaaS secara manual menggunakan Swagger UI.

**Persiapan:**

- Pastikan aplikasi berjalan: `docker-compose up -d`
- Buka Swagger UI: [http://localhost:3000/docs](http://localhost:3000/docs)

---

## 🚀 Skenario Test Lengkap

Ikuti urutan test di bawah ini untuk memverifikasi fitur dari awal hingga akhir.

### 1. Authentication (User Baru)

| Langkah           | Endpoint         | Method | Body / Params                                                                           | Ekspektasi                                                                                                                         |
| :---------------- | :--------------- | :----- | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| **Register User** | `/auth/register` | `POST` | `{"email": "mytest@example.com", "password": "password123", "name": "Tester"}`          | Status `201 Created`. Copy `access_token` dari response untuk login nanti jika perlu, tapi endpoint ini biasanya auto-login di FE. |
| **Login**         | `/auth/login`    | `POST` | `{"email": "mytest@example.com", "password": "password123"}`                            | Status `200 OK`. **Response berisi `accessToken`.** COPY token ini!                                                                |
| **Set Token**     | _Swagger UI_     | -      | Klik tombol `Authorize` (ikon gembok) di atas kanan, paste token: `Bearer <token_anda>` | Gembok tertutup (Authorized).                                                                                                      |
| **Check Profile** | `/auth/profile`  | `GET`  | -                                                                                       | Status `200 OK`. Menampilkan data user Anda.                                                                                       |

### 2. Subscription & Payments (Membeli Paket)

| Langkah              | Endpoint                 | Method | Body / Params                                                                | Ekspektasi                                                                    |
| :------------------- | :----------------------- | :----- | :--------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| **List Packages**    | `/packages`              | `GET`  | -                                                                            | Status `200 OK`. Pilih satu `id` paket (misal paket "Basic").                 |
| **Create Payment**   | `/payments`              | `POST` | `{"packageId": "<package_uuid>"}`                                            | Status `201 Created`. Response berisi `token` (Snap Token) dan `redirectUrl`. |
| **Simulasi Bayar**   | _Midtrans_               | -      | Buka `redirectUrl` di browser, gunakan Mode Simulator Midtrans (klik bayar). | Pembayaran berhasil di halaman Midtrans.                                      |
| **Cek Subscription** | `/subscriptions/current` | `GET`  | -                                                                            | Status `200 OK`. Status subscription harus `active`.                          |

### 3. WhatsApp Integration (Koneksi)

| Langkah        | Endpoint            | Method | Body / Params                                                                                                                  | Ekspektasi                                                                          |
| :------------- | :------------------ | :----- | :----------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **Connect WA** | `/whatsapp/connect` | `POST` | -                                                                                                                              | Status `201 Created`. Response berisi `qrCode` (string teks). Copy string tersebut. |
| **Scan QR**    | _QR Code Gen_       | -      | Paste string QR ke [QR Code Generator](https://www.qr-code-generator.com/) lalu scan dengan HP WhatsApp Anda (Linked Devices). | WhatsApp Web di HP terkoneksi.                                                      |
| **Cek Status** | `/whatsapp/status`  | `GET`  | -                                                                                                                              | Status `200 OK`. `isReady: true`.                                                   |

### 4. Message Blasting (Kirim Pesan)

| Langkah           | Endpoint             | Method | Body / Params                                                                                                    | Ekspektasi                                                                                       |
| :---------------- | :------------------- | :----- | :--------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **Kirim Single**  | `/whatsapp/send`     | `POST` | `{"phoneNumber": "628xxx", "message": "Halo ini test"}`                                                          | Status `201 Created`. Cek HP penerima, pesan harus masuk.                                        |
| **Buat Campaign** | `/blasts`            | `POST` | `{"name": "Promo Jan", "message": "Halo {name}, promo!", "phoneNumbers": ["628xxx", "628yyy"], "delayMs": 5000}` | Status `201 Created`. Response berisi `id` blast.                                                |
| **Start Blast**   | `/blasts/{id}/start` | `POST` | `{id}` dari langkah sebelumnya                                                                                   | Status `200 OK`. Blast dimulai di background.                                                    |
| **Cek Progress**  | `/blasts/{id}`       | `GET`  | `{id}`                                                                                                           | Status `200 OK`. Field `sentCount` bertambah, `status` berubah jadi `completed` setelah selesai. |

### 5. Reporting (Laporan)

| Langkah        | Endpoint                      | Method | Body / Params | Ekspektasi                                                                 |
| :------------- | :---------------------------- | :----- | :------------ | :------------------------------------------------------------------------- |
| **Dashboard**  | `/reports/dashboard`          | `GET`  | -             | Status `200 OK`. Stats total blast dan pesan harus sesuai.                 |
| **Export CSV** | `/reports/blasts/{id}/export` | `GET`  | `{id}`        | Status `200 OK`. File CSV terdownload berisi laporan pengiriman per nomor. |

### 6. Admin Features (Optional - Login sebagai Admin)

_Untuk test ini, Anda perlu mengubah role user menjadi `admin` di database secara manual via pgAdmin atau script, karena endpoint register defaultnya user biasa._

| Langkah            | Endpoint            | Method | Body / Params                                | Ekspektasi                                                |
| :----------------- | :------------------ | :----- | :------------------------------------------- | :-------------------------------------------------------- |
| **Create Package** | `/packages`         | `POST` | `{"name": "Pro Plan", "price": 500000, ...}` | Status `201 Created`. Paket baru muncul.                  |
| **All Blasts**     | `/blasts/admin/all` | `GET`  | -                                            | Status `200 OK`. Melihat semua blast campaign semua user. |

---

## ❓ Troubleshooting

- **Error: Connect ECONNREFUSED**: Database belum ready / salah port. Cek `docker ps`.
- **WA Session Disconnected**:
  1. Panggil `/whatsapp/disconnect` (`DELETE`)
  2. Panggil `/whatsapp/connect` lagi untuk scan QR baru.
- **Blast Stuck**:
  1. Cek log redis/bullmq di terminal docker.
  2. Pastikan WA session status `isReady: true`.
