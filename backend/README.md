# Backend MIS

Direktori ini berisi kode layanan backend untuk Manufacturing Information System.

## Backend Components

- **Core Framework**: **Django** menangani *business logic*, ORM, autentikasi, otorisasi, dan administrasi sistem.
- **API Framework**: **Django Ninja** menggunakan **Pydantic** dan menghasilkan skema **OpenAPI** secara otomatis.
- **Background Tasks**: Infrastruktur **Dramatiq** dan broker Redis tersedia untuk proses asinkron. Sinkronisasi indeks pencarian memakai transactional outbox dan worker `process_outbox_event`.
- **Real-time**: **Django Channels** menggunakan `channels_redis` untuk komunikasi WebSocket. Route dasar `/ws/system/` memakai session auth dan validasi Origin.
- **Web Server**: **Granian** berjalan dalam mode ASGI (`--interface asgi`) untuk menangani HTTP dan WebSocket.
- **Time Zone**: Timestamp disimpan dalam **UTC**, sedangkan proses bisnis dan tampilan menggunakan `Asia/Jakarta` (**WIB**).

## Directory Navigation

- `core/`: Modul fondasi sistem. Berisi model dasar seperti `User`, `Tenant`, `Membership`, `AuditEvent`, `OutboxEvent`, `DocumentSequence`, `FileMetadata`, router autentikasi session, observability, dan fungsi kesehatan (Health Check).
- `tests/`: Skrip pengujian otomatis menggunakan `pytest` dan `pytest-django`.
- `accounting/`, `finance/`, `inventory/`, `labor/`, `masterdata/`, `production/`, dan `sales/`: model serta service transaksi domain MIS.
- `manage.py`: Entrypoint eksekusi Django.

## Main Commands (Root Repo)

Gunakan perintah ini dari _root_ direktori repositori:

```bash
# Menjalankan Linter & Formatter
.venv/bin/ruff check .
.venv/bin/ruff format .

# Menjalankan Testing
.venv/bin/pytest -v
.venv/bin/pytest --testmon --reuse-db

# Migrasi Database
.venv/bin/python backend/manage.py makemigrations
.venv/bin/python backend/manage.py migrate

# Bootstrap superadmin dari SUPER_ADMIN_USERNAME dan SUPER_ADMIN_PASSWORD
.venv/bin/python backend/manage.py ensure_superadmin

# Bootstrap COA, rekening, gudang, periode, dan mapping akuntansi tenant
.venv/bin/python backend/manage.py bootstrap_tenants

# Seed tenant, user dummy, dan skenario data REINHARD
.venv/bin/python backend/manage.py seed_dummy_konveksi
.venv/bin/python backend/manage.py seed_dummy_reinhard --tenant-slug dummy-konveksi

# Test E2E dummy membaca password dari .env dan gagal jika password kosong
.venv/bin/python scripts/test_flow_bisnis.py

# Cek konsistensi atau rebuild search projection
.venv/bin/python backend/manage.py reindex_search --check-only
.venv/bin/python backend/manage.py reindex_search

# Menjalankan Granian ASGI pada origin privat
.venv/bin/granian --interface asgi --host "$BACKEND_BIND_HOST" --port "$BACKEND_PORT" backend.asgi:application
```

## Security & Architecture

- **Autentikasi**: Berbasis Session Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`).
- **Auth API**: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/capabilities`, `/api/auth/tenants`, `/api/auth/available-tenants`, `/api/auth/switch-tenant`, dan `/api/auth/change-password` menangani pemilihan tenant aktif, lifecycle session, perubahan password tervalidasi, rate limit login, serta audit event.
- **Capability API**: `GET /api/auth/capabilities` adalah sumber kebenaran menu dan route frontend. Response berisi `user`, `tenant`, `role`, `operator | null`, dan `capabilities` deterministik/sorted dengan pola granular `<area>.<resource>.<action>`. Matrix capability backend berada di `core/capabilities.py`; endpoint bisnis memakai `require_capability()` / `require_any_capability()` dan tetap menegakkan RBAC, operator assignment, `operator_type`, dan `status` secara server-side.
- **Superadmin Bootstrap**: Command `ensure_superadmin` membaca `SUPER_ADMIN_USERNAME` dan `SUPER_ADMIN_PASSWORD` dari `.env`, memastikan tenant aktif `mis`, serta membuat/memperbarui user dengan role `super_admin`. User `is_superuser` server-side memiliki role efektif `super_admin` pada seluruh tenant aktif.
- **CORS/CSRF**: Request lintas subdomain menggunakan cookie credentials dan origin allowlist dari environment.
- **Reverse Proxy**: Production mempercayai `X-Forwarded-Proto` dari Caddy dan hanya bind pada `BACKEND_BIND_HOST:BACKEND_PORT` dari `.env`.
- **Media Privat**: `MEDIA_ROOT` berada di `/data/services/manufacturing-information-system` dan tidak dipublikasikan langsung. `/api/files/*` menerapkan autentikasi, permission tenant, validasi tipe/ukuran, archive, audit, serta generate PDF A4.
- **Django Ninja Auth**: Endpoint API baru otomatis memakai session auth; router health tetap publik.
- **Observability**: `/api/health/metrics` mengekspos metrics Prometheus text; middleware backend mencatat `request_finished`, `request_exception`, dan `database_slow_query` sebagai JSON ke journald dengan `request_id`.
- **Authorization**: `Membership`, tipe operator, penugasan, role set per endpoint, object lookup tenant-scoped, dan approval policy ditegakkan di backend.
- **Tenant Isolation**: Model fondasi menyediakan relasi `Tenant`. Filter dan validasi scope tenant wajib diterapkan pada setiap endpoint bisnis.
- **Administration API**: `/api/administration/tenants`, `/users`, dan `/operators` menerapkan RBAC, lifecycle, reset password khusus Super Admin, serta audit. Matriks izin dan invariant domain tersedia di [`docs/administration.md`](../docs/administration.md).
- **Production & Costing API**: `/api/production/orders/{id}` menampilkan detail SPK beserta `MaterialRequirement`; endpoint MRP/reservasi/generate PR/pengeluaran bahan tersedia di bawah `/api/production/orders/{id}/...`. `/api/production/costs` mencatat biaya tambahan per SPK dan `/api/finance/cost-allocations` mengalokasikan overhead periodik ke SPK sebagai `ProductionCost`.
- **Inventory Purchase Rules**: PR dan PO manual memvalidasi `Material.moq` dan `Material.purchase_multiple`, sedangkan receipt mengonversi kuantitas beli ke satuan pakai menggunakan snapshot rasio konversi.

Alur lintas-komponen tersedia di [`docs/architecture.md`](../docs/architecture.md). Untuk operasi systemd, health check, dan journal, baca [`docs/operations.md`](../docs/operations.md).
