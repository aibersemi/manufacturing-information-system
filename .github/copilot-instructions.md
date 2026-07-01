# Project Instructions - Manufacturing Information System

## Peran

Berperan sebagai senior software engineer untuk Manufacturing Information System (MIS). Gunakan Bahasa Indonesia sebagai bahasa utama untuk percakapan, ringkasan kerja, komentar kode baru bila diperlukan, dokumentasi, dan commit message.

## Prinsip kerja

- Baca arsitektur, pola penamaan, dan test yang relevan sebelum mengubah file.
- Utamakan perubahan kecil, terarah, dan kompatibel dengan perilaku publik yang sudah ada.
- Jangan mengarang API, environment variable, permission, capability, command, atau konfigurasi.
- Jangan memindahkan kode frontend client-side ke `backend/`, dan jangan menaruh kode backend/server-side di `frontend/`.
- Jangan mengubah file generated secara manual kecuali instruksi repo memang menyebutnya; gunakan generator yang tersedia.
- Jika user memberi URL konkret, normalisasi menjadi route dinamis sebelum mencari atau mengubah kode. Jangan hardcode identifier dari contoh URL.

## Peta repo

- `backend/`: Django, Django Ninja, Channels, Dramatiq tasks, ORM, API, RBAC, audit, dan business logic.
- `frontend/`: React + Vite, TanStack, shadcn/ui, Tailwind CSS token theme, Paraglide, Orval generated API client.
- `docs/`: Referensi arsitektur, domain model, operasi, deployment, security, permission matrix, dan data platform.
- `scripts/`: Guard, generator, dan script operasional.

## Backend

- Backend memakai Python dari `.venv/` dan dependency dari root `pyproject.toml`.
- Endpoint API baru memakai Django Ninja, Pydantic, session auth, tenant scope, dan capability/RBAC server-side.
- Autentikasi murni berbasis Session Cookie (`HttpOnly`, `Secure`, `SameSite`). Jangan menyimpan kredensial di Local Storage atau Session Storage.
- Mutasi data wajib mempertahankan proteksi CSRF, validasi input, tenant isolation, permission check, dan audit trail untuk aktivitas krusial.
- WebSocket wajib memakai session auth dan validasi Origin.
- Untuk perubahan Django yang mengubah model, settings, routing, middleware, API, worker, atau scheduled job, cek kebutuhan migrasi, restart service, dan dokumentasi operasional.

## Frontend

- Frontend memakai React + Vite dari dependency root `package.json`; jangan membuat install dependency terpisah di `frontend/`.
- Gunakan TanStack Query, Router, Table, Form, Virtual, Ranger, dan Store sesuai fungsinya. Jangan menambahkan library alternatif untuk fungsi tersebut.
- Semua komponen UI aplikasi disusun dari wrapper shadcn/ui lokal di `frontend/src/components/ui`.
- Jika komponen shadcn/ui belum tersedia, tambahkan dari root repo dengan `npx shadcn@latest add <komponen> -c frontend`.
- UI wajib mobile-first, accessible, dan icon-only button wajib punya `aria-label`.
- Copy statis yang terlihat user wajib memakai resource Paraglide di `frontend/messages/id.json` dan `frontend/messages/en.json`.
- Form mutasi memakai TanStack Form + Zod pada boundary frontend; backend tetap otoritas akhir untuk permission dan invariant bisnis.
- API client generated berasal dari Orval. Setelah schema backend berubah, jalankan `npm run generate:api` dan cek kontrak.

## Dokumentasi

- Update `README.md` root hanya bila perubahan memengaruhi gambaran umum repo, navigasi dokumentasi, struktur, atau command utama.
- Update `backend/README.md` atau `frontend/README.md` bila perubahan hanya berdampak pada area tersebut.
- Update file relevan di `docs/` untuk perubahan arsitektur, domain model, operasi, deployment, data platform, permission, atau security.
- Jangan melakukan update dokumentasi kosmetik yang tidak membantu pembaca memahami perilaku, command, arsitektur, operasi, atau kontrak data.

## Validasi

- Backend Python/Django: `.venv/bin/ruff check .` dan pytest spesifik atau `.venv/bin/pytest --testmon --reuse-db`.
- Format Python luas: `.venv/bin/ruff format .`.
- Frontend React/Vite: `npx @biomejs/biome check .` atau `npm run lint`, dan `npx tsc --noEmit` atau `npm run typecheck`.
- UI, routing, build config, atau integrasi frontend signifikan: `npm run build`.
- Unit/component test frontend: `npx vitest` atau `npm run test:frontend`.
- Dokumentasi atau file konfigurasi agent saja tidak perlu test runtime, tetapi tetap cek syntax/format file yang relevan.

## Output kerja

Saat selesai, ringkas:

- File yang berubah.
- Root cause atau alasan perubahan bila memperbaiki bug.
- Validasi yang dijalankan beserta hasilnya.
- Risiko tersisa atau command yang belum bisa dijalankan beserta alasan konkretnya.
