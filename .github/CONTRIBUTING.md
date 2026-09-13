# Contributing Guide

Terima kasih atas minat Anda untuk berkontribusi pada **Manufacturing Information System**!

## Prerequisites
- Node.js (versi 22+)
- npm (versi 11+)
- Web browser modern (Google Chrome, Microsoft Edge, Mozilla Firefox, atau Apple Safari)

## Setup and Development Steps
1. *Fork* atau *clone* repositori ini.
2. Siapkan file *environment variables*:
   ```bash
   cp .env.example .env
   ```
   Sesuaikan konfigurasi variabel yang dibutuhkan di dalam `.env`.
3. Pasang dependensi:
   ```bash
   npm install
   ```
4. Jalankan *development server*:
   ```bash
   npm start
   ```
5. Sebelum melakukan *commit* atau mengajukan *Pull Request*, pastikan seluruh pemeriksaan kualitas kode berhasil:
   - Jalankan linter: `npm run lint`
   - Jalankan verifikasi *production build*: `npm run build`
   - Jalankan *unit tests* (jika ada perubahan yang diuji): `npm test`
6. Lakukan *commit* sesuai standar proyek dan buat *Pull Request* menggunakan *template* yang telah disediakan.
