# MIS Database, Cache, and Search Engine

- **Database Utama**: **PostgreSQL** menjadi *Single Source of Truth* untuk seluruh data transaksi, audit, dan konfigurasi bisnis.
- **Redis**: Satu *instance* berjalan secara *system-wide* dan dipisahkan secara logis menggunakan *Logical Database Index*:
  - **Index 0** (`redis://localhost:6379/0`) menjadi *broker* antrean khusus **Dramatiq** dan *background processing*.
  - **Index 1** (`redis://localhost:6379/1`) menjadi *real-time backend* **Django Channels**, *cache* aplikasi, *rate limiting*, dan penyimpanan data sementara.
- **Search Engine**: **Meilisearch** menjadi *read-only search projection* yang selalu dapat dibangun ulang dari **PostgreSQL**.
- **Klien Search**: Backend menggunakan SDK resmi **Meilisearch Python** sebagai boundary komunikasi ke Meilisearch; modul `backend/core/search.py` tetap menjadi facade internal aplikasi untuk menjaga kontrak domain tetap stabil.
- **Kredensial Search**: Operasi indexing dan reindex memakai `MEILISEARCH_API_KEY` dari environment. Endpoint `/health` Meilisearch dapat terbaca tanpa key, tetapi endpoint index stats dan dokumen akan ditolak jika key belum dikonfigurasi atau key tidak memiliki izin indexing/write.
- **Sinkronisasi Search**: Perubahan data pada model terdaftar dicatat melalui *transactional outbox*, lalu pesan worker dipanggil setelah *database commit*. Worker **Dramatiq** memproses event secara *idempotent*, mencatat `processed_at`, dan menaikkan `retry_count` saat komunikasi **Meilisearch** gagal.
- **Registry Search**: Serializer dokumen berada di `backend/core/search.py` agar event incremental dan *full rebuild* memakai kontrak dokumen yang sama.
- **Rekonsiliasi**: Command `backend/manage.py reindex_search --check-only` membandingkan jumlah dokumen PostgreSQL dan Meilisearch. Command `backend/manage.py reindex_search` membangun ulang projection dari PostgreSQL. Timer `manufacturing-scheduler.timer` menjalankan pemeriksaan konsistensi terjadwal.
