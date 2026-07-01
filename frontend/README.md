# Frontend MIS

Aplikasi sisi klien untuk Manufacturing Information System berada di direktori ini.

## Frontend Components

- **Core Framework**: **React** menggunakan **Vite** sebagai *build tool*.
- **Application Management**: Hanya gunakan **TanStack Query**, **Router**, **Table**, **Form**, **Virtual**, **Ranger**, dan **Store** untuk fungsi masing-masing. Jangan gunakan library TanStack lain atau library alternatif yang tumpang tindih dengan tujuh fungsi tersebut.
- Batasan tersebut berlaku untuk dependency dan import langsung aplikasi; dependency transitif internal tetap mengikuti paket resmi TanStack di atas.
- `npm run dependencies:check` memastikan ketujuh paket tersedia, menolak library alternatif dan paket TanStack lain, serta mewajibkan setiap form pada route dikelola dengan TanStack Form.
- Pemeriksaan yang sama menolak elemen kontrol HTML mentah dan import primitive UI pihak ketiga di luar `src/components/ui`; komponen aplikasi wajib menyusun komponen dari wrapper shadcn/ui lokal.
- Dependency frontend wajib didaftarkan di `package.json` root; `frontend/package.json` hanya metadata workspace dan tidak menyimpan `dependencies` atau `devDependencies`.
- **API Client**: **Orval** menghasilkan TypeScript client dan **TanStack Query** *hooks* dari skema **OpenAPI** milik **Django Ninja**.

## Directory Navigation

- `src/`: Root sumber kode aplikasi klien.
  - `components/`: Komponen antarmuka yang dapat digunakan ulang (berbasis **shadcn/ui**).
  - `routes/`: Halaman aplikasi sesuai hierarki _file-based routing_ (TanStack Router).
  - `lib/capabilities.ts` dan `lib/navigation.ts`: Utilitas capability, `can/canAny/canAll`, dan builder navigasi app shell.
  - `paraglide/`: Output generated **Paraglide JS** untuk fungsi pesan i18n typed.
  - `lib/`: Utilitas murni dan klien khusus (contoh: `request-client.ts`).
  - `styles/`: _Stylesheet_ CSS Global dengan variabel **Tailwind v4**.
  - `api/generated/`: Kode klien HTTP yang digenerate oleh **Orval** dari OpenAPI.
- `messages/`: Resource terjemahan **Paraglide JS** dengan bahasa default `id`.
- `project.inlang/`: Konfigurasi Inlang/Paraglide untuk locale dan format pesan.

## Main Commands (Root Repo)

Gunakan perintah ini dari _root_ direktori repositori:

```bash
# Menjalankan linter, guard frontend, dan validasi keamanan Paraglide
npm run lint
npm run lint:fix

# Memeriksa keamanan runtime Paraglide dan seluruh source TypeScript
npm run test

# Memeriksa seluruh source TypeScript melalui command utama
npm run typecheck

# Menjalankan keamanan runtime Paraglide dan unit test frontend
npm run test:frontend

# Membangun Aplikasi Klien
npm run build

# Membuat (Generate) API Client berdasarkan Schema Backend
npm run generate:api

# Memastikan schema dan generated client sinkron
npm run contract:check

# Memvalidasi kebijakan dependency frontend
npm run dependencies:check
```

## Production Origin

Build produksi disimpan di `frontend/dist` dan dilayani oleh `manufacturing-frontend.service` melalui Granian WSGI pada `FRONTEND_BIND_HOST:FRONTEND_PORT`. Reverse proxy privat mempublikasikannya sebagai `PUBLIC_FRONTEND_URL`.

Service ini adalah production static origin, bukan Vite dev server dan bukan Node runtime. Service tetap diperlukan karena reverse proxy publik berjalan terpisah dari server aplikasi, sedangkan hasil build berada di server aplikasi lokal dan dipublikasikan lewat origin HTTP privat.

Static origin hanya menerima `GET` dan `HEAD`, menggunakan fallback `index.html` untuk route SPA, tidak membuka directory listing, dan memberi cache immutable pada asset Vite di `/assets/`. `VITE_API_BASE_URL` dibaca dari `.env` root saat build.

## Internationalization

- Integrasi i18n pada Vite hanya menggunakan `paraglideVitePlugin` dari `@inlang/paraglide-js`.
- Gunakan fungsi pesan generated dari `src/paraglide/`; jangan menambahkan runtime atau plugin i18n lain seperti `i18next` dan `react-i18next`.
- Seluruh copy statis yang terlihat pengguna, pesan validasi, label aksesibilitas, dan label tabel wajib tersedia pada resource `messages/id.json`; JSX tidak boleh memuat copy literal.
- `npm run lint` menjalankan guard literal i18n bertahap pada route yang sudah masuk daftar bersih di `scripts/check_i18n_literals.mjs`; perluas daftar itu setelah route lain selesai dimigrasikan. Jalur yang sama juga menjalankan `paraglide:security-check` agar output generated tetap memakai patch keamanan.
- MIS memakai i18n single-locale `id`; formatter angka, rupiah, tanggal, dan waktu dikunci ke `id-ID`/`Asia/Jakarta`.
- Modul pada `project.inlang/` hanya membaca dan memvalidasi resource pesan di `messages/`, bukan runtime i18n frontend.
- Frontend adalah SPA tanpa middleware SSR Paraglide: `experimentalMiddlewareLocaleSplitting` wajib tetap `false` dan source aplikasi dilarang mengimpor generated `src/paraglide/server.js`.
- Output Paraglide dipatch oleh `scripts/patch_paraglide_security.mjs`: akses property dinamis pada `runtime.js` dibatasi ke own data property, helper URL localization hanya boleh membangun URL untuk origin MIS tepercaya, dan artefak `server.js/server.d.ts` dihapus karena middleware SSR tidak dipakai. `npm run test` dan `npm run test:frontend` menjalankan `paraglide:security-check` serta `paraglide:security-test`; `test:frontend` menambal dan memverifikasi ulang generated output setelah Vitest.

## Form Mutation Validation

- Semua form mutasi frontend wajib memakai **TanStack Form** dengan schema **Zod** pada `validators.onSubmit` sebelum memanggil API.
- Payload API dibentuk melalui fungsi `to*Payload(value: unknown)` yang mem-parse input dengan Zod, lalu melakukan transform tipe seperti string angka menjadi number dan string kosong menjadi `undefined`.
- Backend tetap menjadi otoritas final untuk permission, status transition, stok, approval, dan invariant bisnis kritis; Zod frontend dipakai untuk UX, konsistensi payload, dan validasi tipe awal.
- `npm run lint` menjalankan guard Zod bertahap pada route yang sudah masuk daftar bersih di `scripts/check_zod_mutation_guards.mjs`; perluas daftar itu setelah route/form lain selesai dimigrasikan.

## Design & Standards

- UI wajib _mobile-first_ dan _accessible_.
- UI menggunakan **Tailwind CSS**, komponen **shadcn/ui**, dan kustomisasi variabel CSS untuk estetika.
- Semua kontrol dan komponen UI interaktif wajib memakai wrapper **shadcn/ui** dari `src/components/ui`; jangan menulis `<button>`, `<input>`, `<select>`, tabel, dialog, atau separator HTML mentah di route/komponen aplikasi.
- Semua dropdown menu aplikasi wajib memakai `@/components/ui/dropdown-menu`; jika belum tersedia, tambahkan dari root repo dengan `npx shadcn@latest add dropdown-menu -c frontend`.
- Jika komponen shadcn/ui belum tersedia, jalankan dari root repo: `npx shadcn@latest add <komponen> -c frontend`, lalu impor dari `@/components/ui/<komponen>`.
- **API Integration**: *Custom request client* menggunakan *Session Cookie* melalui `credentials: "include"`, mengirim `X-CSRFToken` dan `X-Request-ID`, membatasi payload JSON, menerapkan timeout/retry terbatas untuk GET, menahan request setelah `429`, menormalisasi error, serta menangani sesi kedaluwarsa.
- **Login Flow**: Route `/login` memakai TanStack Form dan Zod, mengambil tenant aktif dari API, menampilkan error generik untuk kredensial tidak valid, lalu mengarahkan session valid ke dashboard `/`.
- **Capability-Based App Shell**: Sidebar, tenant switch, tombol mutasi, dan route guard membaca `GET /api/auth/capabilities`. Frontend hanya mengatur visibilitas/navigasi; otorisasi final tetap di backend. Gunakan `AccessGuard`, `can`, `canAny`, dan `canAll`, bukan pengecekan `role === ...` pada UI baru.
- **Operational UI**: Dashboard per capability (`dashboard.system`, `dashboard.operational`, `dashboard.finance`, `dashboard.operator`), laporan/ekspor, absensi, kas kecil/dapur, permintaan pembayaran, jurnal, approval, audit, dan notifikasi menggunakan client API typed. Detail SPK produksi menampilkan requirement MRP dan aksi rilis, hitung MRP, reservasi, generate PR, pengeluaran bahan, serta penyelesaian produksi. Layar HPP Produksi mencatat `ProductionCost`; layar Alokasi Biaya Produksi mengirim overhead periodik ke SPK. Pergantian tenant membersihkan Query Cache sebelum memuat konteks baru.
- **Administration UI**: Route pengaturan tenant/pengguna/operator dikendalikan oleh capability `settings.*.manage`. Tabel/Sheet digunakan pada desktop, kartu/Drawer pada mobile, dan menu akun menyediakan perubahan password mandiri jika `auth.change_password` tersedia.

Alur lintas-komponen tersedia di [`docs/architecture.md`](../docs/architecture.md). Detail kontrol autentikasi dan CSRF tersedia di [`docs/security.md`](../docs/security.md).
