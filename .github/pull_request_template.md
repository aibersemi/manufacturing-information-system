## Summary

Jelaskan perubahan utama dan alasan perubahan.

## Impacted Areas

- [ ] Backend/API
- [ ] Frontend/UI
- [ ] Database/Migration
- [ ] Authentication/RBAC
- [ ] Inventory/Production/Sales
- [ ] Finance/Accounting/Labor
- [ ] Documentation
- [ ] Operations/CI
- [ ] Security

## Validation

- [ ] `.venv/bin/ruff check`
- [ ] `.venv/bin/pytest --testmon --reuse-db`
- [ ] `npx @biomejs/biome check .`
- [ ] `npm run typecheck`
- [ ] `npm run test:frontend`
- [ ] `npm run build`
- [ ] Tidak relevan, alasan:

## Checklist

- [ ] Tidak ada secret, password, token, DSN lengkap, private key, IP internal, domain internal, atau data produksi.
- [ ] Perubahan backend tetap memakai session cookie, CSRF, RBAC, dan audit trail sesuai kebutuhan.
- [ ] Perubahan frontend tidak menyimpan credential di Local Storage atau Session Storage.
- [ ] Dokumentasi terkait sudah diperbarui jika perilaku, command, arsitektur, operasi, atau kontrak data berubah.
- [ ] Perubahan generated API client sudah sinkron jika schema backend berubah.
- [ ] Risiko restart service, migration, atau operasi produksi sudah dijelaskan jika ada.

## Reviewer Notes

Sertakan konteks tambahan, risiko, atau bagian yang perlu review khusus.
