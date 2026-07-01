---
name: database-migration
description: Gunakan skill ini saat membuat, meninjau, atau memperbaiki migration Django dan perubahan schema database MIS.
---

# Database Migration Skill

Saat bekerja dengan migration:

1. Baca model, migration sebelumnya, test domain, dan dokumen domain terkait.
2. Pastikan perubahan schema aman untuk data produksi dan tenant isolation.
3. Hindari migration yang membutuhkan lock besar atau rewrite data luas tanpa alasan kuat.
4. Untuk field baru pada tabel berisi data, tentukan default, nullability, backfill, dan constraint secara eksplisit.
5. Data migration harus idempotent, tenant-aware, dan aman bila dijalankan ulang pada environment staging.
6. Jalankan `.venv/bin/python backend/manage.py makemigrations` bila model berubah, lalu tinjau file migration hasilnya.
7. Sebelum menjalankan `migrate`, validasi target environment/database dari env anchor yang benar tanpa menulis DSN atau nilai secret ke output.
8. Jalankan `.venv/bin/python backend/manage.py migrate` pada environment yang sesuai sebelum menyatakan selesai.
9. Tambah atau update test untuk invariant domain yang berubah.
10. Jika migration memengaruhi API/frontend contract, jalankan `npm run generate:api` dan `npm run contract:check`.
