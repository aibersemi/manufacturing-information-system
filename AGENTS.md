# AGENTS.md - Manufacturing Information System

Panduan wajib bagi agen AI saat bekerja di repositori ini.

## Language

- Gunakan **Bahasa Indonesia** untuk percakapan, penjelasan, ringkasan, komentar kode, dan dokumentasi.
- Gunakan **Bahasa Inggris** untuk istilah teknis, URL, file/directory name, document title, heading, commit message, API, library, command, identifier, domain name, serta konsep yang lebih jelas dalam istilah aslinya.

## Core Security

- File `.env.example` berfungsi sebagai template publik untuk mencantumkan seluruh variabel lingkungan yang dibutuhkan oleh sistem.
- Nilai kredensial pada `.env.example` wajib dikosongkan atau hanya memuat format placeholder non-sensitif (misalnya referensi struktur URI tanpa password riil), sedangkan nilai kredensial sesungguhnya hanya berada di file `.env`.
- Seluruh nilai rahasia, kredensial, user, password, token, URL, port, IP dan API key sensitif hanya disimpan di dalam file `.env` dan dilarang keras dicantumkan secara langsung pada dokumentasi maupun kode publik. Dokumentasi hanya boleh merujuk nama variabel lingkungan tanpa nilai mentah.

## Documentation

- Update dokumentasi hanya jika perilaku, command, arsitektur, operasi, atau kontrak data berubah; perubahan kosmetik tidak memerlukan update dokumentasi.
- Update root `README.md` jika terjadi perubahan pada gambaran umum, struktur, modul dan navigasi dokumentasi.
- Buat atau update dokumen terkait di `docs/` (`docs/<topik>.md`) agar menggambarkan kondisi sistem saat ini secara langsung tanpa mencatat changelog, riwayat perubahan atau migrasi masa lalu.
- Tempatkan informasi pada dokumen yang cakupannya paling relevan. Hindari duplikasi detail antardokumen; gunakan link relatif jika suatu topik perlu dirujuk dari dokumen lain.
- Update AGENTS.md jika panduan untuk agen AI berubah.

## Runtime And Operations

- Gunakan `sudo` jika terjadi kendala izin.
- Jika diminta backup simpan di `/data/backups/manufacturing-information-system/<jenis-backup>/<YYYYMMDD-HHMMSS>/`.
- Logging mengikuti mekanisme native Ubuntu.
