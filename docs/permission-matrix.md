# Capability-Based RBAC

MIS memakai dua lapis kontrol akses:

1. **Frontend visibility guard** untuk menu, route, tombol, tabel, dan dashboard.
2. **Backend authorization guard** untuk menolak request tidak sah pada setiap endpoint.

Sumber kebenaran capability adalah backend. Frontend mengambil `GET /api/auth/capabilities` setelah session aktif dan hanya memakai capability untuk visibilitas/navigasi. Otorisasi final selalu ditegakkan backend.

## Pola Capability

Capability baru memakai pola granular:

```text
<area>.<resource>.<action>
```

Action standar:

| Action | Makna |
|---|---|
| `read` | Baca list/detail/report data. |
| `create` | Membuat data baru atau draft transaksi. |
| `update` | Mengubah data yang masih boleh diedit. |
| `delete` | Menghapus master data atau draft yang aman dihapus. |
| `activate` / `deactivate` | Mengubah lifecycle model dengan `is_active`. |

Action bisnis tambahan dipakai untuk transaksi final atau workflow, misalnya `verify`, `pay`, `cancel`, `reverse`, `post`, `approve`, `release`, `complete`, `close`, `dispose`, dan `depreciation.post`. Transaksi final tidak di-hard-delete; gunakan aksi bisnis agar audit trail tetap utuh.

Alias lama seperti `masterdata.manage`, `sales.orders.manage`, atau `accounting.journal.manage` masih dapat dikembalikan sementara untuk kompatibilitas, tetapi guard endpoint dan frontend baru harus memakai capability granular.

## Endpoint Capability

`GET /api/auth/capabilities` mengembalikan konteks user aktif:

```json
{
  "user": {
    "id": 1,
    "username": "jahit1",
    "full_name": "Penjahit Satu"
  },
  "tenant": {
    "id": 1,
    "name": "Dummy Konveksi",
    "slug": "dummy-konveksi"
  },
  "role": "operator",
  "operator": {
    "id": "uuid",
    "operator_type": "penjahit",
    "status": "internal",
    "is_active": true,
    "supervisor_id": null
  },
  "capabilities": [
    "auth.change_password",
    "dashboard.operator",
    "labor.attendance.self",
    "labor.cash_advance.self",
    "labor.work_logs.self",
    "production.job_packets.assigned.read",
    "production.progress.submit.assigned"
  ]
}
```

Daftar `capabilities` wajib deterministic dan sorted. Operator dengan role aktif tetapi tanpa profil operator aktif tetap dapat login dan mendapat empty-state operator, tetapi tidak mendapat capability kerja seperti attendance, kasbon, progress, atau job packet assigned.

## Role Utama

| Role | Tampilan utama | Prinsip akses |
|---|---|---|
| `super_admin` | Dashboard sistem | Full semua tenant, semua menu, semua aksi, audit, laporan, user, operator, dan tenant settings. |
| `finance` | Dashboard finance | Full CRUD dan lifecycle untuk finance/accounting serta master data pendukung finance; area operasional read-only. |
| `kepala_konveksi` | Dashboard operasional | CRU dan aktif/nonaktif untuk operasional non-finance; tidak mendapat delete operasional; tetap boleh petty cash operasional dan payment request create/read; tidak bisa akses accounting/assets/invoice/payment finance. |
| `operator` | Dashboard Tugas Saya | Hanya create/read self atau assigned sesuai `operator_type`, `status`, dan assignment. Tidak melihat data global bisnis. |

User `is_superuser` server-side memiliki role efektif `super_admin` pada semua tenant aktif walaupun tidak memiliki membership eksplisit.

## Ringkasan Role Matrix

| Area | Resource/action utama | Super Admin | Finance | Kepala Konveksi | Operator |
|---|---|---:|---:|---:|---:|
| Auth | `auth.change_password` | Ya | Ya | Ya | Ya |
| Dashboard | `dashboard.system` / `dashboard.finance` / `dashboard.operational` / `dashboard.operator` | Semua | Finance | Operasional | Operator |
| Settings tenant/user | `settings.tenants.*`, `settings.users.*` | Full | Tidak | Tidak | Tidak |
| Settings operator | `settings.operators.read/create/update/activate/deactivate` | Full | Tidak | Ya, tanpa delete/reset password | Tidak |
| Master data operasional | `masterdata.customers.*`, `suppliers.*`, `uoms.*`, `materials.*`, `products.*`, `product_variants.*`, `boms.*`, `bom_items.*`, `routings.*`, `routing_stages.*`, `piece_rates.*` | Full CRUD/lifecycle | `read` | `read/create/update/activate/deactivate` | Tidak |
| Master data finance | `masterdata.chart_of_accounts.*`, `bank_accounts.*`, `cost_categories.*` | Full | Full | Tidak | Tidak |
| Sales | `sales.orders.read/create/update`, fulfillment, short-close, deliveries, returns | Full | `read` | CRU + aksi operasional, tanpa delete | Tidak |
| Production | Orders, job packets, progress, rework, scrap, work logs | Full | `read` operasional terkait | CRU + aksi operasional, verify, tanpa delete | Assigned/self sesuai tipe |
| Inventory | Stock, ledger, purchase request, purchase order, receipt, adjustment, stock opname | Full | `read` | Create/update/approve/cancel operasional sesuai resource, tanpa delete | Tidak |
| Labor | Attendance, cash advance, piece-rate payment | Full | Piece-rate pay | Attendance/cash advance manage operasional | Self untuk internal |
| Petty cash | `finance.petty_cash.read/create/verify/balance` | Full | Full | Read/create/verify | Dapur hanya draft `out` milik sendiri |
| Payment request | `finance.payment_requests.read/create/defer/pay` | Full | Full | Read/create saja | Tidak |
| Asset/depreciation | `finance.assets.*`, `finance.assets.dispose`, `finance.assets.depreciation.post` | Full | Full | Tidak | Tidak |
| Invoice/payment finance | Customer/supplier invoice dan payment | Full | Full | Tidak | Tidak |
| Accounting | Journals, periods, accounting reports | Full | Full | Tidak | Tidak |
| Reports | `reports.operational.*`, `reports.finance.*` | Full | Finance | Operational | Tidak |
| Core | Notifications, audit, approvals | Full | Notification + audit read | Notification + audit read + approval read | Notification + audit self |

## Capability Per Area

Daftar berikut adalah capability utama yang dipakai guard backend dan frontend:

| Area | Capability |
|---|---|
| Settings | `settings.tenants.read/create/update/delete/activate/deactivate` |
| Settings | `settings.users.read/create/update/delete/activate/deactivate/reset_password` |
| Settings | `settings.operators.read/create/update/delete/activate/deactivate/reset_password` |
| Master Data | `masterdata.customers.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.suppliers.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.uoms.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.materials.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.products.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.product_variants.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.boms.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.bom_items.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.routings.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.routing_stages.read/create/update/delete/activate/deactivate` |
| Master Data | `masterdata.piece_rates.read/create/update/delete/activate/deactivate` |
| Master Data Finance | `masterdata.chart_of_accounts.read/create/update/delete/activate/deactivate` |
| Master Data Finance | `masterdata.bank_accounts.read/create/update/delete/activate/deactivate` |
| Master Data Finance | `masterdata.cost_categories.read/create/update/delete/activate/deactivate` |
| Sales | `sales.orders.read/create/update/delete/fulfillment/short_close` |
| Sales | `sales.deliveries.create/close`, `sales.returns.create` |
| Production | `production.orders.read/create/update/release/complete/recalculate_mrp/reserve_materials/generate_purchase_requests/issue_materials` |
| Production | `production.job_packets.read/create/accept/assigned.read` |
| Production | `production.progress.create/submit.assigned/verify` |
| Production | `production.rework.read/complete/assigned.complete` |
| Production | `production.scrap.read/approve`, `production.work_logs.read/adjust_rate/payment_request` |
| Inventory | `inventory.stock.read`, `inventory.material_ledger.read/create`, `inventory.product_ledger.read` |
| Inventory | `inventory.purchase_requests.read/create/submit` |
| Inventory | `inventory.purchases.read/create/confirm/cancel` |
| Inventory | `inventory.receipts.create`, `inventory.stock_adjustments.create/approve` |
| Inventory | `inventory.stock_opnames.read/create/update/approve` |
| Labor | `labor.attendance.read/create/self` |
| Labor | `labor.cash_advances.read/create`, `labor.cash_advance.self` |
| Labor | `labor.work_logs.self`, `labor.piece_rate.pay` |
| Finance | `finance.petty_cash.read/create/verify/balance/dapur_draft` |
| Finance | `finance.payment_requests.read/create/defer/pay` |
| Finance | `finance.assets.read/create/update/delete/activate/deactivate/dispose/depreciation.post` |
| Finance | `finance.customer_invoices.read/create`, `finance.customer_payments.create` |
| Finance | `finance.supplier_invoices.read/create/pay` |
| Accounting | `accounting.journals.read/create/reverse` |
| Accounting | `accounting.periods.read/close/reopen`, `accounting.reports.read` |
| Reports | `reports.operational.read/export`, `reports.finance.read/export` |
| Core | `core.notifications.read`, `core.audit.read/self`, `core.approvals.read/review` |

## Operator Type

Role `operator` hanya menentukan bahwa akun adalah akun kerja. Detail pekerjaan ditentukan oleh `operator_type`, `status`, profil aktif, dan assignment.

| `operator_type` | Capability utama | Pembatas backend |
|---|---|---|
| `penjahit` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Stage harus cocok dengan jahit/sewing dan job packet assigned. |
| `maklon` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Stage maklon/luar/outsource dan assignment. Attendance/kasbon hanya jika internal. |
| `potong` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Stage potong/cutting dan assignment. |
| `sablon` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Stage sablon/screen dan assignment. |
| `gudang` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Stage gudang/warehouse/serah/material dan assignment. Data stok global tetap tidak diberikan ke operator. |
| `pembelian` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Stage beli/purchase/pembelian/terima dan assignment. Approval/payment tetap non-operator. |
| `qc` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Stage qc/quality/kontrol dan assignment. Approval final tetap Kepala Konveksi. |
| `packing` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Stage packing/kemas/pack dan assignment. |
| `mandor` | `production.job_packets.assigned.read`, `production.progress.submit.assigned`, `production.rework.assigned.complete` | Bisa submit stage assigned lintas keyword, tetapi tidak mendapat master data/finance/settings. |
| `dapur` | `finance.petty_cash.read`, `finance.petty_cash.dapur_draft` | Hanya draft kas kecil `out`, internal, aktif, dan list milik user sendiri. |

## Status Operator

| Status | Perlakuan |
|---|---|
| `internal` | Bisa attendance self, kasbon self, work log self, dan pembayaran borongan self jika punya profil aktif. |
| `external` | Tidak bisa attendance harian dan tidak bisa mengajukan kasbon. Tetap bisa melihat/submit pekerjaan assigned sesuai `operator_type`. |

## Invariant Backend

- `require_capability()` dan `require_any_capability()` memvalidasi session tenant aktif melalui `get_tenant_context()`, lalu mengecek capability efektif role/operator.
- `get_tenant_context()` tetap memvalidasi user aktif, tenant aktif, membership aktif, role, dan mencatat `access_denied` untuk role yang ditolak.
- Endpoint job packet operator hanya mengembalikan packet yang assigned ke operator login.
- Endpoint progress operator mengabaikan `operator_id` dari client dan memakai operator dari session.
- Submit progress operator wajib memenuhi assignment dan stage yang cocok dengan `operator_type`.
- Rework complete operator hanya boleh untuk rework miliknya.
- Attendance dan cash advance self ditolak untuk operator external.
- Cash advance operator selalu self; client tidak boleh memilih operator lain.
- Petty cash operator hanya untuk dapur internal aktif, transaksi `out`, dan list data sendiri.
- Finance hanya read-only untuk sales/production/inventory/master data operasional.
- Kepala Konveksi tidak mendapat akses accounting, asset, invoice, payment, depreciation, journal, dan report finance.
- Frontend capability tidak boleh dianggap otorisasi final.
