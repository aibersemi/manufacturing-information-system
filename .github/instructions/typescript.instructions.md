---
name: TypeScript dan React MIS
applyTo: "frontend/src/**/*.{ts,tsx}"
---

# TypeScript dan React Rules

- Gunakan TypeScript strict. Hindari `any`; bila tidak terhindarkan, jelaskan alasan lokalnya.
- Pertahankan domain types eksplisit daripada object literal ad hoc untuk payload bisnis.
- Validasi input eksternal di boundary dengan Zod, terutama payload form mutasi.
- Form mutasi wajib memakai TanStack Form dengan schema Zod pada `validators.onSubmit`.
- Gunakan TanStack Query, Router, Table, Form, Virtual, Ranger, dan Store sesuai fungsi masing-masing. Jangan menambahkan state/router/table/form library alternatif.
- Jangan mengedit `frontend/src/api/generated/` secara manual; regenerasi dengan `npm run generate:api`.
- API request harus mempertahankan `credentials: "include"`, CSRF token, request id, normalisasi error, dan guard session kedaluwarsa.
- Script TS/JS Node yang membutuhkan `.env` wajib membaca konfigurasi dengan `dotenv`, memvalidasi env wajib secara eksplisit, dan tidak menulis nilai secret ke log, test fixture, trace, atau dokumentasi.
- Variabel `VITE_*` hanya boleh berisi nilai publik. Jangan memasukkan credential, token, password, secret, private DSN, atau konfigurasi sensitif ke bundle frontend.
- Komponen aplikasi wajib menyusun UI dari wrapper shadcn/ui lokal. Jangan memakai kontrol HTML mentah di route/komponen aplikasi bila wrapper tersedia atau bisa ditambahkan.
- UI wajib mobile-first dan accessible. Icon-only button wajib punya `aria-label`.
- Copy user-facing wajib masuk ke `frontend/messages/id.json` dan `frontend/messages/en.json`, lalu dipakai dari `frontend/src/paraglide/`.
- Gunakan capability helper seperti `AccessGuard`, `can`, `canAny`, dan `canAll`; jangan menambah pengecekan UI berbasis `role === ...` untuk fitur baru.
