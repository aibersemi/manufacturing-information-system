---
name: frontend-build-web-apps-mis
description: "Gunakan skill ini saat membangun, meredesain, memoles, menguji, atau men-debug UI frontend MIS dengan workflow Build Web Apps: React/Vite, shadcn/ui, TanStack, Paraglide, rendered QA, Playwright/Browser validation, visual regression, responsive layout, dan interaksi halaman."
---

# Frontend Build Web Apps MIS

## Prinsip

- Ikuti standar frontend MIS di `AGENTS.md` dan `frontend/README.md` terlebih dulu.
- Perlakukan plugin Build Web Apps sebagai workflow desain, implementasi, dan rendered QA. Untuk perubahan kecil pada UI existing, tidak perlu membuat konsep visual baru; untuk redesign, dashboard baru, atau surface visual besar, buat konsep visual terlebih dulu dan implementasikan dengan fidelity tinggi.
- Bangun pengalaman aplikasi yang langsung usable. Jangan membuat landing page atau wrapper pemasaran untuk workflow operasional MIS.
- Gunakan React + Vite yang sudah ada, TanStack Query/Router/Table/Form/Virtual/Ranger/Store sesuai fungsi, shadcn/ui wrapper lokal, Tailwind token theme, Paraglide messages, dan Orval client.
- Jangan menambah library alternatif untuk routing, form, table, query, virtual, ranger, atau store.

## Workflow

1. Baca konteks:
   - `frontend/README.md`, `AGENTS.md`, route/komponen terkait, `messages/id.json`, `messages/en.json`, dan API client/hook yang dipakai.
   - Untuk UI berbasis capability, baca `frontend/src/lib/capabilities.ts`, `frontend/src/lib/navigation.ts`, dan guard route terkait.
2. Tetapkan target flow satu kalimat:
   - `route -> aksi user/state -> hasil rendered yang diharapkan`.
3. Rancang perubahan:
   - Untuk UI existing, pertahankan sistem desain, density, navigasi, dan pola komponen.
   - Untuk redesign atau surface baru, buat desain lengkap dulu: struktur layar, state utama, mobile behavior, token, komponen, copy, dan asset.
4. Implementasikan minimal:
   - Gunakan wrapper `frontend/src/components/ui`.
   - Jika wrapper shadcn/ui belum ada, jalankan dari root: `npx shadcn@latest add <komponen> -c frontend`.
   - Copy user-facing wajib melalui Paraglide resource, bukan literal JSX.
   - Form mutasi wajib TanStack Form + Zod sebelum memanggil API.
5. Validasi rendered UI:
   - Pakai Browser tooling bila tersedia.
   - Jika Browser tooling tidak tersedia, pakai Playwright MCP dari `.vscode/mcp.json` atau Playwright lokal dan catat fallback.
   - Cek desktop dan satu viewport mobile bila praktis.
6. Jalankan command relevan dari root:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test:frontend` untuk unit/component test
   - `npm run build` untuk UI/routing/build config/integrasi signifikan

## Rendered QA

Sebelum menyatakan UI selesai, cek:

- Page identity: URL dan title sesuai route.
- Not blank: layar berisi konten aplikasi bermakna.
- Tidak ada Vite/React/framework error overlay.
- Console tidak memiliki error/warning relevan, atau semua dijelaskan.
- Screenshot membuktikan layout, spacing, copy, dan state utama.
- Minimal satu interaksi target flow dicoba dan state setelahnya diverifikasi.
- Tidak ada overlap, clipping, wrapping buruk, layout shift, scroll trap, z-index issue, asset hilang, atau teks tidak terbaca.

## Standar MIS Yang Tidak Boleh Dilanggar

- Session auth tetap cookie-based; jangan menyimpan token/kredensial di Local Storage atau Session Storage.
- CSRF, `credentials: "include"`, `X-CSRFToken`, dan `X-Request-ID` pada request client tidak boleh dilemahkan.
- UI capability hanya mengatur visibilitas/navigasi. Backend tetap otoritas final untuk RBAC dan tenant isolation.
- Jangan mengedit `frontend/src/api/generated/` manual. Jika schema berubah, jalankan `npm run generate:api` dan `npm run contract:check`.
- Variabel `VITE_*` hanya boleh berisi nilai publik. Jangan memasukkan credential, token, password, secret, private DSN, atau konfigurasi sensitif ke bundle frontend.
- Asset UI/media yang dikontrol aplikasi harus lokal atau media/snapshot dari origin API pada `PUBLIC_API_URL`.

## Output

Ringkas file berubah, flow yang diverifikasi, command yang dijalankan, hasil QA rendered, fallback Browser/Playwright bila ada, dan risiko tersisa.
