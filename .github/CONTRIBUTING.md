# Contributing

Terima kasih sudah membantu pengembangan Manufacturing Information System (MIS).
Ikuti panduan ini agar perubahan mudah direview, aman, dan sesuai kontrak repo.

## General Principles

- Gunakan Bahasa Indonesia untuk percakapan, dokumentasi, commit message, dan
  ringkasan kerja. Istilah teknis berbahasa Inggris boleh dipakai jika lebih
  jelas.
- Jangan commit kredensial, token, password, DSN lengkap, private key, IP
  internal, domain internal, atau detail infrastruktur sensitif.
- Gunakan nama environment variable sebagai anchor, misalnya `DATABASE_URL`,
  `SECRET_KEY`, `PUBLIC_API_URL`, atau `DUMMY_KEPALA_PASSWORD`.
- Jangan memindahkan kode frontend/client-side ke `backend/`, dan jangan
  menaruh kode backend/server-side di `frontend/`.

## Local Setup

Jalankan perintah dari root repo.

```bash
.venv/bin/python -m pip install -e ".[dev]"
npm ci
```

Salin `.env.example` ke `.env` lokal dan isi nilai privat hanya di `.env`.
Jangan menyalin nilai asli dari `.env` ke file tracked.

## Backend Validation

Untuk perubahan Python/Django:

```bash
.venv/bin/ruff check
.venv/bin/pytest --testmon --reuse-db
```

Gunakan pytest spesifik jika perubahan sangat sempit, lalu jelaskan scope test
di pull request.

## Frontend Validation

Untuk perubahan React/Vite:

```bash
npx @biomejs/biome check
npx tsc --noEmit
```

Untuk perubahan UI, routing, build config, atau integrasi frontend yang
signifikan:

```bash
npm run build
```

Untuk perubahan unit/component test frontend:

```bash
npx vitest
```

## Documentation

- Update root `README.md` jika perubahan memengaruhi gambaran umum proyek,
  struktur repo, navigasi dokumentasi, atau command utama.
- Update `backend/README.md` atau `frontend/README.md` jika perubahan hanya
  berdampak pada area tersebut.
- Update dokumen di `docs/` jika perubahan memengaruhi arsitektur, operasi,
  keamanan, permission, domain model, atau kontrak data.
- Jangan update dokumentasi secara kosmetik jika tidak membantu pembaca.

## Pull Request

Pull request sebaiknya:

- Menjelaskan masalah dan solusi secara ringkas.
- Menyebut area terdampak: backend, frontend, docs, scripts, operations, atau
  security.
- Menyertakan hasil validasi yang dijalankan.
- Menjelaskan risiko migrasi data, runtime, service restart, atau perubahan
  konfigurasi jika ada.
- Tidak menyertakan secret atau data produksi.

## Domain Terms

- Gunakan istilah "produk" untuk hasil produksi, SKU, item jual, dan stok produk
  jadi.
- Gunakan istilah "material" atau "bahan" untuk input produksi, pembelian,
  penerimaan, pemakaian BOM, dan stok gudang material.
- Hindari istilah "barang" untuk konteks pembelian atau penerimaan stok.
- SKU `ProductVariant` wajib berformat `MODEL-WARNA-UKURAN`, tepat tiga segmen
  dipisah `-`, tanpa spasi.
