# Manufacturing Information System (MIS) Architecture

MIS menggunakan pendekatan *Majestic Monolith* berkinerja tinggi yang memadukan ekosistem **Django** di backend dan **React/Vite** di frontend. Seluruh komponen aplikasi berjalan di atas infrastruktur *native* Ubuntu.

## Main System Flow

```text
Browser React
    │
    ├── HTTPS / REST API
    └── WSS / WebSocket
            │
          Caddy
            │
          Granian
            │
       Django ASGI
        ├── Django Ninja API
        ├── Django Channels
        ├── Authentication & RBAC
        └── Domain Services
              │
              ├── PostgreSQL — Single Source of Truth
              ├── Redis Realtime/Cache
              └── Transactional Outbox
                         │
                     Dramatiq
                    ├── Search Indexing
                    ├── Reports
                    ├── Notifications
                    └── Integrations
                         │
                    Meilisearch
```

## Architecture Principles

- **PostgreSQL** tetap menjadi satu-satunya sumber data utama.
- **Meilisearch** dan *cache* hanya merupakan data turunan yang dapat dibangun ulang.
- *Background task* harus *idempotent*, dapat diulang, dan memiliki *retry* serta *failure handling*.
- Sinkronisasi search memakai registry serializer bersama di backend sehingga event outbox incremental dan `reindex_search` full rebuild menghasilkan bentuk dokumen yang sama.
- WebSocket ASGI memakai `AuthMiddlewareStack` dan `AllowedHostsOriginValidator`; route sistem awal tersedia pada `/ws/system/` untuk koneksi session-authenticated.
- Transaksi kritis divalidasi melalui *service layer* dan *database constraints*.
- Service domain dipisahkan pada modul `sales`, `production`, `inventory`, `labor`, `finance`, dan `accounting`; service lintas-domain memanggil posting jurnal secara aman tanpa menjadikan endpoint sebagai tempat invariant bisnis.
- Seluruh model transaksi memakai kepemilikan tenant. Query API, file, report, search projection, task, dan group WebSocket membawa tenant identifier yang diverifikasi dari session/membership aktif.
- Nomor dokumen, approval, audit, notifikasi, ekspor, file privat, dan maintenance terjadwal disediakan oleh service fondasi `core`.
- Frontend dan backend menggunakan kontrak API otomatis dari **OpenAPI**.
- Administrasi akun memakai relasi `Tenant` → `Membership` → `User`; profil `Operator` wajib menunjuk akun. Invariant role lintas-membership dan batas satu tenant untuk Kepala Konveksi/Operator divalidasi model dan API. Detailnya tersedia di [`administration.md`](administration.md).
- Manajemen aplikasi frontend dibatasi pada **TanStack Query**, **Router**, **Table**, **Form**, **Virtual**, **Ranger**, dan **Store**. Pemeriksaan `npm run dependencies:check` menolak paket TanStack di luar daftar tersebut dan library alternatif yang tumpang tindih.
- Pembatasan berlaku pada dependency serta import langsung aplikasi. Dependency transitif internal seperti paket core tetap dikelola oleh tujuh paket resmi tersebut.
- `legacy-peer-deps=true` dibatasi sebagai *workaround* metadata karena **TanStack Ranger 0.0.5** belum mendeklarasikan dukungan *peer dependency* React 19. Workaround ini wajib dievaluasi ulang saat Ranger atau React diperbarui; *build* dan *test* frontend tetap menjadi gerbang perubahan dependency.
- Seluruh komponen dijalankan sebagai layanan **systemd** terpisah agar dapat dipantau, direstart, dan dikembangkan secara independen.
