# Operations and Runtime Guide

Dokumen ini adalah panduan operasional (*canonical runbook*) untuk Manufacturing Information System (MIS) yang mencakup manajemen layanan *systemd*, prosedur *deployment & build*, pemantauan *logging*, *health check*, sinkronisasi tipe database, prosedur *backup & disaster recovery*, serta panduan penanganan insiden (*troubleshooting*).

> [!IMPORTANT]
> Seluruh nilai rahasia, kredensial, user, password, token, URL, port, IP, dan API key sensitif hanya disimpan di dalam file `.env` dan dilarang keras dicantumkan secara langsung pada dokumentasi maupun kode publik. Dokumen ini hanya merujuk nama variabel lingkungan tanpa nilai mentah.

---

## Runtime Overview

| Parameter | Konfigurasi / Nilai Referensi |
| :--- | :--- |
| **Repository Root** | `/opt/services/manufacturing-information-system` |
| **Systemd Service Unit** | `manufacturing-information-system.service` |
| **Unit File Location** | `/etc/systemd/system/manufacturing-information-system.service` |
| **Unit Template** | `scripts/systemd/manufacturing-information-system.service` |
| **Runtime User & Group** | `mrdev` / `mrmads-group` |
| **Production Server Script** | `scripts/serve-prod.mjs` (Node.js Native HTTP Server, SPA fallback, Gzip) |
| **Production Build Directory** | `dist/manufacturing-information-system/browser` |
| **Syslog Identifier** | `mis-frontend` |
| **Internal Listen Host & Port** | `${APP_BIND_HOST}`:`${APP_PORT}` |
| **WireGuard Private Endpoint** | `${APP_WIREGUARD_IP}`:`${APP_PORT}` |
| **Public Origin** | `https://${APP_DOMAIN}` |
| **Edge Reverse Proxy** | Caddy di VPS `${TUNNEL_VPS_HOST}` (lihat [Public Routing and Edge Proxy](routing-public.md)) |
| **Backend & Database** | Supabase Self-Hosted di `/opt/services/supabase` (unit `supabase.service`) |

Layanan berjalan di atas host Ubuntu native secara terkelola melalui *systemd*, menyajikan berkas build statis Angular dengan kompresi gzip serta fallback SPA (`index.html`) untuk routing sisi klien. Layanan dikonfigurasi untuk menyala otomatis saat server *boot/reboot* dan melakukan *auto-restart* jika terjadi *failure*.

---

## Operational Rules

1. **Hak Akses File & Direktori**:
   - Seluruh file dan direktori dalam repositori dimiliki oleh user `mrdev` dan group `mrmads-group` dengan umask `0002` agar tetap *group-writable*. Gunakan `sudo` jika operasi memerlukan izin administratif.
2. **Zero Hardcoded Secrets**:
   - Dilarang keras menuliskan nilai rahasia, port mentah, IP mentah, atau token ke dalam kode sumber, git history, maupun dokumentasi.
3. **Isolasi Bundle Klien**:
   - Bundle frontend hanya boleh memuat `SUPABASE_URL` dan `SUPABASE_ANON_KEY`. Kredensial administratif seperti `SUPABASE_SERVICE_ROLE_KEY` dan password database dilarang keras dimasukkan ke dalam frontend.
4. **Non-Breaking Deployment**:
   - Proses build (`npm run build`) dapat dijalankan langsung di server selagi layanan aktif. Jangan menghentikan *service* sebelum build selesai agar tidak menimbulkan *downtime* yang tidak perlu.
5. **Standar Direktori Backup**:
   - Setiap backup yang dibuat wajib disimpan di bawah direktori:
     `/data/backups/manufacturing-information-system/<jenis-backup>/<YYYYMMDD-HHMMSS>/`

---

## Environment Configuration

Aplikasi menggunakan file `.env` sebagai sumber kebenaran tunggal untuk seluruh variabel lingkungan. File `.env` bersifat privat dan diabaikan oleh Git (*untracked*).

### Variabel Lingkungan Utama

| Variabel | Kategori | Keterangan |
| :--- | :--- | :--- |
| `APP_DOMAIN` | Routing | Domain publik aplikasi (diarahkan via Caddy VPS) |
| `APP_WIREGUARD_IP` | Network | IP interface WireGuard server aplikasi |
| `APP_PORT` | Runtime | Port internal aplikasi untuk melayani request HTTP |
| `APP_BIND_HOST` | Runtime | IP host listen (`0.0.0.0` atau `127.0.0.1`) |
| `SUPABASE_URL` | Frontend / Client | URL root endpoint API Supabase Gateway |
| `SUPABASE_ANON_KEY` | Frontend / Client | Public API Key Supabase yang tunduk pada RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-Side Only | Secret key Supabase untuk bypass RLS (dilarang di frontend) |
| `POSTGRES_HOST` | Database | Host database PostgreSQL / Supavisor |
| `POSTGRES_PORT` | Database | Port session pooler PostgreSQL Supabase |
| `POSTGRES_DB` | Database | Nama database PostgreSQL |
| `POSTGRES_USER` | Database | User autentikasi PostgreSQL |
| `POSTGRES_PASSWORD` | Database | Password autentikasi PostgreSQL |
| `DATABASE_URL` | Database | Format URI koneksi lengkap database PostgreSQL |

### Injeksi Environment ke Frontend

Sebelum proses *build* atau *serve*, script `scripts/generate-env.mjs` dijalankan secara otomatis melalui hook `prebuild` dan `prestart` di `package.json`. Script ini membaca nilai `SUPABASE_URL` dan `SUPABASE_ANON_KEY` dari `.env` lokal dan menuliskannya ke `src/environments/environment.ts` serta `src/environments/environment.development.ts`. Berkas tersebut telah didaftarkan di `.gitignore` untuk mencegah kebocoran konfigurasi.

---

## Service Management (systemd)

Layanan produksi dikelola melalui systemd unit `manufacturing-information-system.service`.

### Perintah Manajemen Layanan

- **Melihat Status Layanan**:
  ```bash
  sudo systemctl status manufacturing-information-system.service
  ```
- **Memulai Layanan (*Start*)**:
  ```bash
  sudo systemctl start manufacturing-information-system.service
  ```
- **Menghentikan Layanan (*Stop*)**:
  ```bash
  sudo systemctl stop manufacturing-information-system.service
  ```
- **Memuat Ulang Layanan (*Restart*)**:
  ```bash
  sudo systemctl restart manufacturing-information-system.service
  ```
- **Mengaktifkan Auto-Start saat Boot (*Enable*)**:
  ```bash
  sudo systemctl enable manufacturing-information-system.service
  ```
- **Memeriksa Status Auto-Start**:
  ```bash
  sudo systemctl is-enabled manufacturing-information-system.service
  ```
- **Memuat Ulang Konfigurasi Unit (*Daemon Reload*)**:
  Jalankan perintah ini jika terjadi perubahan pada file unit `/etc/systemd/system/manufacturing-information-system.service`:
  ```bash
  sudo systemctl daemon-reload
  sudo systemctl restart manufacturing-information-system.service
  ```

---

## Deployment and Build Workflow

Berikut adalah alur standar untuk melakukan kompilasi dan rilis pembaruan ke lingkungan produksi:

### 1. Sinkronisasi Dependensi
Jika terdapat pembaruan pada `package.json` atau `package-lock.json`:
```bash
cd /opt/services/manufacturing-information-system
npm ci
```

### 2. Validasi Kode dan Pengujian
Pastikan tidak ada kesalahan linting atau regresi pengujian unit sebelum melakukan build produksi:
```bash
# Analisis kode statis dengan angular-eslint
npm run lint

# Pengujian unit berbasis Vitest
npm test -- --watch=false
```

### 3. Kompilasi Bundle Produksi
Jalankan kompilasi Angular. Script `prebuild` akan otomatis memverifikasi dan memperbarui konfigurasi environment:
```bash
npm run build
```
Hasil build akan terbit pada direktori `dist/manufacturing-information-system/browser/`.

### 4. Restart Layanan
Terapkan versi terbaru dengan me-restart unit systemd:
```bash
sudo systemctl restart manufacturing-information-system.service
```

### 5. Verifikasi Deployment
Lakukan *smoke test* untuk memastikan aplikasi merespons dengan benar (lihat bagian [Health Check and Smoke Testing](#health-check-and-smoke-testing)).

---

## Logging and Observability

Layanan menulis log operasional langsung ke `stdout`/`stderr`, yang ditangkap secara terpusat oleh *systemd journal*.

### Perintah Membaca Log

- **Streaming Log Real-time**:
  ```bash
  journalctl -u manufacturing-information-system.service -f
  ```
- **Melihat 100 Baris Log Terakhir**:
  ```bash
  journalctl -u manufacturing-information-system.service -n 100 --no-pager
  ```
- **Membaca Log Berdasarkan Syslog Identifier**:
  ```bash
  journalctl -t mis-frontend -n 100 --no-pager
  ```
- **Menampilkan Log Error Saja**:
  ```bash
  journalctl -u manufacturing-information-system.service -p err -b --no-pager
  ```
- **Membaca Log Sejak Waktu Tertentu**:
  ```bash
  journalctl -u manufacturing-information-system.service --since "1 hour ago" --no-pager
  ```

---

## Health Check and Smoke Testing

Untuk memastikan aplikasi aktif, dapat diakses, dan menyajikan berkas dengan aman, lakukan pengujian bertingkat:

### 1. Health Check Lokal / Internal Host
Uji apakah server Node.js lokal merespons pada port internal `${APP_PORT}`:
```bash
curl -I "http://${APP_BIND_HOST:-127.0.0.1}:${APP_PORT}/login"
```
Ekspektasi respons:
- Status `HTTP/1.1 200 OK`
- Header keamanan: `X-Content-Type-Options: nosniff` dan `X-Frame-Options: DENY`
- Header cache: `Cache-Control: public, max-age=0, must-revalidate` untuk dokumen HTML

### 2. Smoke Test Jaringan Private WireGuard
Uji apakah endpoint dapat diakses melalui interface IP WireGuard server:
```bash
curl -I "http://${APP_WIREGUARD_IP}:${APP_PORT}/login"
```
Ekspektasi respons: Status `HTTP/1.1 200 OK`.

### 3. Smoke Test Domain Publik (via Edge Proxy)
Uji apakah reverse proxy Caddy di edge VPS meneruskan trafik publik dengan enkripsi TLS yang valid:
```bash
curl -I "https://${APP_DOMAIN}/login"
```
Ekspektasi respons: Status `HTTP/2 200 OK` dengan sertifikat HTTPS yang valid.

### 4. Verifikasi Kompresi Gzip
Pastikan server mengompresi aset statis saat diminta oleh klien:
```bash
curl -H "Accept-Encoding: gzip" -I "http://${APP_BIND_HOST:-127.0.0.1}:${APP_PORT}/" | grep -i "content-encoding"
```
Ekspektasi respons: `Content-Encoding: gzip`.

---

## Database Operations and Type Generation

Frontend menggunakan schema types yang dihasilkan langsung dari skema database PostgreSQL Supabase untuk menjamin *end-to-end type safety*.

### Sinkronisasi Tipe Skema Database
Setiap kali ada migrasi atau perubahan skema tabel di Supabase:
1. Pastikan stack Supabase dalam kondisi aktif:
   ```bash
   sudo systemctl status supabase
   ```
2. Jalankan script sinkronisasi tipe:
   ```bash
   npm run types:db
   ```
3. Script akan menghubungkan CLI Supabase ke skema `public` PostgreSQL dan memperbarui berkas `src/types/database.types.ts`.
4. Jalankan `npm run lint` dan `npm test -- --watch=false` untuk memastikan integritas tipe pada komponen frontend.

---

## Backup and Disaster Recovery

Seluruh prosedur backup wajib mematuhi konvensi lokasi penyimpanan di `/data/backups/manufacturing-information-system/<jenis-backup>/<YYYYMMDD-HHMMSS>/`.

### 1. Backup Source Code & Konfigurasi
Digunakan untuk mencadangkan kode sumber aplikasi, skrip, dan konfigurasi tanpa menyertakan artefak build (`dist`) atau pustaka dependensi (`node_modules`).

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/data/backups/manufacturing-information-system/application-source/${TIMESTAMP}"
sudo mkdir -p "${BACKUP_DIR}"

tar --exclude='./node_modules' \
    --exclude='./dist' \
    --exclude='./.git' \
    -czf "${BACKUP_DIR}/mis-source-${TIMESTAMP}.tar.gz" \
    -C /opt/services/manufacturing-information-system .

sudo chown -R mrdev:mrmads-group "${BACKUP_DIR}"
```

### 2. Backup File Konfigurasi Lingkungan (.env)
File `.env` memuat variabel rahasia dan konfigurasi host sehingga harus diamankan dengan hak akses ketat (`chmod 600`):

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/data/backups/manufacturing-information-system/env/${TIMESTAMP}"
sudo mkdir -p "${BACKUP_DIR}"

sudo cp /opt/services/manufacturing-information-system/.env "${BACKUP_DIR}/.env"
sudo chmod 600 "${BACKUP_DIR}/.env"
sudo chown mrdev:mrmads-group "${BACKUP_DIR}/.env"
```

### 3. Backup Database PostgreSQL Supabase
Pencadangan database dilakukan menggunakan `pg_dump` melalui port pooler PostgreSQL Supabase:

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/data/backups/manufacturing-information-system/database/${TIMESTAMP}"
sudo mkdir -p "${BACKUP_DIR}"

PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -F c \
  -f "${BACKUP_DIR}/mis-db-${TIMESTAMP}.dump"

sudo chown -R mrdev:mrmads-group "${BACKUP_DIR}"
```

### 4. Prosedur Disaster Recovery (Restore)

Jika server perlu dipulihkan secara penuh pada instance baru:

1. **Persiapan Direktori & Ekstraksi Source**:
   ```bash
   sudo mkdir -p /opt/services/manufacturing-information-system
   sudo chown mrdev:mrmads-group /opt/services/manufacturing-information-system
   tar -xzf "/data/backups/manufacturing-information-system/application-source/<TIMESTAMP>/mis-source-<TIMESTAMP>.tar.gz" \
       -C /opt/services/manufacturing-information-system
   ```
2. **Pemulihan File Konfigurasi Lingkungan**:
   ```bash
   cp "/data/backups/manufacturing-information-system/env/<TIMESTAMP>/.env" \
      /opt/services/manufacturing-information-system/.env
   chmod 600 /opt/services/manufacturing-information-system/.env
   ```
3. **Instalasi Dependensi & Build Produksi**:
   ```bash
   cd /opt/services/manufacturing-information-system
   npm ci
   npm run build
   ```
4. **Pemulihan Database Supabase**:
   ```bash
   PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore \
     -h "${POSTGRES_HOST}" \
     -p "${POSTGRES_PORT}" \
     -U "${POSTGRES_USER}" \
     -d "${POSTGRES_DB}" \
     --clean --if-exists \
     "/data/backups/manufacturing-information-system/database/<TIMESTAMP>/mis-db-<TIMESTAMP>.dump"
   ```
5. **Pemasangan & Pengaktifan Unit systemd**:
   ```bash
   sudo cp /opt/services/manufacturing-information-system/scripts/systemd/manufacturing-information-system.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now manufacturing-information-system.service
   ```
6. **Verifikasi Operasional**:
   Lakukan pengujian health check pada endpoint lokal dan publik.

---

## Troubleshooting and Incident Response

### 1. Service Gagal Start: `Directory does not exist`
- **Gejala**: Log `journalctl -u manufacturing-information-system.service` menampilkan pesan:
  `[MIS Production Server] Error: Directory ".../dist/..." does not exist.`
- **Penyebab**: Direktori artefak produksi belum dikompilasi atau terhapus.
- **Solusi**:
  ```bash
  cd /opt/services/manufacturing-information-system
  npm run build
  sudo systemctl restart manufacturing-information-system.service
  ```

### 2. Port Collision: `EADDRINUSE`
- **Gejala**: Service gagal menyala dengan error `listen EADDRINUSE: address already in use`.
- **Penyebab**: Port `${APP_PORT}` sedang digunakan oleh proses lain atau instance lama yang *hang*.
- **Solusi**:
  1. Periksa proses yang mendengarkan port:
     ```bash
     sudo ss -tulpn | grep ":${APP_PORT}"
     ```
  2. Hentikan proses yang berkonflik atau sesuaikan variabel `APP_PORT` pada `.env`.
  3. Jalankan kembali service:
     ```bash
     sudo systemctl restart manufacturing-information-system.service
     ```

### 3. Edge Reverse Proxy Mengembalikan `502 Bad Gateway`
- **Gejala**: Akses browser ke `https://${APP_DOMAIN}` menampilkan halaman error `502 Bad Gateway`.
- **Penyebab**: Service backend tidak berjalan, port tidak merespons, atau antarmuka WireGuard terputus.
- **Solusi**:
  1. Periksa status unit systemd lokal:
     ```bash
     sudo systemctl status manufacturing-information-system.service
     ```
  2. Pastikan port internal aktif merespons:
     ```bash
     curl -I "http://127.0.0.1:${APP_PORT}/login"
     ```
  3. Periksa status koneksi tunnel WireGuard:
     ```bash
     sudo wg show
     ping -c 3 "${TUNNEL_VPS_WIREGUARD_IP}"
     ```

### 4. Autentikasi / API Supabase Gagal (Network Error / 401 Unauthorized)
- **Gejala**: Login gagal dengan pesan koneksi terputus atau autentikasi ditolak.
- **Penyebab**: Layanan Supabase belum menyala, atau nilai `SUPABASE_ANON_KEY` / `SUPABASE_URL` pada `.env` belum diinjeksikan ke bundle frontend.
- **Solusi**:
  1. Periksa kesehatan layanan Supabase:
     ```bash
     sudo systemctl status supabase
     ```
  2. Generate ulang berkas environment dan kompilasi ulang bundle produksi:
     ```bash
     cd /opt/services/manufacturing-information-system
     npm run build
     sudo systemctl restart manufacturing-information-system.service
     ```
