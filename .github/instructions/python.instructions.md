---
name: Python dan Django MIS
applyTo: "backend/**/*.py"
---

# Python dan Django Rules

- Ikuti pola Django, Django Ninja, Pydantic, service layer, dan test yang sudah ada di modul terkait.
- Setiap endpoint bisnis baru wajib tenant-scoped, memakai session auth, validasi Pydantic, capability/RBAC server-side, dan audit trail bila mengubah data krusial.
- Jangan mempercayai filtering frontend untuk otorisasi. Backend tetap otoritas final untuk permission, operator assignment, status transition, stok, approval, dan invariant domain.
- Mutasi data wajib mempertahankan proteksi CSRF. WebSocket wajib mempertahankan validasi Origin.
- Query lintas tenant wajib eksplisit pada tenant aktif atau object tenant yang terverifikasi.
- Gunakan timezone-aware datetime. Timestamp disimpan UTC; proses bisnis/tampilan mengikuti `Asia/Jakarta` bila relevan.
- Untuk perubahan model, buat dan tinjau migration. Pastikan migration aman untuk data produksi dan idempotensi data migration terjaga.
- Untuk Dramatiq task atau outbox, pastikan efek samping aman di-retry dan tidak menulis audit/stock/accounting ganda.
- Script Python operasional yang membutuhkan `.env` wajib membaca konfigurasi dengan `python-dotenv`, memvalidasi env wajib secara eksplisit, dan tidak menulis nilai secret ke log, test fixture, atau dokumentasi.
- Jalankan `.venv/bin/ruff check .` dan pytest relevan setelah perubahan perilaku backend.
