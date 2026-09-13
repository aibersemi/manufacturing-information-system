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

## UI/UX Standards

- Seluruh pembuatan halaman fitur baru, kartu metrik, form, tabel, dan komponen antarmuka **wajib** mengikuti panduan desain sistem pada [docs/ui-ux-standards.md](docs/ui-ux-standards.md) (struktur blueprint halaman, font minimal `text-sm` untuk teks utama/input dan `text-xs` untuk metadata, tombol & filter berbentuk pill, kartu `rounded-3xl`, serta Phosphor Icons). Dilarang keras menggunakan font `text-[10px]` atau `text-[11px]`.

## Application Guidance

- Ikuti standar modern Angular v22+ (Signals, Standalone, Zoneless, Signal Forms, native control flow `@if`/`@for`, fungsi `input()`/`output()`, dan `inject()`). Aturan rinci tercantum pada [.agents/rules/angular.md](.agents/rules/angular.md).
- Frontend dilarang keras memuat credential administratif seperti `SERVICE_ROLE_KEY`. Hanya `SUPABASE_URL` dan `SUPABASE_ANON_KEY` yang diizinkan untuk bundle client.
- Gunakan skill lokal `.agents/skills/` (`angular-developer`, `angular-new-app`, `spartan`, `supabase`, `supabase-postgres-best-practices`) untuk panduan implementasi.
- Gunakan MCP Server lokal ([.agents/mcp_config.json](.agents/mcp_config.json) - Angular CLI, Spartan, & Supabase DB MCP) untuk analisis proyek, dokumentasi komponen Spartan, eksekusi target, inspeksi database Supabase lokal, dan verifikasi build.
- Prioritaskan performa tinggi secara konsisten dengan mengoptimalkan change detection dan user experience melalui paradigma Angular modern.
- Utamakan penulisan kode yang bersih, efisien, dan mudah dipelihara dengan senantiasa menerapkan API terbaru serta best practices mutakhir Angular v22+.

## Runtime And Operations

- Gunakan `sudo` jika terjadi kendala izin.
- Setelah perubahan source code atau konfigurasi runtime, jalankan: `npm run lint` (perbaiki seluruh error hingga bersih), `npm run build`, lalu `sudo systemctl restart manufacturing-information-system.service`.
- Seluruh pengujian interaktif, verifikasi browser, atau visual testing wajib dilakukan langsung ke domain produksi nyata `https://mis.mrmads.net`, bukan ke `localhost`.
- Jika diminta backup simpan di `/data/backups/manufacturing-information-system/<jenis-backup>/<YYYYMMDD-HHMMSS>/`.
- Logging mengikuti mekanisme native Ubuntu.

### Database Testing and Security

- Pengujian yang melakukan mutasi database wajib menggunakan database test atau lingkungan terisolasi, bukan database produksi.
- Setelah pengujian selesai, kembalikan database dan konfigurasi terkait ke kondisi sebelum pengujian.
- Hapus hanya data yang dibuat oleh pengujian dan rollback setiap migrasi atau perubahan skema sementara.
- Verifikasi bahwa data serta struktur database awal tetap utuh.
- Jika pemulihan tidak dapat dilakukan dengan aman atau data pengujian tidak dapat dibedakan dari data yang sudah ada, hentikan proses dan minta arahan user.

