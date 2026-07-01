---
name: bugfix
description: Perbaiki bug dengan perubahan minimal, test relevan, dan ringkasan risiko.
agent: Implementer
---

Perbaiki bug yang dijelaskan user.

Proses:

1. Baca file, test, log, dan dokumentasi yang relevan sebelum mengedit.
2. Jelaskan root cause singkat berdasarkan kode, bukan tebakan.
3. Terapkan perubahan paling kecil yang memperbaiki perilaku tanpa rewrite luas.
4. Tambah atau update test yang membuktikan bug sudah tertutup bila perubahan perilaku terjadi.
5. Jalankan lint/typecheck/test yang relevan dari root repo.
6. Ringkas file berubah, root cause, validasi, dan risiko tersisa.

Aturan MIS:

- Pertahankan session cookie auth, CSRF, RBAC, tenant isolation, dan audit trail.
- Frontend wajib memakai TanStack dan wrapper shadcn/ui lokal sesuai standar repo.
- Jangan mengedit generated API client secara manual; gunakan `npm run generate:api` bila schema berubah.
