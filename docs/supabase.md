# Supabase Infrastructure and Integration

Dokumen ini menjelaskan status arsitektur, verifikasi endpoint, konfigurasi variabel lingkungan (*environment variables*), dan operasional stack Supabase *self-hosted* yang digunakan oleh Manufacturing Information System (MIS).

> [!IMPORTANT]
> Seluruh nilai rahasia, kredensial, user, password, token, URL, port, IP dan API key sensitif hanya disimpan di dalam file `.env` dan dilarang keras dicantumkan secara langsung pada dokumentasi maupun kode publik. Dokumen ini hanya merujuk nama variabel lingkungan tanpa nilai mentah.

---

## Container Status & Services

Layanan Supabase berjalan menggunakan Docker Compose pada unit systemd `supabase.service` di direktori host `/opt/services/supabase`. Seluruh kontainer berada dalam status sehat (*healthy*):

| Kontainer | Layanan | Keterangan |
| :--- | :--- | :--- |
| `supabase-envoy` | API Gateway & Ingress | Gateway utama rute API & Studio via reverse proxy |
| `supabase-pooler` | Supavisor (Connection Pooler) | Connection pooler untuk PostgreSQL |
| `supabase-db` | PostgreSQL 17 Engine | Database engine PostgreSQL 17 |
| `supabase-studio` | Web Dashboard UI | Dashboard administrasi web (via Envoy Gateway) |
| `supabase-auth` | GoTrue Auth Server | Layanan autentikasi & manajemen token JWT (via Envoy Gateway) |
| `supabase-rest` | PostgREST API | RESTful API otomatis berbasis skema database (via Envoy Gateway) |
| `supabase-realtime` | WebSocket Realtime Server | Sinkronisasi data real-time via WebSocket (via Envoy Gateway) |
| `supabase-storage` | Storage & S3 API | Penyimpanan file objek & S3-compatible API (via Envoy Gateway) |
| `supabase-edge-functions` | Deno Edge Runtime | Runtime untuk serverless Edge Functions (via Envoy Gateway) |
| `supabase-meta` | Postgres Metadata Manager | Manajemen metadata database untuk Studio (via Envoy Gateway) |
| `supabase-imgproxy` | Image Resizer | Optimasi dan resizing file gambar (via Envoy Gateway) |

---

## Endpoint & Network Verification

Hasil pengujian konektivitas endpoint dan jaringan:

1. **Database PostgreSQL**:
   - Perintah pengujian:
     ```bash
     pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}"
     ```
   - Status: Koneksi berhasil diterima (`accepting connections`) melalui port connection pooler tanpa konflik dengan PostgreSQL lokal server.
2. **Dashboard Studio Web**:
   - Endpoint: `${SUPABASE_DASHBOARD_URL}`
   - Status: `HTTP/2 200 OK` (Web Dashboard termuat dengan baik).
3. **REST API Gateway**:
   - Endpoint: `${SUPABASE_URL}/rest/v1/`
   - Status: `HTTP/2 200 OK` (Swagger OpenAPI schema responsif menggunakan key autentikasi yang valid).
4. **Auto-Start Server**:
   - Systemd Service: Unit systemd Supabase telah diaktifkan (`enabled`), sehingga seluruh stack Supabase otomatis menyala saat host reboot.

---

## Configuration & Environment Variables

Kredensial dan konfigurasi koneksi didefinisikan di dalam file `.env`. Gunakan variabel-variabel berikut untuk menghubungkan modul aplikasi, backend ORM, migrasi skema, atau client SDK:

### 1. Dashboard Web Studio

| Nama Variabel | Keterangan |
| :--- | :--- |
| `SUPABASE_DASHBOARD_URL` | URL akses Web Studio Dashboard *(disimpan di `.env`)* |
| `SUPABASE_DASHBOARD_USERNAME` | Username login Dashboard *(disimpan di `.env`)* |
| `SUPABASE_DASHBOARD_PASSWORD` | Password login Dashboard *(disimpan di `.env`)* |

### 2. Koneksi Database Langsung (PostgreSQL / ORM / DBeaver)

| Nama Variabel | Keterangan |
| :--- | :--- |
| `POSTGRES_HOST` | Host database *(disimpan di `.env`)* |
| `POSTGRES_PORT` | Port host untuk session mode via Supavisor *(disimpan di `.env`)* |
| `POSTGRES_PORT_TRANSACTION` | Port host untuk transaction mode via Supavisor *(disimpan di `.env`)* |
| `POSTGRES_DB` | Nama database utama *(disimpan di `.env`)* |
| `POSTGRES_USER` | Username database *(disimpan di `.env`)* |
| `POSTGRES_PASSWORD` | Password database *(disimpan di `.env`)* |
| `DATABASE_URL` | Format URI koneksi lengkap database: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}` |

### 3. API Keys untuk Client / Frontend & Backend Services

| Nama Variabel | Scope Akses | Keterangan |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Publik / Backend | URL root endpoint API Supabase Gateway *(disimpan di `.env`)* |
| `SUPABASE_ANON_KEY` | Client / Frontend | Publishable API key publik dengan pembatasan hak akses berbasis RLS (*Row Level Security*) *(disimpan di `.env`)* |
| `SUPABASE_JWT_ANON_KEY` | Client / Frontend | Token JWT format legasi untuk kompatibilitas client tertentu *(disimpan di `.env`)* |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-Side Only | Secret key dengan hak akses penuh (*bypass RLS*). **Dilarang keras mengekspos variabel ini ke client-side/browser.** *(disimpan di `.env`)* |

---

## Application Integration Examples

### 1. Supabase Client SDK (JavaScript / TypeScript)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### 2. Database ORM / Driver (Prisma / Drizzle / Node-Postgres)

Gunakan variabel `DATABASE_URL` yang tersusun dari variabel database:

```bash
# Format Connection String
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
```

---

## Operational Commands

Stack Supabase dikelola dari direktori `/opt/services/supabase`. Perintah operasional sehari-hari dapat dijalankan menggunakan script pembantu `run.sh` di folder tersebut atau melalui `systemctl`:

- **Cek Status Layanan**:
  ```bash
  sudo systemctl status supabase
  # atau
  cd /opt/services/supabase && sh run.sh status
  ```
- **Melihat Log Kontainer**:
  ```bash
  cd /opt/services/supabase && sh run.sh logs
  # Contoh melihat log service tertentu (misal auth):
  cd /opt/services/supabase && sh run.sh logs auth
  ```
- **Restart Stack**:
  ```bash
  sudo systemctl restart supabase
  # atau
  cd /opt/services/supabase && sh run.sh restart
  ```
- **Menghentikan Stack**:
  ```bash
  sudo systemctl stop supabase
  # atau
  cd /opt/services/supabase && sh run.sh stop
  ```
