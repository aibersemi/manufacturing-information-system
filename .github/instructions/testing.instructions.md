---
name: Testing MIS
applyTo: "**/*.{py,ts,tsx,js,mjs,json,md}"
---

# Testing Rules

- Untuk perubahan perilaku, tambah atau update test yang membuktikan perilaku baru dan mencegah regresi.
- Pilih test sekecil mungkin yang tetap mencakup risiko: test unit/service untuk logika lokal, API test untuk kontrak backend, Vitest untuk util frontend, Playwright untuk alur UI lintas halaman.
- Backend: gunakan `.venv/bin/pytest <path>` untuk test spesifik, atau `.venv/bin/pytest --testmon --reuse-db` untuk cakupan lebih luas.
- Frontend: jalankan `npm run lint`, `npm run typecheck`, `npm run test:frontend`, atau command yang lebih spesifik sesuai file yang berubah.
- Setelah schema API backend berubah, jalankan `npm run generate:api` lalu `npm run contract:check`.
- Hindari snapshot yang rapuh. Prefer assertion pada perilaku, role, label, state, payload, permission, dan efek bisnis.
- Bila test tidak bisa dijalankan, jelaskan command yang dicoba, error utamanya, dan command yang perlu dijalankan user.
