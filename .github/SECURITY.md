# Security Policy

Manufacturing Information System (MIS) memproses data operasional manufaktur,
stok, transaksi, audit, dan otorisasi pengguna. Laporan keamanan harus ditangani
secara privat agar tidak mengekspos data, konfigurasi, atau jalur eksploitasi.

## Scope

Area yang termasuk scope:

- Backend Django, Django Ninja API, Channels/WebSocket, middleware, dan Dramatiq.
- Frontend React/Vite, generated API client, request client, validasi form, dan
  routing.
- RBAC, session cookie, CSRF, Origin validation, audit trail, dan file access.
- Script operasional, backup, schema export, contract check, dan konfigurasi CI.
- Dokumentasi yang dapat menyebabkan konfigurasi tidak aman jika diikuti.

Area yang tidak termasuk scope publik:

- Nilai asli secret, token, password, DSN, IP internal, domain internal, atau
  detail infrastruktur privat.
- Data produksi atau data pribadi pengguna.
- Infrastruktur pihak ketiga yang tidak dikontrol repo ini.

## How to Report

Gunakan private GitHub Security Advisory jika fitur tersebut tersedia pada repo.
Jika belum tersedia, hubungi maintainer melalui kanal privat yang sudah
disepakati untuk proyek ini.

Jangan membuka public issue atau public discussion untuk laporan kerentanan yang
belum diperbaiki.

Saat melapor, sertakan:

- Ringkasan risiko dan komponen terdampak.
- Langkah reproduksi minimal memakai placeholder non-sensitif.
- Dampak terhadap confidentiality, integrity, availability, tenant isolation,
  audit trail, atau authorization.
- Versi branch/commit jika tersedia.
- Saran mitigasi jika sudah ada.

Jangan sertakan:

- Secret, password, token, private key, DSN lengkap, IP internal, atau domain
  internal.
- Dump database, file media privat, atau data produksi.
- Payload eksploitasi yang merusak data atau mengganggu layanan.

## Response Expectations

Maintainer akan melakukan triage, meminta detail tambahan jika perlu, lalu
menentukan prioritas perbaikan berdasarkan dampak dan kemungkinan eksploitasi.
Perbaikan security-sensitive harus menyertakan validasi yang relevan dan tidak
boleh menurunkan perlindungan session cookie, CSRF, Origin validation, RBAC, atau
audit trail.
