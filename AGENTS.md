# AGENTS.md - Manufacturing Information System

Panduan wajib bagi agen AI saat bekerja di repositori ini.

## Language

- Gunakan **Bahasa Indonesia** untuk percakapan, penjelasan, ringkasan, komentar kode, dan dokumentasi.
- Gunakan **Bahasa Inggris** untuk istilah teknis, URL, file/directory name, document title, heading, commit message, API, library, command, identifier, domain name, serta konsep yang lebih jelas dalam istilah aslinya.

## Core Security

- File `.env.example` berfungsi sebagai template publik untuk mencantumkan seluruh variabel lingkungan yang dibutuhkan oleh sistem.
- Nilai kredensial pada `.env.example` wajib dikosongkan atau hanya memuat format placeholder non-sensitif (misalnya referensi struktur URI tanpa password riil), sedangkan nilai kredensial sesungguhnya hanya berada di file `.env`.
- Seluruh nilai rahasia, kredensial, user, password, token, URL, port, IP dan API key sensitif hanya disimpan di dalam file `.env` dan dilarang keras dicantumkan secara langsung pada dokumentasi maupun kode publik (kecuali placeholder/dummy data non-sensitif di dalam `[.agents/](.agents/)` untuk keperluan panduan AI). Dokumentasi hanya boleh merujuk nama variabel lingkungan tanpa nilai mentah.

## Documentation

- Update dokumentasi hanya jika perilaku, command, arsitektur, operasi, atau kontrak data berubah; perubahan kosmetik tidak memerlukan update dokumentasi.
- Update root `README.md` jika terjadi perubahan pada gambaran umum, struktur, modul dan navigasi dokumentasi.
- Buat atau update dokumen terkait di `[docs/](docs/<topik>.md)` agar menggambarkan kondisi sistem saat ini secara langsung tanpa mencatat changelog, riwayat perubahan atau migrasi masa lalu.
- Tempatkan informasi pada dokumen yang cakupannya paling relevan. Hindari duplikasi detail antardokumen; gunakan link relatif jika suatu topik perlu dirujuk dari dokumen lain.
- Update AGENTS.md jika panduan untuk agen AI berubah.

## Frontend & AI Tooling Guidelines

- Ikuti standar modern Angular v22+ (Signals, Standalone, Zoneless, Signal Forms, native control flow `@if`/`@for`, fungsi `input()`/`output()`, dan `inject()`). Aturan rinci tercantum pada [.agents/rules/angular.md](.agents/rules/angular.md).
- Frontend dilarang keras memuat credential administratif seperti `SERVICE_ROLE_KEY`. Hanya `SUPABASE_URL` dan `SUPABASE_ANON_KEY` yang diizinkan untuk bundle client.
- Gunakan skill lokal `.agents/skills/` (`angular-developer`, `angular-new-app`, `spartan`, `supabase`, `supabase-postgres-best-practices`) untuk panduan implementasi.
- Gunakan MCP Server lokal (`.antigravity/mcp.json` - Angular CLI & Spartan MCP) untuk analisis proyek, dokumentasi komponen Spartan, eksekusi target, dan verifikasi build.
- Prioritaskan performa tinggi secara konsisten dengan mengoptimalkan change detection dan user experience melalui paradigma Angular modern.
- Utamakan penulisan kode yang bersih, efisien, dan mudah dipelihara dengan senantiasa menerapkan API terbaru serta best practices mutakhir Angular v22+.

## Runtime And Operations

- Gunakan `sudo` jika terjadi kendala izin.
- Jika diminta backup simpan di `/data/backups/manufacturing-information-system/<jenis-backup>/<YYYYMMDD-HHMMSS>/`.
- Logging mengikuti mekanisme native Ubuntu.
