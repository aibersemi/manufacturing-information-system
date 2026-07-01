import os
from datetime import timedelta
from decimal import Decimal

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from backend.accounting.models import AccountingPeriod, JournalEntry, JournalLine
from backend.core.models import AuditEvent, Tenant
from backend.finance.models import (
    Asset,
    CustomerInvoice,
    CustomerPayment,
    CustomerPaymentAllocation,
    DepreciationSchedule,
    Expense,
    InvoiceDelivery,
    PaymentRequest,
    PettyCashTransaction,
    SupplierInvoice,
    SupplierPayment,
)
from backend.inventory.models import (
    MaterialLedger,
    MaterialReceipt,
    MaterialReceiptLine,
    ProductBatch,
    ProductLedger,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseRequest,
    Warehouse,
)
from backend.labor.models import (
    Attendance,
    CashAdvance,
    CashAdvanceSettlement,
    PieceRatePayment,
    PieceRatePaymentItem,
)
from backend.masterdata.models import (
    BOM,
    BankAccount,
    BOMItem,
    ChartOfAccount,
    CostCategory,
    Customer,
    CustomerAddress,
    Material,
    Operator,
    PieceRate,
    ProductModel,
    ProductVariant,
    Routing,
    RoutingStage,
    Supplier,
    UOM,
)
from backend.production.models import (
    JobPacket,
    MaterialConsumption,
    MaterialRequirement,
    MaterialReservation,
    OperatorWorkLog,
    ProductionOrder,
    ProductionStageProgress,
    ReworkOrder,
    ScrapRecord,
    WIPBalance,
)
from backend.sales.models import (
    Delivery,
    DeliveryLine,
    SalesPO,
    SalesPOLine,
    SalesReturn,
    SalesReturnLine,
)

User = get_user_model()


class Command(BaseCommand):
    help = "Seed dummy business data for development and staging"

    def add_arguments(self, parser):
        parser.add_argument(
            "--tenant-slug",
            type=str,
            default=os.environ.get("DUMMY_TENANT_SLUG", "dummy-konveksi"),
            help="Slug tenant untuk data dummy",
        )

    def handle(self, *args, **options):
        tenant_slug = options["tenant_slug"]

        try:
            tenant = Tenant.objects.get(slug=tenant_slug)
        except Tenant.DoesNotExist:
            raise CommandError(
                f"Tenant dengan slug '{tenant_slug}' tidak ditemukan. Jalankan seed_dummy_konveksi terlebih dahulu."
            )

        try:
            user_kepala = User.objects.get(
                username=os.environ.get("DUMMY_KEPALA_USERNAME", "kepala")
            )
            user_finance = User.objects.get(
                username=os.environ.get("DUMMY_FINANCE_USERNAME", "finance")
            )
            op_potong = Operator.objects.get(
                tenant=tenant,
                user__username=os.environ.get(
                    "DUMMY_OPERATOR_POTONG_USERNAME", "potong"
                ),
            )
            op_jahit1 = Operator.objects.get(
                tenant=tenant,
                user__username=os.environ.get(
                    "DUMMY_OPERATOR_PENJAHIT_1_USERNAME", "jahit1"
                ),
            )
            op_jahit2 = Operator.objects.get(
                tenant=tenant,
                user__username=os.environ.get(
                    "DUMMY_OPERATOR_PENJAHIT_2_USERNAME", "jahit2"
                ),
            )
            op_dapur = Operator.objects.get(
                tenant=tenant,
                user__username=os.environ.get("DUMMY_OPERATOR_DAPUR_USERNAME", "dapur"),
            )
            op_gudang = Operator.objects.get(
                tenant=tenant,
                user__username=os.environ.get(
                    "DUMMY_OPERATOR_GUDANG_USERNAME", "gudang"
                ),
            )
        except (User.DoesNotExist, Operator.DoesNotExist) as e:
            raise CommandError(f"Gagal memuat user/operator dasar: {e}")

        jakarta_tz = ZoneInfo("Asia/Jakarta")
        today_dt = timezone.now().astimezone(jakarta_tz)
        today = today_dt.date()
        start_date = today - timedelta(days=7)
        start_dt = today_dt - timedelta(days=7)

        try:
            uom_pcs = UOM.objects.get(tenant=tenant, code="PCS")
            uom_m = UOM.objects.get(tenant=tenant, code="M")
            UOM.objects.get(tenant=tenant, code="KG")
            uom_roll = UOM.objects.get(tenant=tenant, code="ROLL")

            coa_kas = ChartOfAccount.objects.get(tenant=tenant, code="1000")
            ChartOfAccount.objects.get(tenant=tenant, code="1010")
            ChartOfAccount.objects.get(tenant=tenant, code="1100")
            coa_mat = ChartOfAccount.objects.get(tenant=tenant, code="1200")
            ChartOfAccount.objects.get(tenant=tenant, code="1210")
            ChartOfAccount.objects.get(tenant=tenant, code="1220")
            ChartOfAccount.objects.get(tenant=tenant, code="4000")
            ChartOfAccount.objects.get(tenant=tenant, code="5000")
            ChartOfAccount.objects.get(tenant=tenant, code="5100")
            coa_oh = ChartOfAccount.objects.get(tenant=tenant, code="5200")

            bank_utama = BankAccount.objects.get(tenant=tenant, name="Bank Utama")
            kas_kecil = BankAccount.objects.get(tenant=tenant, name="Kas Kecil")
        except (
            UOM.DoesNotExist,
            ChartOfAccount.DoesNotExist,
            BankAccount.DoesNotExist,
        ):
            raise CommandError("Data referensi UOM/COA belum bootstrap dengan benar.")

        if not Warehouse.objects.filter(tenant=tenant).exists():
            Warehouse.objects.create(tenant=tenant, name="Gudang Utama", code="WH")

        with transaction.atomic():
            self.stdout.write("Memulai seeding business data...")

            # --- 1. Master Data ---
            customers_data = [
                (
                    "DUMMY-CUST-001",
                    "Toko Seragam Nusantara",
                    "08111",
                    "n@d.com",
                    "Alamat 1",
                ),
                (
                    "DUMMY-CUST-002",
                    "PT Retail Sandang Jaya",
                    "08222",
                    "s@d.com",
                    "Alamat 2",
                ),
                (
                    "DUMMY-CUST-003",
                    "Komunitas Event Jakarta",
                    "08333",
                    "e@d.com",
                    "Alamat 3",
                ),
            ]
            customers = {}
            for cid, name, phone, email, address in customers_data:
                c, _ = Customer.objects.update_or_create(
                    tenant=tenant,
                    name=name,
                    defaults={
                        "phone": phone,
                        "email": email,
                        "address": address,
                        "is_active": True,
                    },
                )
                CustomerAddress.objects.update_or_create(
                    tenant=tenant,
                    customer=c,
                    label="Utama",
                    defaults={"address": address, "is_primary": True},
                )
                customers[cid] = c

            suppliers_data = [
                ("DUMMY-SUP-001", "CV Kain Makmur", "081", "k@d.com", "Alm 1"),
                ("DUMMY-SUP-002", "Toko Benang Sentosa", "082", "b@d.com", "Alm 2"),
                ("DUMMY-SUP-003", "PT Aksesori Garmen", "083", "a@d.com", "Alm 3"),
            ]
            suppliers = {}
            for sid, name, phone, email, address in suppliers_data:
                s, _ = Supplier.objects.update_or_create(
                    tenant=tenant,
                    name=name,
                    defaults={
                        "phone": phone,
                        "email": email,
                        "address": address,
                        "is_active": True,
                    },
                )
                suppliers[sid] = s

            materials_data = [
                (
                    "DUMMY-MAT-KAIN-001",
                    "Kain Drill Navy",
                    uom_roll,
                    uom_m,
                    Decimal("100"),
                    suppliers["DUMMY-SUP-001"],
                ),
                (
                    "DUMMY-MAT-KAIN-002",
                    "Kain Katun Hitam",
                    uom_roll,
                    uom_m,
                    Decimal("100"),
                    suppliers["DUMMY-SUP-001"],
                ),
                (
                    "DUMMY-MAT-BENANG-001",
                    "Benang Polyester Hitam",
                    uom_pcs,
                    uom_pcs,
                    Decimal("1"),
                    suppliers["DUMMY-SUP-002"],
                ),
                (
                    "DUMMY-MAT-KANCING-001",
                    "Kancing Plastik Hitam",
                    uom_pcs,
                    uom_pcs,
                    Decimal("1"),
                    suppliers["DUMMY-SUP-003"],
                ),
                (
                    "DUMMY-MAT-RESLETING-001",
                    "Resleting YKK 20cm",
                    uom_pcs,
                    uom_pcs,
                    Decimal("1"),
                    suppliers["DUMMY-SUP-003"],
                ),
                (
                    "DUMMY-MAT-LABEL-001",
                    "Label Brand Dummy",
                    uom_pcs,
                    uom_pcs,
                    Decimal("1"),
                    suppliers["DUMMY-SUP-003"],
                ),
            ]
            materials = {}
            for mid, name, puom, uuom, conv, sup in materials_data:
                m, _ = Material.objects.update_or_create(
                    tenant=tenant,
                    code=mid,
                    defaults={
                        "name": name,
                        "purchase_uom": puom,
                        "usage_uom": uuom,
                        "conversion_ratio": conv,
                        "default_supplier": sup,
                        "is_active": True,
                    },
                )
                materials[mid] = m

            pm_kemeja, _ = ProductModel.objects.update_or_create(
                tenant=tenant,
                code="DUMMY_PROD_KEMEJA",
                defaults={"name": "Kemeja Kerja Dummy", "is_active": True},
            )
            pm_celana, _ = ProductModel.objects.update_or_create(
                tenant=tenant,
                code="DUMMY_PROD_CELANA",
                defaults={"name": "Celana Kerja Dummy", "is_active": True},
            )

            variants = {}
            for sku, pm, color, size in [
                ("DUMMY_PROD_KEMEJA-NAVY-M", pm_kemeja, "Navy", "M"),
                ("DUMMY_PROD_KEMEJA-NAVY-L", pm_kemeja, "Navy", "L"),
                ("DUMMY_PROD_CELANA-HITAM-M", pm_celana, "Hitam", "M"),
                ("DUMMY_PROD_CELANA-HITAM-L", pm_celana, "Hitam", "L"),
            ]:
                v, _ = ProductVariant.objects.update_or_create(
                    tenant=tenant,
                    sku=sku,
                    defaults={
                        "product_model": pm,
                        "color": color,
                        "size": size,
                        "is_active": True,
                        "default_margin_percent": Decimal("20"),
                    },
                )
                variants[sku] = v

            def create_bom(variant, items_config):
                bom, _ = BOM.objects.update_or_create(
                    tenant=tenant,
                    product_variant=variant,
                    version=1,
                    defaults={"effective_date": start_date, "is_active": True},
                )
                BOMItem.objects.filter(tenant=tenant, bom=bom).delete()
                for mat_key, qty in items_config:
                    BOMItem.objects.create(
                        tenant=tenant,
                        bom=bom,
                        material=materials[mat_key],
                        quantity=Decimal(str(qty)),
                    )
                return bom

            boms = {
                "DUMMY_PROD_KEMEJA-NAVY-M": create_bom(
                    variants["DUMMY_PROD_KEMEJA-NAVY-M"],
                    [
                        ("DUMMY-MAT-KAIN-001", 1.8),
                        ("DUMMY-MAT-BENANG-001", 0.05),
                        ("DUMMY-MAT-KANCING-001", 8),
                        ("DUMMY-MAT-LABEL-001", 1),
                    ],
                ),
                "DUMMY_PROD_KEMEJA-NAVY-L": create_bom(
                    variants["DUMMY_PROD_KEMEJA-NAVY-L"],
                    [
                        ("DUMMY-MAT-KAIN-001", 2.0),
                        ("DUMMY-MAT-BENANG-001", 0.06),
                        ("DUMMY-MAT-KANCING-001", 8),
                        ("DUMMY-MAT-LABEL-001", 1),
                    ],
                ),
                "DUMMY_PROD_CELANA-HITAM-M": create_bom(
                    variants["DUMMY_PROD_CELANA-HITAM-M"],
                    [
                        ("DUMMY-MAT-KAIN-002", 1.6),
                        ("DUMMY-MAT-BENANG-001", 0.04),
                        ("DUMMY-MAT-KANCING-001", 1),
                        ("DUMMY-MAT-RESLETING-001", 1),
                        ("DUMMY-MAT-LABEL-001", 1),
                    ],
                ),
                "DUMMY_PROD_CELANA-HITAM-L": create_bom(
                    variants["DUMMY_PROD_CELANA-HITAM-L"],
                    [
                        ("DUMMY-MAT-KAIN-002", 1.8),
                        ("DUMMY-MAT-BENANG-001", 0.05),
                        ("DUMMY-MAT-KANCING-001", 1),
                        ("DUMMY-MAT-RESLETING-001", 1),
                        ("DUMMY-MAT-LABEL-001", 1),
                    ],
                ),
            }

            def create_routing(pm):
                r, _ = Routing.objects.update_or_create(
                    tenant=tenant,
                    product_model=pm,
                    version=1,
                    defaults={"effective_date": start_date, "is_active": True},
                )
                stages = []
                for seq, name, req_qc in [
                    (1, "Potong", False),
                    (2, "Jahit", False),
                    (3, "QC", True),
                    (4, "Packing", False),
                ]:
                    rs, _ = RoutingStage.objects.update_or_create(
                        tenant=tenant,
                        routing=r,
                        sequence=seq,
                        defaults={"stage_name": name, "requires_qc": req_qc},
                    )
                    stages.append(rs)
                return r, stages

            r_kemeja, rs_kemeja = create_routing(pm_kemeja)
            r_celana, rs_celana = create_routing(pm_celana)

            for pm in [pm_kemeja, pm_celana]:
                for stage_name, rate in [
                    ("Potong", 500),
                    ("Jahit", 3500),
                    ("QC", 300),
                    ("Packing", 250),
                ]:
                    PieceRate.objects.update_or_create(
                        tenant=tenant,
                        product_model=pm,
                        stage_name=stage_name,
                        effective_date=start_date,
                        defaults={"rate_amount": Decimal(str(rate)), "is_active": True},
                    )

            cc_meal, _ = CostCategory.objects.update_or_create(
                tenant=tenant,
                code="DUMMY-COST-MEAL",
                defaults={"name": "Konsumsi/Dapur", "expense_account": coa_oh},
            )
            cc_trans, _ = CostCategory.objects.update_or_create(
                tenant=tenant,
                code="DUMMY-COST-TRANSPORT",
                defaults={"name": "Transport", "expense_account": coa_oh},
            )
            cc_maint, _ = CostCategory.objects.update_or_create(
                tenant=tenant,
                code="DUMMY-COST-MAINT",
                defaults={"name": "Maintenance Mesin", "expense_account": coa_oh},
            )

            # --- 2. Inventory & Pembelian ---
            pr1, _ = PurchaseRequest.objects.update_or_create(
                tenant=tenant,
                pr_number="DUMMY-PR-001",
                defaults={
                    "material": materials["DUMMY-MAT-KAIN-001"],
                    "requested_qty": Decimal("10"),
                    "status": PurchaseRequest.Status.ORDERED,
                },
            )
            pr2, _ = PurchaseRequest.objects.update_or_create(
                tenant=tenant,
                pr_number="DUMMY-PR-002",
                defaults={
                    "material": materials["DUMMY-MAT-BENANG-001"],
                    "requested_qty": Decimal("50"),
                    "status": PurchaseRequest.Status.SUBMITTED,
                },
            )

            po1, _ = PurchaseOrder.objects.update_or_create(
                tenant=tenant,
                po_number="DUMMY-PO-SUP-001",
                defaults={
                    "supplier": suppliers["DUMMY-SUP-001"],
                    "order_date": start_date,
                    "due_date": start_date + timedelta(days=3),
                    "status": PurchaseOrder.Status.COMPLETED,
                    "total_amount": Decimal("1000000"),
                },
            )
            po1_line, _ = PurchaseOrderLine.objects.update_or_create(
                tenant=tenant,
                purchase_order=po1,
                material=materials["DUMMY-MAT-KAIN-001"],
                defaults={
                    "purchase_request": pr1,
                    "quantity": Decimal("10"),
                    "unit_price": Decimal("100000"),
                    "received_qty": Decimal("10"),
                    "invoiced_qty": Decimal("10"),
                },
            )

            po2, _ = PurchaseOrder.objects.update_or_create(
                tenant=tenant,
                po_number="DUMMY-PO-SUP-002",
                defaults={
                    "supplier": suppliers["DUMMY-SUP-002"],
                    "order_date": start_date + timedelta(days=1),
                    "status": PurchaseOrder.Status.PARTIAL_RECEIPT,
                    "total_amount": Decimal("100000"),
                },
            )
            po2_line, _ = PurchaseOrderLine.objects.update_or_create(
                tenant=tenant,
                purchase_order=po2,
                material=materials["DUMMY-MAT-BENANG-001"],
                defaults={
                    "quantity": Decimal("50"),
                    "unit_price": Decimal("2000"),
                    "received_qty": Decimal("20"),
                    "invoiced_qty": Decimal("20"),
                },
            )

            gr1, _ = MaterialReceipt.objects.update_or_create(
                tenant=tenant,
                receipt_number="DUMMY-GR-001",
                defaults={
                    "purchase_order": po1,
                    "receipt_date": start_date + timedelta(days=1),
                    "received_by": user_kepala,
                },
            )
            MaterialReceiptLine.objects.update_or_create(
                tenant=tenant,
                receipt=gr1,
                purchase_order_line=po1_line,
                defaults={
                    "received_qty": Decimal("10"),
                    "accepted_qty": Decimal("10"),
                    "unit_cost": Decimal("100000"),
                },
            )

            gr2, _ = MaterialReceipt.objects.update_or_create(
                tenant=tenant,
                receipt_number="DUMMY-GR-002",
                defaults={
                    "purchase_order": po2,
                    "receipt_date": start_date + timedelta(days=2),
                    "received_by": user_kepala,
                },
            )
            MaterialReceiptLine.objects.update_or_create(
                tenant=tenant,
                receipt=gr2,
                purchase_order_line=po2_line,
                defaults={
                    "received_qty": Decimal("20"),
                    "accepted_qty": Decimal("20"),
                    "unit_cost": Decimal("2000"),
                },
            )

            MaterialLedger.objects.update_or_create(
                tenant=tenant,
                idempotency_key="DUMMY-ML-GR1",
                defaults={
                    "material": materials["DUMMY-MAT-KAIN-001"],
                    "transaction_type": MaterialLedger.TransactionType.RECEIPT,
                    "quantity": Decimal("10")
                    * materials["DUMMY-MAT-KAIN-001"].conversion_ratio,
                    "unit_cost": Decimal("1000"),
                    "reference_document": "DUMMY-GR-001",
                },
            )
            MaterialLedger.objects.update_or_create(
                tenant=tenant,
                idempotency_key="DUMMY-ML-GR2",
                defaults={
                    "material": materials["DUMMY-MAT-BENANG-001"],
                    "transaction_type": MaterialLedger.TransactionType.RECEIPT,
                    "quantity": Decimal("20")
                    * materials["DUMMY-MAT-BENANG-001"].conversion_ratio,
                    "unit_cost": Decimal("2000"),
                    "reference_document": "DUMMY-GR-002",
                },
            )

            # --- 3. Sales ---
            spo1, _ = SalesPO.objects.update_or_create(
                tenant=tenant,
                po_number="DUMMY-SALES-PO-001",
                defaults={
                    "customer": customers["DUMMY-CUST-001"],
                    "order_date": start_date,
                    "due_date": today,
                    "status": SalesPO.Status.COMPLETED,
                    "fulfillment_strategy": SalesPO.FulfillmentStrategy.PRODUCTION,
                },
            )
            spo1_l1, _ = SalesPOLine.objects.update_or_create(
                tenant=tenant,
                sales_po=spo1,
                product_variant=variants["DUMMY_PROD_KEMEJA-NAVY-M"],
                defaults={
                    "quantity": 10,
                    "unit_price": Decimal("150000"),
                    "fulfilled_qty": 10,
                    "produced_qty": 10,
                },
            )
            spo1_l2, _ = SalesPOLine.objects.update_or_create(
                tenant=tenant,
                sales_po=spo1,
                product_variant=variants["DUMMY_PROD_KEMEJA-NAVY-L"],
                defaults={
                    "quantity": 5,
                    "unit_price": Decimal("160000"),
                    "fulfilled_qty": 5,
                    "produced_qty": 5,
                },
            )

            spo2, _ = SalesPO.objects.update_or_create(
                tenant=tenant,
                po_number="DUMMY-SALES-PO-002",
                defaults={
                    "customer": customers["DUMMY-CUST-002"],
                    "order_date": start_date + timedelta(days=1),
                    "status": SalesPO.Status.PARTIAL,
                    "fulfillment_strategy": SalesPO.FulfillmentStrategy.COMBINED,
                },
            )
            spo2_l1, _ = SalesPOLine.objects.update_or_create(
                tenant=tenant,
                sales_po=spo2,
                product_variant=variants["DUMMY_PROD_CELANA-HITAM-M"],
                defaults={
                    "quantity": 20,
                    "unit_price": Decimal("180000"),
                    "fulfilled_qty": 10,
                    "produced_qty": 15,
                },
            )
            spo2_l2, _ = SalesPOLine.objects.update_or_create(
                tenant=tenant,
                sales_po=spo2,
                product_variant=variants["DUMMY_PROD_CELANA-HITAM-L"],
                defaults={
                    "quantity": 20,
                    "unit_price": Decimal("190000"),
                    "fulfilled_qty": 0,
                    "produced_qty": 0,
                },
            )

            spo3, _ = SalesPO.objects.update_or_create(
                tenant=tenant,
                po_number="DUMMY-SALES-PO-003",
                defaults={
                    "customer": customers["DUMMY-CUST-003"],
                    "order_date": today - timedelta(days=1),
                    "status": SalesPO.Status.CONFIRMED,
                },
            )
            SalesPOLine.objects.update_or_create(
                tenant=tenant,
                sales_po=spo3,
                product_variant=variants["DUMMY_PROD_KEMEJA-NAVY-M"],
                defaults={
                    "quantity": 50,
                    "unit_price": Decimal("140000"),
                    "fulfilled_qty": 0,
                    "produced_qty": 0,
                },
            )

            del1, _ = Delivery.objects.update_or_create(
                tenant=tenant,
                delivery_number="DUMMY-SJ-001",
                defaults={
                    "sales_po": spo1,
                    "date": today - timedelta(days=1),
                    "status": Delivery.Status.DELIVERED,
                },
            )
            DeliveryLine.objects.update_or_create(
                tenant=tenant,
                delivery=del1,
                sales_po_line=spo1_l1,
                defaults={"quantity": 10},
            )
            DeliveryLine.objects.update_or_create(
                tenant=tenant,
                delivery=del1,
                sales_po_line=spo1_l2,
                defaults={"quantity": 5},
            )

            del2, _ = Delivery.objects.update_or_create(
                tenant=tenant,
                delivery_number="DUMMY-SJ-002",
                defaults={
                    "sales_po": spo2,
                    "date": today,
                    "status": Delivery.Status.SHIPPED,
                },
            )
            dl2_1, _ = DeliveryLine.objects.update_or_create(
                tenant=tenant,
                delivery=del2,
                sales_po_line=spo2_l1,
                defaults={"quantity": 10},
            )

            ret1, _ = SalesReturn.objects.update_or_create(
                tenant=tenant,
                return_number="DUMMY-RET-001",
                defaults={
                    "delivery": del2,
                    "date": today,
                    "reason": "Jahitan miring",
                    "status": "pending",
                },
            )
            SalesReturnLine.objects.update_or_create(
                tenant=tenant,
                sales_return=ret1,
                delivery_line=dl2_1,
                product_variant=variants["DUMMY_PROD_CELANA-HITAM-M"],
                defaults={
                    "quantity": 1,
                    "disposition": SalesReturnLine.Disposition.REWORK,
                },
            )

            # --- 4. Production ---
            spk1, _ = ProductionOrder.objects.update_or_create(
                tenant=tenant,
                order_number="DUMMY-SPK-001",
                defaults={
                    "order_type": ProductionOrder.Type.FOR_PO,
                    "sales_po_line": spo1_l1,
                    "product_variant": variants["DUMMY_PROD_KEMEJA-NAVY-M"],
                    "target_quantity": 10,
                    "status": ProductionOrder.Status.COMPLETED,
                    "bom": boms["DUMMY_PROD_KEMEJA-NAVY-M"],
                    "routing": r_kemeja,
                    "output_quantity": 10,
                    "released_at": start_dt + timedelta(days=1),
                    "completed_at": today_dt - timedelta(days=2),
                },
            )
            spk2, _ = ProductionOrder.objects.update_or_create(
                tenant=tenant,
                order_number="DUMMY-SPK-002",
                defaults={
                    "order_type": ProductionOrder.Type.FOR_PO,
                    "sales_po_line": spo2_l1,
                    "product_variant": variants["DUMMY_PROD_CELANA-HITAM-M"],
                    "target_quantity": 20,
                    "status": ProductionOrder.Status.IN_PROGRESS,
                    "bom": boms["DUMMY_PROD_CELANA-HITAM-M"],
                    "routing": r_celana,
                    "released_at": start_dt + timedelta(days=2),
                },
            )
            spk3, _ = ProductionOrder.objects.update_or_create(
                tenant=tenant,
                order_number="DUMMY-SPK-003",
                defaults={
                    "order_type": ProductionOrder.Type.FOR_STOCK,
                    "product_variant": variants["DUMMY_PROD_KEMEJA-NAVY-L"],
                    "target_quantity": 5,
                    "status": ProductionOrder.Status.COMPLETED,
                    "bom": boms["DUMMY_PROD_KEMEJA-NAVY-L"],
                    "routing": r_kemeja,
                    "output_quantity": 5,
                    "released_at": start_dt + timedelta(days=2),
                    "completed_at": today_dt - timedelta(days=1),
                },
            )

            for spk in [spk1, spk2, spk3]:
                for bi in BOMItem.objects.filter(tenant=tenant, bom=spk.bom):
                    req_qty = bi.quantity * spk.target_quantity
                    req, _ = MaterialRequirement.objects.update_or_create(
                        tenant=tenant,
                        production_order=spk,
                        material=bi.material,
                        defaults={
                            "required_usage_qty": req_qty,
                            "reserved_usage_qty": req_qty,
                        },
                    )
                    MaterialReservation.objects.update_or_create(
                        tenant=tenant, requirement=req, defaults={"quantity": req_qty}
                    )

                    if spk.status in [
                        ProductionOrder.Status.IN_PROGRESS,
                        ProductionOrder.Status.COMPLETED,
                        ProductionOrder.Status.QC_PACKING,
                    ]:
                        MaterialConsumption.objects.update_or_create(
                            tenant=tenant,
                            production_order=spk,
                            material=bi.material,
                            defaults={
                                "quantity": req_qty,
                                "unit_cost": Decimal("1000"),
                                "inventory_reference": "DUMMY-INV-REF",
                            },
                        )
                        MaterialLedger.objects.update_or_create(
                            tenant=tenant,
                            idempotency_key=f"DUMMY-ML-ISSUE-{spk.order_number}-{bi.material.code}",
                            defaults={
                                "material": bi.material,
                                "transaction_type": MaterialLedger.TransactionType.ISSUE,
                                "quantity": req_qty,
                                "unit_cost": Decimal("1000"),
                                "reference_document": spk.order_number,
                                "production_order": spk,
                            },
                        )

            def create_job_packet(spk, packet_num, qty, stage, op, status):
                jp, _ = JobPacket.objects.update_or_create(
                    tenant=tenant,
                    packet_number=packet_num,
                    defaults={
                        "production_order": spk,
                        "quantity": qty,
                        "current_stage": stage,
                        "assigned_operator": op,
                        "status": status,
                    },
                )
                return jp

            jp1_potong = create_job_packet(
                spk1,
                "DUMMY-JP-001-A",
                10,
                rs_kemeja[0],
                op_potong,
                JobPacket.Status.VERIFIED,
            )
            prog1, _ = ProductionStageProgress.objects.update_or_create(
                tenant=tenant,
                job_packet=jp1_potong,
                stage=rs_kemeja[0],
                operator=op_potong,
                defaults={
                    "qty_in": 10,
                    "qty_good": 10,
                    "is_verified": True,
                    "verified_by": user_kepala,
                },
            )
            OperatorWorkLog.objects.update_or_create(
                tenant=tenant,
                progress=prog1,
                operator=op_potong,
                defaults={
                    "qty_claimed": 10,
                    "piece_rate_applied": Decimal("500"),
                    "amount_total": Decimal("5000"),
                    "is_verified": True,
                },
            )

            jp1_jahit = create_job_packet(
                spk1,
                "DUMMY-JP-001-B",
                10,
                rs_kemeja[1],
                op_jahit1,
                JobPacket.Status.VERIFIED,
            )
            prog2, _ = ProductionStageProgress.objects.update_or_create(
                tenant=tenant,
                job_packet=jp1_jahit,
                stage=rs_kemeja[1],
                operator=op_jahit1,
                defaults={
                    "qty_in": 10,
                    "qty_good": 9,
                    "qty_defect": 1,
                    "is_verified": True,
                    "verified_by": user_kepala,
                },
            )
            OperatorWorkLog.objects.update_or_create(
                tenant=tenant,
                progress=prog2,
                operator=op_jahit1,
                defaults={
                    "qty_claimed": 9,
                    "piece_rate_applied": Decimal("3500"),
                    "amount_total": Decimal("31500"),
                    "is_verified": True,
                },
            )

            jp2_jahit = create_job_packet(
                spk2,
                "DUMMY-JP-002-A",
                20,
                rs_celana[1],
                op_jahit2,
                JobPacket.Status.SUBMITTED,
            )
            ProductionStageProgress.objects.update_or_create(
                tenant=tenant,
                job_packet=jp2_jahit,
                stage=rs_celana[1],
                operator=op_jahit2,
                defaults={"qty_in": 20, "qty_good": 15, "qty_remaining": 5},
            )

            jp3_qc = create_job_packet(
                spk3,
                "DUMMY-JP-003-A",
                5,
                rs_kemeja[2],
                op_gudang,
                JobPacket.Status.VERIFIED,
            )
            ProductionStageProgress.objects.update_or_create(
                tenant=tenant,
                job_packet=jp3_qc,
                stage=rs_kemeja[2],
                operator=op_gudang,
                defaults={
                    "qty_in": 5,
                    "qty_good": 5,
                    "is_verified": True,
                    "verified_by": user_kepala,
                },
            )

            ReworkOrder.objects.update_or_create(
                tenant=tenant,
                source_progress=prog2,
                target_stage=rs_kemeja[1],
                operator=op_jahit1,
                defaults={
                    "quantity": 1,
                    "status": ReworkOrder.Status.PASSED,
                    "result_good": 1,
                },
            )
            ScrapRecord.objects.update_or_create(
                tenant=tenant,
                production_order=spk1,
                defaults={"quantity": Decimal("0.5"), "reason": "Potongan gagal"},
            )

            WIPBalance.objects.update_or_create(
                tenant=tenant,
                production_order=spk2,
                stage=rs_celana[1],
                defaults={"quantity": 20, "value": Decimal("150000")},
            )

            batch1, _ = ProductBatch.objects.update_or_create(
                tenant=tenant,
                lot_number="DUMMY-LOT-001",
                defaults={
                    "product_variant": variants["DUMMY_PROD_KEMEJA-NAVY-M"],
                    "production_order": spk1,
                    "received_quantity": 10,
                    "unit_cost": Decimal("80000"),
                    "status": ProductBatch.Status.EXHAUSTED,
                },
            )
            ProductLedger.objects.update_or_create(
                tenant=tenant,
                idempotency_key="DUMMY-PL-IN-001",
                defaults={
                    "product_variant": variants["DUMMY_PROD_KEMEJA-NAVY-M"],
                    "transaction_type": ProductLedger.TransactionType.PRODUCTION_IN,
                    "quantity": 10,
                    "batch": batch1,
                    "batch_lot_number": batch1.lot_number,
                    "to_category": ProductLedger.Category.AVAILABLE,
                    "reference_document": spk1.order_number,
                },
            )
            ProductLedger.objects.update_or_create(
                tenant=tenant,
                idempotency_key="DUMMY-PL-OUT-001",
                defaults={
                    "product_variant": variants["DUMMY_PROD_KEMEJA-NAVY-M"],
                    "transaction_type": ProductLedger.TransactionType.SALES_OUT,
                    "quantity": 10,
                    "batch": batch1,
                    "batch_lot_number": batch1.lot_number,
                    "from_category": ProductLedger.Category.AVAILABLE,
                    "reference_document": del1.delivery_number,
                },
            )

            batch2, _ = ProductBatch.objects.update_or_create(
                tenant=tenant,
                lot_number="DUMMY-LOT-002",
                defaults={
                    "product_variant": variants["DUMMY_PROD_KEMEJA-NAVY-L"],
                    "production_order": spk3,
                    "received_quantity": 5,
                    "unit_cost": Decimal("85000"),
                    "status": ProductBatch.Status.OPEN,
                },
            )
            ProductLedger.objects.update_or_create(
                tenant=tenant,
                idempotency_key="DUMMY-PL-IN-002",
                defaults={
                    "product_variant": variants["DUMMY_PROD_KEMEJA-NAVY-L"],
                    "transaction_type": ProductLedger.TransactionType.PRODUCTION_IN,
                    "quantity": 5,
                    "batch": batch2,
                    "batch_lot_number": batch2.lot_number,
                    "to_category": ProductLedger.Category.AVAILABLE,
                    "reference_document": spk3.order_number,
                },
            )

            # --- 5. Labor ---
            for i in range(8):
                att_date = start_date + timedelta(days=i)
                for op in [op_potong, op_jahit1, op_jahit2, op_dapur, op_gudang]:
                    Attendance.objects.update_or_create(
                        tenant=tenant,
                        operator=op,
                        date=att_date,
                        defaults={"is_present": True, "meal_eligible": True},
                    )

            ca1, _ = CashAdvance.objects.update_or_create(
                tenant=tenant,
                operator=op_potong,
                date=start_date,
                defaults={
                    "amount": Decimal("50000"),
                    "remaining_amount": Decimal("45000"),
                },
            )

            pay1, _ = PieceRatePayment.objects.update_or_create(
                tenant=tenant,
                operator=op_potong,
                date=today,
                defaults={
                    "gross_amount": Decimal("5000"),
                    "cash_advance_deduction": Decimal("5000"),
                    "net_paid": Decimal("0"),
                    "payment_account": bank_utama,
                    "paid_by": user_finance,
                },
            )

            work_log_potong = OperatorWorkLog.objects.get(
                tenant=tenant, operator=op_potong, progress=prog1
            )
            work_log_potong.is_paid = True
            work_log_potong.save()
            pay1.work_logs.add(work_log_potong)

            PieceRatePaymentItem.objects.update_or_create(
                tenant=tenant,
                payment=pay1,
                work_log=work_log_potong,
                defaults={
                    "quantity": 10,
                    "reference_rate": Decimal("500"),
                    "paid_rate": Decimal("500"),
                    "gross_amount": Decimal("5000"),
                },
            )
            CashAdvanceSettlement.objects.update_or_create(
                tenant=tenant,
                payment=pay1,
                cash_advance=ca1,
                defaults={"amount": Decimal("5000")},
            )

            # --- 6. Finance ---
            sinv1, _ = SupplierInvoice.objects.update_or_create(
                tenant=tenant,
                invoice_number="DUMMY-SINV-001",
                defaults={
                    "purchase_order": po1,
                    "supplier": suppliers["DUMMY-SUP-001"],
                    "date": start_date + timedelta(days=1),
                    "due_date": today,
                    "total_amount": Decimal("1000000"),
                    "amount_paid": Decimal("1000000"),
                    "status": SupplierInvoice.Status.PAID,
                },
            )
            SupplierPayment.objects.update_or_create(
                tenant=tenant,
                invoice=sinv1,
                date=start_date + timedelta(days=2),
                defaults={
                    "amount": Decimal("1000000"),
                    "payment_method": "transfer",
                    "account": bank_utama,
                    "paid_by": user_finance,
                },
            )

            cinv1, _ = CustomerInvoice.objects.update_or_create(
                tenant=tenant,
                invoice_number="DUMMY-CINV-001",
                defaults={
                    "sales_po": spo1,
                    "customer": customers["DUMMY-CUST-001"],
                    "date": today - timedelta(days=1),
                    "total_amount": Decimal("2300000"),
                    "amount_paid": Decimal("2300000"),
                    "status": CustomerInvoice.Status.PAID,
                },
            )
            InvoiceDelivery.objects.update_or_create(
                tenant=tenant,
                invoice=cinv1,
                delivery=del1,
                defaults={"amount": Decimal("2300000")},
            )
            cp1, _ = CustomerPayment.objects.update_or_create(
                tenant=tenant,
                date=today,
                amount=Decimal("2300000"),
                payment_method="transfer",
                defaults={
                    "invoice": cinv1,
                    "customer": customers["DUMMY-CUST-001"],
                    "account": bank_utama,
                },
            )
            CustomerPaymentAllocation.objects.update_or_create(
                tenant=tenant,
                payment=cp1,
                invoice=cinv1,
                defaults={"amount": Decimal("2300000")},
            )

            PettyCashTransaction.objects.update_or_create(
                tenant=tenant,
                date=today,
                type=PettyCashTransaction.Type.OUT,
                amount=Decimal("15000"),
                defaults={
                    "category": "DUMMY-COST-MEAL",
                    "status": PettyCashTransaction.Status.POSTED,
                    "account": kas_kecil,
                    "created_by": user_finance,
                },
            )

            Expense.objects.update_or_create(
                tenant=tenant,
                date=today,
                category=cc_maint,
                amount=Decimal("200000"),
                defaults={"account": bank_utama, "description": "Servis Mesin"},
            )

            ast1, _ = Asset.objects.update_or_create(
                tenant=tenant,
                name="Mesin Jahit Dummy",
                defaults={
                    "category": "Mesin Produksi",
                    "acquisition_value": Decimal("5000000"),
                    "acquisition_date": start_date - timedelta(days=30),
                    "useful_life_months": 60,
                    "depreciation_start_date": start_date - timedelta(days=30),
                },
            )
            DepreciationSchedule.objects.update_or_create(
                tenant=tenant,
                asset=ast1,
                date=today,
                defaults={"amount": Decimal("83333"), "is_posted": True},
            )

            PaymentRequest.objects.update_or_create(
                tenant=tenant,
                request_number="DUMMY-PAYREQ-001",
                defaults={
                    "request_type": "supplier_payment",
                    "source_type": "supplier_invoice",
                    "source_id": "DUMMY-SINV-001",
                    "amount": Decimal("1000000"),
                    "recipient": "CV Kain Makmur",
                    "status": PaymentRequest.Status.PAID,
                    "requested_by": user_finance,
                    "account": bank_utama,
                },
            )

            # --- 7. Accounting ---
            period, _ = AccountingPeriod.objects.update_or_create(
                tenant=tenant,
                start_date=today.replace(day=1),
                end_date=(today.replace(day=28) + timedelta(days=4)).replace(day=1)
                - timedelta(days=1),
                defaults={
                    "name": today.strftime("%B %Y"),
                    "status": AccountingPeriod.Status.OPEN,
                },
            )

            je1, _ = JournalEntry.objects.update_or_create(
                tenant=tenant,
                period=period,
                entry_number="DUMMY-JE-001",
                defaults={
                    "date": start_date + timedelta(days=1),
                    "description": "Penerimaan Material",
                    "reference": "DUMMY-GR-001",
                    "status": JournalEntry.Status.POSTED,
                    "is_automatic": True,
                },
            )
            JournalLine.objects.filter(tenant=tenant, journal=je1).delete()
            JournalLine.objects.create(
                tenant=tenant,
                journal=je1,
                account=coa_mat,
                debit=Decimal("1000000"),
                credit=Decimal("0"),
            )
            JournalLine.objects.create(
                tenant=tenant,
                journal=je1,
                account=coa_kas,
                debit=Decimal("0"),
                credit=Decimal("1000000"),
            )

            # --- 8. Core/Audit ---
            AuditEvent.objects.create(
                tenant=tenant,
                user=user_kepala,
                action="dummy_business_seed_completed",
                resource_type="Tenant",
                resource_id=tenant.slug,
            )

            self.stdout.write(
                self.style.SUCCESS("Berhasil melakukan seeding business data dummy.")
            )
