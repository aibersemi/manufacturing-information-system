# Security MIS

## Authentication and Security

- **Autentikasi**: **Django server-side session** menggunakan cookie `Secure`, `HttpOnly`, dan `SameSite`.
- **CSRF**: Proteksi CSRF **Django** wajib digunakan untuk seluruh operasi API yang mengubah data.
- **WebSocket Security**: **Django Channels** menggunakan *session authentication*, validasi Origin, verifikasi ulang membership tenant aktif, dan group tenant/user. Route `/ws/system/` menolak koneksi tanpa session aktif.
- **Otorisasi**: *Role-Based Access Control* (RBAC) membatasi akses berdasarkan plant, warehouse, department, dan kewenangan approval.
- **Audit**: Aktivitas penting, perubahan data, approval, dan transaksi stok dicatat dalam *audit trail*.
- **Caddy**: Hanya menangani TLS, *reverse proxy*, *security headers*, dan routing; autentikasi tetap dikelola sepenuhnya oleh **Django**.
- **Permukaan Publik Backend**: Caddy hanya meneruskan `/api/*` dan `/ws/*` pada origin dari `PUBLIC_API_URL`. Root, Django Admin, `/media/*`, dan route lain ditolak di edge.
- **Storage Privat**: `MEDIA_ROOT` di `/data/services/manufacturing-information-system` tidak disajikan sebagai static files. `/api/files/*` menerapkan scope tenant, permission, audit akses, allowlist tipe, batas 10 MB, checksum, archive, dan nama file tersimpan acak.
- **Kepercayaan Proxy**: Django mempercayai `X-Forwarded-Proto` karena origin hanya bind pada host privat yang terhubung ke reverse proxy yang dikontrol deployment.

## Hardened Request Client

Integrasi API frontend menggunakan *custom request client* melalui **Orval** dengan kontrol lintas-lapisan berikut:

- **Mitigasi XSS dan Phishing**: Autentikasi hanya menggunakan cookie `HttpOnly` dan `Secure`, disertai kebijakan referrer `strict-origin-when-cross-origin`, allowlist CORS, dan Content Security Policy (CSP). CSP frontend mempertahankan `script-src 'self'`; `style-src` mengizinkan style attribute yang dibutuhkan posisi/ukuran dinamis Radix/shadcn. Helper URL localization Paraglide hanya boleh membangun URL untuk origin MIS tepercaya agar input pengguna tidak menjadi open redirect lintas-domain.
- **Guard Paraglide**: `npm run lint` memverifikasi patch keamanan output generated Paraglide, sedangkan `npm run test` dan `npm run test:frontend` menjalankan uji runtime untuk own data property dan allowlist origin URL localization. `test:frontend` juga menambal dan melakukan check ulang setelah Vitest karena proses test dapat memicu regenerasi artefak Paraglide.
- **Cookie Lintas Subdomain**: Session cookie tetap host-only pada domain API. Cookie CSRF dapat memakai `CSRF_COOKIE_DOMAIN` dari `.env` agar frontend dapat membaca token dan mengirim `X-CSRFToken` ke API tanpa menyimpan kredensial di Web Storage.
- **Pencegahan SQL Injection dan Malware**: Input divalidasi berdasarkan tipe di frontend dan kembali divalidasi di backend. Backend membatasi `Content-Type`, tipe file, dan ukuran payload unggahan.
- **Proteksi Broken Access Control**: Client menangani sesi kedaluwarsa dan respons `401` atau `403`, sedangkan keputusan RBAC tetap dilakukan di backend.
- **Resiliensi Beban**: Timeout, batas ukuran request, dan penanganan respons `429 Too Many Requests` mencegah retry klien yang tidak terkendali. Rate limit tetap ditegakkan oleh komponen server.
- **Audit dan Error Handling**: Client mengirim token CSRF dan Request ID, membatasi ukuran payload JSON, menerapkan timeout, menahan request saat menerima `429`, dan menormalisasi error tanpa mengekspos detail internal backend. Allowlist CORS menerima `X-Request-ID` agar tracing tetap berfungsi pada request lintas subdomain.

## Tenant Login Flow

- `GET /api/auth/tenants` hanya mengekspos `slug` dan `name` tenant aktif serta menerbitkan cookie CSRF yang dapat dibaca SPA.
- `POST /api/auth/login` mewajibkan header CSRF, memvalidasi kredensial, tenant aktif, dan hak efektif user. User biasa harus memiliki membership aktif pada tenant tersebut; akun `is_superuser` server-side diperlakukan sebagai `super_admin` pada setiap tenant aktif. Percobaan login dibatasi per kombinasi IP dan username, lalu login berhasil menyimpan `active_tenant_id` di session server-side.
- Seluruh kegagalan kredensial mengembalikan pesan generik. Login berhasil, gagal, terkena rate limit, dan logout dicatat sebagai `AuditEvent` tanpa menyimpan password.
- `GET /api/auth/me` memverifikasi ulang user, tenant, dan hak efektif user pada tenant aktif. `POST /api/auth/logout` memerlukan session dan CSRF sebelum invalidasi session.
- `GET /api/auth/available-tenants` dan `POST /api/auth/switch-tenant` hanya tersedia bagi peran lintas-tenant yang sah; perpindahan dicatat dan frontend menghapus seluruh Query Cache sebelum memuat konteks baru.
- Respons `401` dari pemeriksaan session dan login ditangani oleh auth guard/form. Request API terlindungi lainnya tetap mengarahkan session kedaluwarsa ke `/login`.

## Password dan Administrasi Akun

- Semua akun dapat mengganti password sendiri melalui `POST /api/auth/change-password` dengan verifikasi password lama dan validator password Django. `update_session_auth_hash` mempertahankan session saat ini; session lain menjadi tidak valid karena auth hash berubah.
- Reset password akun lain hanya tersedia untuk `super_admin` dan mewajibkan verifikasi password pelaksana. Reset mengakhiri seluruh session target. Kepala Konveksi tidak memiliki permission reset password Operator.
- Verifikasi password lama dan password pelaksana memakai limiter bersama per akun dan alamat IP: maksimal lima kegagalan dalam 300 detik. Percobaan berikutnya mengembalikan `429` dan diaudit tanpa menyimpan password.
- Tidak tersedia registrasi, lupa password, reset password publik, atau pembuatan `super_admin` melalui UI/API administrasi.
- Password, konfirmasi password, dan password verifikasi pelaksana tidak disimpan dalam audit, log aplikasi, ataupun response API.
- Aturan role, membership, tenant scope, lifecycle, dan matriks izin lengkap tersedia di [`administration.md`](administration.md).
