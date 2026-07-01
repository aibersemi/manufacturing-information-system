# MIS Runtime Operations

Dokumen ini mencatat prosedur runtime dasar untuk baseline Tahap 0 MIS pada Ubuntu native tanpa Docker.

## Service systemd

Template unit disimpan di `scripts/systemd/` dan disinkronkan dengan unit aktif:

- `/etc/systemd/system/manufacturing-frontend.service`
- `/etc/systemd/system/manufacturing.service`
- `/etc/systemd/system/manufacturing-worker.service`
- `/etc/systemd/system/manufacturing-scheduler.service`
- `/etc/systemd/system/manufacturing-scheduler.timer`
- `/etc/systemd/system/manufacturing-backup.service`
- `/etc/systemd/system/manufacturing-backup.timer`

Jika template berubah, salin ke lokasi systemd, lalu jalankan:

```bash
sudo systemctl daemon-reload
sudo systemctl restart manufacturing-frontend.service
sudo systemctl restart manufacturing.service
sudo systemctl restart manufacturing-worker.service
sudo systemctl enable --now manufacturing-scheduler.timer
sudo systemctl enable --now manufacturing-backup.timer
```

Static origin frontend membutuhkan hasil `npm run build` pada `frontend/dist/index.html` sebelum service dapat dimulai.
`manufacturing-frontend.service` hanya menyajikan build produksi dari `frontend/dist` melalui Granian WSGI. Service ini bukan Vite dev server dan bukan Node runtime; service tetap dipakai agar reverse proxy privat bisa mengakses frontend melalui origin HTTP pada `FRONTEND_BIND_HOST:FRONTEND_PORT`.

## Frontend, Web, and Worker Commands

Granian WSGI frontend melalui WireGuard:

```bash
.venv/bin/granian --interface wsgi --host "$FRONTEND_BIND_HOST" --port "$FRONTEND_PORT" --workers 2 --no-ws scripts.frontend_wsgi:application
```

Granian ASGI backend melalui WireGuard:

```bash
.venv/bin/granian --interface asgi --host "$BACKEND_BIND_HOST" --port "$BACKEND_PORT" --workers 4 --pid-file /run/manufacturing/granian.pid backend.asgi:application
```

Dramatiq worker:

```bash
.venv/bin/dramatiq backend.core.tasks
```

Scheduler search projection:

```bash
.venv/bin/python backend/manage.py reindex_search --check-only
.venv/bin/python backend/manage.py reindex_search --check-only --skip-if-permission-denied
.venv/bin/python backend/manage.py reindex_search
```

Maintenance domain lengkap dijalankan oleh unit scheduler:

```bash
.venv/bin/python backend/manage.py run_scheduled_maintenance
```

## Backup dan Restore Drill

Backup manual menggunakan lokasi dan retensi yang sama dengan timer:

```bash
sudo systemctl start manufacturing-backup.service
sudo -u postgres scripts/backup_postgres.sh
sudo systemctl status manufacturing-backup.timer --no-pager
```

Base backup PostgreSQL disimpan per timestamp di `/data/backups/manufacturing-information-system/postgres/<YYYYMMDD-HHMMSS>/`. WAL archive kontinu berada di `/data/backups/manufacturing-information-system/postgres/wal`.

Setiap direktori base backup memuat `manifest.json`, `backup_manifest`, `verified-at.txt`, dan `wal-archive-status.txt`. Uji restore terisolasi tidak menimpa cluster aktif:

```bash
sudo -u postgres scripts/verify_postgres_restore.sh /data/backups/manufacturing-information-system/postgres/<timestamp>
```

Untuk drill PITR ke waktu tertentu, berikan `recovery_target_time` sebagai argumen kedua:

```bash
sudo -u postgres scripts/verify_postgres_restore.sh /data/backups/manufacturing-information-system/postgres/<timestamp> "2026-06-23 23:45:00+07"
```

Untuk drill PITR deterministik tanpa menyentuh data aplikasi, buat restore point lalu jalankan restore dengan target nama:

```bash
RESTORE_POINT="mis_pitr_$(date +%Y%m%d_%H%M%S)"
sudo -u postgres psql -d postgres -Atqc "select pg_create_restore_point('${RESTORE_POINT}')"
sudo -u postgres env RECOVERY_TARGET_NAME="${RESTORE_POINT}" scripts/verify_postgres_restore.sh /data/backups/manufacturing-information-system/postgres/<timestamp>
```

Hasil drill ditulis sebagai `restore-test-<timestamp>.txt` di direktori backup dan `manifest.json` diperbarui dengan `restore_drill_status=ok`. WAL archive harus dipantau agar jeda file tidak melewati target RPO 15 menit.

## Health Check

Endpoint health melalui origin privat:

```bash
curl -fsS "$PUBLIC_API_URL/api/health/live"
curl -fsS "$PUBLIC_API_URL/api/health/ready"
curl -fsS "$PUBLIC_API_URL/api/health/dependencies"
curl -fsS "$PUBLIC_API_URL/api/health/metrics"
curl -fsS "$PUBLIC_API_URL/api/schema"
```

`/api/health/live`, `/api/health/ready`, `/api/health/dependencies`, `/api/health/metrics`, `/api/schema`, dan `/api/docs` tetap publik untuk observability dan kontrak API. Endpoint API lain secara default memakai session auth dan CSRF untuk mutasi.

`/api/health/metrics` mengembalikan format Prometheus text. Metrik utama meliputi request HTTP per proses, durasi request, jumlah slow query lokal, kedalaman queue **Dramatiq**, status koneksi PostgreSQL, backlog outbox search, job ekspor, dan notifikasi. Variabel berikut dapat diatur di `.env`:

```bash
OBSERVABILITY_SLOW_QUERY_MS=500
OBSERVABILITY_DRAMATIQ_QUEUES=default
```

## Logs and Status

Gunakan journald/systemd sebagai sumber utama:

```bash
systemctl status manufacturing-frontend.service manufacturing.service manufacturing-worker.service manufacturing-scheduler.timer --no-pager
journalctl -u manufacturing-frontend.service -n 100 --no-pager
journalctl -u manufacturing.service -n 100 --no-pager
journalctl -u manufacturing-worker.service -n 100 --no-pager
journalctl -u manufacturing-scheduler.service -n 100 --no-pager
```

Untuk mengikuti log:

```bash
sudo journalctl -u manufacturing-frontend.service -f
sudo journalctl -u manufacturing.service -f
sudo journalctl -u manufacturing-worker.service -f
sudo journalctl -u manufacturing-scheduler.service -f
```

Log backend memakai JSON satu baris dan membawa `request_id` dari `X-Request-ID`. Event `request_finished` mencatat method, path, status, durasi, jumlah query, total durasi query, user, tenant, dan IP. Event `request_exception` mencatat exception dengan request ID yang sama. Query yang melampaui `OBSERVABILITY_SLOW_QUERY_MS` dicatat sebagai `database_slow_query` dengan SQL yang diringkas tanpa parameter.

Static origin dan backend hanya bind pada host privat dari `.env` (`FRONTEND_BIND_HOST` dan `BACKEND_BIND_HOST`); akses publik wajib melalui reverse proxy privat.
