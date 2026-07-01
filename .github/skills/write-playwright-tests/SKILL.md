---
name: write-playwright-tests
description: Gunakan skill ini saat membuat, memperbaiki, atau menjalankan test Playwright E2E dan rendered frontend QA untuk MIS, termasuk workflow login, route React/Vite, responsive UI, console/screenshot debugging, dan fallback Build Web Apps Browser/Playwright.
---

# Playwright E2E Test Skill

Saat menulis atau memperbaiki test Playwright:

1. Inspeksi pola test Playwright yang sudah ada sebelum menambah file baru.
2. Reuse fixture, helper, route, dan data test yang tersedia.
3. Gunakan locator yang user-visible seperti role, label, text, dan accessible name.
4. Hindari timeout arbitrer; tunggu state UI, network, URL, atau elemen yang bermakna.
5. Jangan hardcode identifier dari contoh URL. Ubah menjadi route dinamis atau data fixture.
6. Untuk alur login, gunakan user dari `.env` bagian `# User Dummy Konveksi`.
7. Runner Node yang membaca `.env` wajib memakai `dotenv`, memvalidasi env wajib secara eksplisit, dan tidak menulis credential ke fixture, log, trace, screenshot, DOM snapshot, network dump, atau output.
8. Jika test menyentuh izin, pastikan capability yang diuji jelas dan backend tetap menjadi otoritas.
9. Untuk rendered QA ala Build Web Apps, tetapkan flow: `route -> aksi user/state -> hasil rendered`.
10. Pakai Browser tooling bila tersedia. Jika tidak tersedia, pakai Playwright MCP atau Playwright lokal dan catat alasan fallback.
11. Cek page identity, konten tidak blank, tidak ada framework error overlay, console health, screenshot evidence, dan minimal satu interaction proof.
12. Jalankan `npx playwright test <path>` untuk test spesifik atau command Playwright relevan dari root repo.
13. Saat gagal, gunakan trace, screenshot, console output, DOM snapshot, dan network request untuk mencari root cause dengan redaksi credential atau data sensitif.
