# Manufacturing Information System (MIS)

<p align="center">
  <a href="https://github.com/aibersemi/manufacturing-information-system/actions/workflows/backend-ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/aibersemi/manufacturing-information-system/backend-ci.yml?branch=main&style=flat-square&label=backend%20ci" alt="Backend CI" /></a>
  <a href="https://github.com/aibersemi/manufacturing-information-system/actions/workflows/frontend-ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/aibersemi/manufacturing-information-system/frontend-ci.yml?branch=main&style=flat-square&label=frontend%20ci" alt="Frontend CI" /></a>
  <a href="https://github.com/aibersemi/manufacturing-information-system/actions/workflows/security.yml"><img src="https://img.shields.io/github/actions/workflow/status/aibersemi/manufacturing-information-system/security.yml?branch=main&style=flat-square&label=security" alt="Security" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/aibersemi/manufacturing-information-system?style=flat-square" alt="License" /></a>
  <a href="https://saweria.co/aibersemi"><img src="https://img.shields.io/badge/Support-Saweria-F97316?style=flat-square" alt="Support on Saweria" /></a>
</p>

Sistem Informasi Manufaktur komprehensif yang dirancang untuk mengelola produksi, inventaris, dan operasional bisnis manufaktur (konveksi/garmen).

## Repository Structure

Sistem ini menggunakan arsitektur monorepo dengan pemisahan _backend_ dan _frontend_:

- [`backend/`](backend/README.md) — Aplikasi backend berbasis **Django** dan **Django Ninja** (REST API), serta **Django Channels** untuk WebSocket. Menangani *business logic*, autentikasi, dan database.
- [`frontend/`](frontend/README.md) — Aplikasi frontend berbasis **React** dan **Vite**, menggunakan **TanStack Query**, **Router**, **Table**, **Form**, **Virtual**, **Ranger**, dan **Store**, serta **shadcn/ui**.
- [`docs/`](docs/architecture.md) — Dokumentasi arsitektur dan referensi teknis mendalam lintas-*service*.
- [`scripts/`](scripts/) — Skrip utilitas untuk pengembangan dan operasional.

## Documentation

Silakan merujuk pada dokumentasi spesifik area untuk instruksi pengembangan dan operasional:

- [Panduan Agent](AGENTS.md)
- [Dokumentasi Backend](backend/README.md)
- [Dokumentasi Frontend](frontend/README.md)
- [Administrasi Konveksi dan Pengguna](docs/administration.md)
- [Arsitektur Sistem](docs/architecture.md)
- [Database, Cache, dan Search Engine](docs/data-platform.md)
- [Deployment Topology](docs/deployment.md)
- [Domain Model](docs/domain-model.md)
- [Operasi Runtime](docs/operations.md)
- [Permission Matrix dan Capability RBAC](docs/permission-matrix.md)
- [Authentication dan Security](docs/security.md)

## Main Commands

Pastikan Anda berada di _root_ repositori saat menjalankan perintah berikut.

### Development

```bash
# Menjalankan development server Vite (Frontend)
npm run dev

# Menjalankan Granian ASGI backend
.venv/bin/granian --interface asgi --host 127.0.0.1 --port 8016 backend.asgi:application
```

### Build & API Contract

```bash
# Build frontend untuk produksi
npm run build

# Generate OpenAPI client (setelah schema backend berubah)
npm run generate:api

# Verifikasi schema OpenAPI dan generated client masih sinkron
npm run contract:check
```

### Test & Quality

```bash
# Backend
.venv/bin/ruff check .
.venv/bin/pytest

# Frontend
npm run lint
npm run test
npm run typecheck
npm run test:frontend
```

### Production Runtime

Frontend static origin, backend ASGI, dan worker dikelola oleh systemd:

```bash
systemctl status manufacturing-frontend.service manufacturing.service manufacturing-worker.service manufacturing-scheduler.timer manufacturing-backup.timer --no-pager
```

Detail build, restart, health check, dan log tersedia di [Operasi Runtime](docs/operations.md).

## Support

Dukung pengembangan MIS melalui [Saweria](https://saweria.co/aibersemi).

## License

Project ini menggunakan MIT License. Lihat [`LICENSE`](LICENSE) untuk teks lisensi lengkap.
