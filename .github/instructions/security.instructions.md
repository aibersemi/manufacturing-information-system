---
name: Security MIS
applyTo: "**/*.{py,ts,tsx,js,mjs,json,yml,yaml,md}"
---

# Security Rules

- Autentikasi harus tetap berbasis Session Cookie (`HttpOnly`, `Secure`, `SameSite`). Jangan menyimpan token atau kredensial di Local Storage atau Session Storage.
- Mutasi API wajib dilindungi CSRF. Request lintas subdomain wajib mengikuti CORS/CSRF allowlist yang ada.
- WebSocket wajib memakai session auth dan validasi Origin.
- Backend wajib menegakkan RBAC/capability, tenant isolation, object-level authorization, dan validasi tipe data. UI guard hanya untuk visibilitas dan UX.
- Audit trail wajib dicatat untuk aktivitas krusial, perubahan konfigurasi bisnis, transaksi stok, approval, auth lifecycle, dan perubahan data sensitif.
- Jangan menambahkan secret, credential, API key, password, cookie, token, DSN lengkap, private key, IP/domain internal, detail infrastruktur sensitif, atau data produksi sensitif ke repo.
- Dokumentasi env hanya boleh memakai nama env/anchor dan placeholder non-sensitif; jangan menulis nilai asli dari `.env`, secret manager, log, atau konfigurasi privat.
- Script Python yang membaca `.env` wajib memakai `python-dotenv` dan memvalidasi env wajib secara eksplisit sebelum operasi penting.
- Script TS/JS Node yang membaca `.env` wajib memakai `dotenv` dan memvalidasi env wajib secara eksplisit sebelum operasi penting.
- Variabel `VITE_*` hanya boleh berisi nilai publik. Jangan memasukkan credential, token, password, secret, private DSN, atau konfigurasi sensitif ke `VITE_*`.
- Untuk dynamic URL dari user, ubah contoh ID menjadi route pattern sebelum mencari kode. Jangan hardcode ID, nomor dokumen, tenant, atau user dari contoh.
- Validasi path, file type, ukuran file, dan permission untuk semua alur media/file.
- Hindari dynamic property access atau dynamic import pada data tidak tepercaya kecuali sudah divalidasi dan dibatasi.
