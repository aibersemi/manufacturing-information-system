# AGENTS.md - Manufacturing Information System (MIS)

Anda adalah **Agent AI** untuk layanan **Manufacturing Information System (MIS)**. Di bawah ini adalah kontrak operasional singkat untuk bekerja di repo ini; detail panjang ada di `docs/` dan README area.

## Language

- Gunakan **Bahasa Indonesia** sebagai bahasa utama dalam percakapan, komentar kode, *commit message*, penjelasan, ringkasan kerja, dan dokumentasi.
- **Bahasa Inggris** boleh digunakan untuk istilah teknis, judul dokumen, *heading*, nama API, nama *library*, *command*, *error message*, nama file, nama *branch*, atau konsep yang lebih jelas jika tetap ditulis dalam bahasa aslinya.
- Untuk komentar kode baru, ikuti gaya file sekitar. Tambahkan komentar hanya saat konteks lokal tidak mudah dibaca dari kode.

## Repo Map

- `backend/`: Kode utama **Django** (ORM, Channels, Dramatiq *tasks*) dan API berbasis **Django Ninja**.
- `frontend/`: Aplikasi **React** dengan *build tool* **Vite**, ekosistem **TanStack**, komponen UI (**shadcn/ui**), dan *generated API client* (**Orval**).
- `docs/`: Dokumen arsitektur dan referensi teknis mendalam lintas-*service*.
- `scripts/`: Kumpulan *script* utilitas.
- `plan/`: Artefak/arsip/draft perencanaan.

## Documentation

- Root `README.md` adalah gambaran umum proyek sekaligus indeks dokumentasi utama.
- `backend/README.md` dan `frontend/README.md` adalah *documentation area* masing-masing.
- Gunakan `docs/` untuk referensi detail panjang sesuai topik:
  - `docs/administration.md`
  - `docs/architecture.md`
  - `docs/data-platform.md`
  - `docs/deployment.md`
  - `docs/domain-model.md`
  - `docs/operations.md`
  - `docs/permission-matrix.md`
  - `docs/security.md`
- Update root `README.md` jika perubahan memengaruhi gambaran umum proyek, peta struktur repositori, navigasi dokumentasi, atau referensi perintah utama.
- Update README area jika perubahan hanya berdampak pada `backend/` atau `frontend/`.
- Update dokumen terkait di `docs/` jika perubahan memengaruhi detail panjang sesuai topik.
- Jika detail perubahan tidak cocok dengan dokumen yang ada, buat `docs/<topik>.md` dan tambahkan referensinya ke daftar dokumentasi.
- Jangan update dokumentasi secara kosmetik jika tidak membantu pembaca memahami perubahan perilaku, command, arsitektur, operasi, atau kontrak data.

## Validation Matrix

- Perubahan backend Python/Django:
  - `.venv/bin/ruff check`
  - `.venv/bin/pytest --testmon --reuse-db` atau pytest spesifik yang relevan
- Perubahan format Python luas:
  - `.venv/bin/ruff format`
- Perubahan frontend React/Vite:
  - `npx @biomejs/biome check`
  - `npx tsc --noEmit`
- Perubahan UI, routing, build config, atau integrasi frontend yang signifikan:
  - `npm run build`
- Perubahan unit/component test frontend:
  - `npx vitest`
- Perubahan dokumentasi saja, tidak perlu test runtime.
- Jalankan seluruh perintah JavaScript/Vite dari root repo.

## Runtime And Operations

- Jika perintah gagal karena izin seperti `Permission denied`, gunakan `sudo`.
- Perubahan dokumentasi atau file non-runtime tidak perlu restart service.
- Perubahan backend web/API/settings/middleware/routing/migration: jalankan `sudo systemctl restart manufacturing.service`.
- Perubahan frontend build/static origin: jalankan `npm run build`, lalu `sudo systemctl restart manufacturing-frontend.service`.
- Perubahan Dramatiq task, worker, atau proses background: jalankan `sudo systemctl restart manufacturing-worker.service`.
- Perubahan scheduled maintenance: jalankan `sudo systemctl restart manufacturing-scheduler.timer`.
- Perubahan backup PostgreSQL: jalankan `sudo systemctl restart manufacturing-backup.timer`.
- Cek status dengan `sudo systemctl status <nama service>.service --no-pager`.
- Baca log dengan `sudo journalctl -u <nama service>.service -f`.
- Jangan menaruh UI/frontend client-side di `backend/`, dan jangan menaruh kode backend/server-side di `frontend/`.
- Jika *user* meminta *backup*, simpan di `/data/backups/manufacturing-information-system/<jenis-backup>/<YYYYMMDD-HHMMSS>/`.
- Untuk test Playwright yang butuh login, gunakan user dari `.env` bagian `# User Dummy Konveksi`.

## Dynamic URLs

- Jika *user* memberi URL konkret, normalisasi ke pola *route* dinamis sebelum mencari atau mengubah kode.
- Jangan *hardcode identifier* dari contoh URL.
- Untuk domain produksi, baca nilai dari `.env`: `PUBLIC_FRONTEND_URL`, `PUBLIC_API_URL`, `E2E_BACKEND_BASE_URL`, dan `E2E_FRONTEND_BASE_URL`.
- Contoh:
  - `${PUBLIC_API_URL}/api/customers/lookup/?phone=0812` -> parameter *query*.
  - `${PUBLIC_FRONTEND_URL}/service-records/123/receipt/` -> `/service-records/<service_number>/receipt/`

## Core Security

- **Autentikasi**: Murni berbasis *Session Cookie* (`HttpOnly`, `Secure`, `SameSite`). Dilarang keras menyimpan kredensial di *Local/Session Storage*.
- **Proteksi API**: Wajib terapkan perlindungan **CSRF** untuk mutasi data dan validasi *Origin* untuk WebSocket.
- **Otorisasi & Validasi**: Terapkan **RBAC** ketat di backend (pantau error 401/403) dan validasi tipe data mutlak (Pydantic/Zod) untuk mencegah injeksi.
- **Audit Trail**: Seluruh aktivitas krusial, perubahan konfigurasi bisnis, transaksi stok, dan *approval* wajib tercatat.
- **Kredensial & konfigurasi sensitif**: Jangan menulis nilai asli secret, password, token, DSN lengkap, private key, IP internal, domain internal, atau detail infrastruktur sensitif di source code, test, dokumentasi, `README.md`, `AGENTS.md`, `plan/`, atau commit message. Gunakan anchor/nama env seperti `DATABASE_URL`, `SUPER_ADMIN_PASSWORD`, `PUBLIC_API_URL`, `DUMMY_KEPALA_PASSWORD`, dan simpan nilai asli hanya di `.env` lokal atau secret manager.
- **Dokumentasi env**: Dokumentasi hanya boleh menyebut nama env/anchor dan contoh placeholder non-sensitif. `.env.example` wajib berisi nama variabel yang dibutuhkan tanpa nilai.
- **Python**: Script Python yang membutuhkan konfigurasi dari `.env` wajib membaca env dengan `python-dotenv` dan melakukan validasi env wajib secara eksplisit sebelum menjalankan operasi penting.
- **TS/JS Node**: Script TypeScript/JavaScript yang berjalan di Node wajib membaca env dengan `dotenv` dan melakukan validasi env wajib secara eksplisit.
- **Frontend React/Vite**: Hanya nilai publik yang boleh memakai prefix `VITE_*`. Jangan pernah memasukkan credential, token privat, password, secret, atau DSN sensitif ke variabel `VITE_*` karena akan ikut masuk ke bundle frontend.

## UI Standards

- UI wajib *mobile-first* dan aksesibel; *icon-only button* wajib memiliki `aria-label`.
- Gunakan **shadcn/ui** sebagai *baseline* komponen UI.
- Komponen UI wajib menggunakan **shadcn/ui**; jika komponen belum tersedia di repo, tambahkan dari root repo dengan `npx shadcn@latest add <komponen> -c frontend` sebelum digunakan.
- Gunakan **Tailwind CSS** *variable/token theme*; hindari *hardcode* warna berulang.
- **Manajemen Aplikasi** hanya menggunakan **TanStack Query**, **Router**, **Table**, **Form**, **Virtual**, **Ranger**, dan **Store** sesuai fungsinya. Jangan menambahkan library alternatif untuk tujuh fungsi tersebut.
- Asset UI/media, *font*, dan *icon* yang dikontrol aplikasi **wajib lokal** atau media/*snapshot* dari origin API pada `PUBLIC_API_URL`; aturan ini tidak melarang *script/service* pihak ketiga yang sudah terdokumentasi seperti **Turnstile**, **GA/GTM**, dan **Meta**.
- Gunakan istilah **"produk"** untuk hasil produksi/finished goods, varian produk, SKU, item jual, dan stok produk jadi.
- Gunakan istilah **"material"** atau **"bahan"** untuk input produksi, pembelian, penerimaan, pemakaian BOM, dan stok gudang material.
- Hindari istilah **"barang"** untuk konteks pembelian atau penerimaan stok; gunakan "material masuk", "penerimaan material", "pembelian material", atau "stok material".
- SKU ProductVariant wajib berformat `MODEL-WARNA-UKURAN`, tepat 3 segmen dipisah `-`, tanpa spasi (` `). Gunakan `0` untuk warna/ukuran kosong. Gunakan `_` sebagai pemisah kata di dalam segmen. Hindari `-` dan spasi (` `) di dalam segmen.

## Environment

- **Python/Django**:
  - Backend menggunakan Python di `.venv/`; dependency dikelola dari root `pyproject.toml` via `.venv/bin/python -m pip install -e ".[dev]"`.
  - Pastikan aturan `DJ` untuk `flake8-django` tetap aktif saat lint backend.
  - Pastikan plugin `pytest-django` ada untuk `.venv/bin/pytest`.
- **JavaScript/Vite**:  
  - Frontend menggunakan `node_modules/` di root repo; dependency dikelola dari root `package.json`/`package-lock.json` via `npm ci`.
  - Jangan membuat dependency install terpisah di `frontend/`.

## Public Routing

- Nilai domain, host bind, target tunnel, dan IP internal wajib dibaca dari `.env` privat atau dokumentasi deployment privat, bukan di-*hardcode* ke file tracked.
- Anchor `.env` utama:
  - Frontend public URL: `PUBLIC_FRONTEND_URL`
  - Backend public URL: `PUBLIC_API_URL`
  - Backend bind host/port: `BACKEND_BIND_HOST` / `BACKEND_PORT`
  - Frontend bind host/port: `FRONTEND_BIND_HOST` / `FRONTEND_PORT`
  - Target SSH Caddy/tunnel privat: `CADDY_TUNNEL_SSH_TARGET`
- Untuk update `Caddyfile`, baca instruksi dari host privat:
  ```bash
  ssh "$CADDY_TUNNEL_SSH_TARGET" 'cat /opt/services/caddy/AGENTS.md'
  ```
  
