---
name: write-tests
description: Tambah atau perbaiki test untuk perilaku backend, frontend, atau UI.
agent: Implementer
---

Tambahkan atau perbaiki test untuk area yang diminta user.

Proses:

1. Inspeksi pola test yang sudah ada di area terkait.
2. Pilih jenis test paling tepat: pytest Django/API, Vitest, atau Playwright.
3. Reuse fixture/helper yang ada. Jangan membuat setup baru yang tumpang tindih.
4. Test perilaku observable, permission, payload, state, dan edge case penting.
5. Hindari timeout arbitrer dan assertion yang rapuh.
6. Jalankan command test yang relevan dan ringkas hasilnya.

Untuk Playwright yang butuh login, gunakan user dari `.env` bagian `# User Dummy Konveksi`. Runner Node yang membaca `.env` wajib memakai `dotenv`, memvalidasi env wajib, dan tidak menulis credential ke fixture, log, trace, screenshot, atau output.
