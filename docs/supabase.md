# Supabase Infrastructure and Integration

Dokumen ini menjelaskan status arsitektur, verifikasi endpoint, konfigurasi variabel lingkungan (*environment variables*), dan operasional stack Supabase *self-hosted* yang digunakan oleh Manufacturing Information System (MIS).

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

## Supabase Storage & Media Management

Sistem manufaktur menggunakan Supabase Storage terintegrasi untuk menyimpan file biner operasional (foto QC, rekaman SOP proses perakitan semikonduktor, diagram skematik, dan laporan kerja PDF).

### Bucket Konfigurasi

| Parameter | Nilai / Konfigurasi | Keterangan |
| :--- | :--- | :--- |
| **Bucket ID** | `manufacturing-media` | Bucket privat utama sistem |
| **Akses Publik** | `false` (Private) | Wajib autentikasi & token JWT / Signed URL |
| **Batas Ukuran File** | `52428800` bytes (50 MB) | Mencegah beban kapasitas berlebih |
| **Allowed MIME Types** | `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`, `video/mp4`, `video/webm`, `application/pdf` | Dibatasi hanya file media dan dokumen teknis yang sah |

### Kebijakan Row Level Security (RLS) Storage

Row Level Security diaktifkan secara ketat pada tabel `storage.objects` dan `storage.buckets`:

1. **SELECT**: Hanya pengguna terautentikasi (`authenticated`) yang dapat membaca atau mengunduh file dari bucket `manufacturing-media`.
2. **INSERT**: Hanya pengguna terautentikasi (`authenticated`) yang diizinkan mengunggah file baru.
3. **UPDATE**: Diizinkan untuk pengguna terautentikasi guna mendukung fitur penimpaan file (*upsert*).
4. **DELETE**: Diizinkan untuk pengguna terautentikasi untuk pembersihan atau penggantian file usang.
5. **Akses Anonim**: Seluruh permintaan tanpa token ditolak otomatis oleh RLS (`new row violates row-level security policy`).

Inisialisasi bucket dan penegakan kebijakan RLS dilakukan secara terotomatisasi melalui script:
```bash
node scripts/setup-storage.mjs
```

---

## Database Schema & Multi-Company Isolation

Database PostgreSQL 17 pada stack Supabase mengelola 40 tabel inti yang mencakup modul Administrasi, Akuntansi & Keuangan, Manufaktur & Produksi Semikonduktor, Logistik & Inventaris, serta Notifikasi & Audit.

### Struktur Skema & Row Level Security (RLS)

- **Isolasi Multi-Company**: Seluruh data operasional diisolasi berbasis kolom `company_id` dengan Row Level Security (`FORCE ROW LEVEL SECURITY`) aktif pada setiap tabel.
- **Kebijakan Akses Pengguna**: Hak akses pengguna terhadap data suatu entitas diverifikasi melalui relasi tabel `user_company_assignment` yang dioptimalkan dengan fungsi `SECURITY DEFINER` (`public.get_user_company_ids()` dan `public.is_company_owner()`) guna mencegah rekursi kebijakan RLS.
- **Prosedur Bootstrap Otomatis**: Prosedur tersimpan `bootstrap_company_data(p_company_id uuid, p_creator_user_id uuid)` secara otomatis mengisi data awal (*seed*) saat entitas perusahaan baru dibentuk, meliputi:
  - 11 Unit Pengukuran (*Unit of Measure* / UOM).
  - 9 Kategori Konfigurasi (*Configuration Category*).
  - 106 Akun Buku Besar (*Chart of Accounts* / COA) dengan struktur hierarki 3 level.
  - 21 Pemetaan Akun Akuntansi (*Accounting Mapping*) untuk integrasi otomatis jurnal transaksi.
  - 53 Pemetaan Laporan Keuangan (*Financial Report Mapping*) untuk Neraca & Laba Rugi.
  - 1 Periode Akuntansi Awal (*Accounting Period*).
  - 273 Matriks Izin Akses (*Access Permissions*) untuk 6 peran pengguna (*owner*, *kepala_konveksi*, *finance*, *operator_potong*, *operator_jahit*, *operator_finishing*).
  - 13 Urutan Nomor Dokumen (*Document Sequence*) dengan format penomoran standar.

### Eksekusi Migrasi & Type Generator

- File migrasi SQL tersimpan di `supabase/migrations/20260913000001_foundation_schema.sql`.
- Script eksekusi migrasi mandiri:
  ```bash
  node scripts/apply-migration.mjs
  ```
- Generate ulang kontrak tipe TypeScript skema database ke `src/types/database.types.ts`:
  ```bash
  npm run types:db
  ```

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

### Dashboard Web Studio

| Nama Variabel | Keterangan |
| :--- | :--- |
| `SUPABASE_DASHBOARD_URL` | URL akses Web Studio Dashboard *(disimpan di `.env`)* |
| `SUPABASE_DASHBOARD_USERNAME` | Username login Dashboard *(disimpan di `.env`)* |
| `SUPABASE_DASHBOARD_PASSWORD` | Password login Dashboard *(disimpan di `.env`)* |

### Koneksi Database Langsung (PostgreSQL / ORM / DBeaver)

| Nama Variabel | Keterangan |
| :--- | :--- |
| `POSTGRES_HOST` | Host database *(disimpan di `.env`)* |
| `POSTGRES_PORT` | Port host untuk session mode via Supavisor *(disimpan di `.env`)* |
| `POSTGRES_PORT_TRANSACTION` | Port host untuk transaction mode via Supavisor *(disimpan di `.env`)* |
| `POSTGRES_DB` | Nama database utama *(disimpan di `.env`)* |
| `POSTGRES_USER` | Username database *(disimpan di `.env`)* |
| `POSTGRES_PASSWORD` | Password database *(disimpan di `.env`)* |
| `DATABASE_URL` | Format URI koneksi lengkap database: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}` |

### API Keys untuk Client / Frontend & Backend Services

| Nama Variabel | Scope Akses | Keterangan |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Publik / Backend | URL root endpoint API Supabase Gateway *(disimpan di `.env`)* |
| `SUPABASE_ANON_KEY` | Client / Frontend | Publishable API key publik dengan pembatasan hak akses berbasis RLS (*Row Level Security*) *(disimpan di `.env`)* |
| `SUPABASE_JWT_ANON_KEY` | Client / Frontend | Token JWT format legasi untuk kompatibilitas client tertentu *(disimpan di `.env`)* |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-Side Only | Secret key dengan hak akses penuh (*bypass RLS*). **Dilarang keras mengekspos variabel ini ke client-side/browser.** *(disimpan di `.env`)* |

---

## Application Integration Examples

### Supabase Client SDK (JavaScript / TypeScript)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### Database ORM / Driver (Prisma / Drizzle / Node-Postgres)

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
