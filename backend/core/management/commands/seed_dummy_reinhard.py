import os
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.finance.models import Asset
from backend.inventory.models import (
    MaterialLedger,
    MaterialReceipt,
    MaterialReceiptLine,
    PurchaseOrder,
    PurchaseOrderLine,
)
from backend.masterdata.models import (
    BOM,
    BOMItem,
    ChartOfAccount,
    CostCategory,
    Material,
    PieceRate,
    ProductModel,
    ProductVariant,
    Routing,
    RoutingStage,
    Supplier,
    UOM,
)
from backend.core.models import Tenant

User = get_user_model()


def money(value: str) -> Decimal:
    return Decimal(value)


def usage_unit_cost(unit_price: Decimal, conversion_ratio: Decimal) -> Decimal:
    return (unit_price / conversion_ratio).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


UOMS = {
    "CM": ("Centimeter", UOM.Dimension.LENGTH),
    "GROSS": ("Gross", UOM.Dimension.COUNT),
    "KG": ("Kilogram", UOM.Dimension.MASS),
    "LUSIN": ("Lusin", UOM.Dimension.COUNT),
    "M": ("Meter", UOM.Dimension.LENGTH),
    "PAK": ("Pak", UOM.Dimension.COUNT),
    "PCS": ("Pieces", UOM.Dimension.COUNT),
    "ROLL": ("Roll", UOM.Dimension.COUNT),
    "SET": ("Set", UOM.Dimension.COUNT),
    "YARD": ("Yard", UOM.Dimension.LENGTH),
}

MATERIALS = [
    {
        "code": "MAT-RJN",
        "name": "Bahan Kain RJN",
        "purchase_uom": "ROLL",
        "usage_uom": "CM",
        "conversion_ratio": "9144",
        "unit_price": "1900000",
    },
    {
        "code": "MAT-PURING",
        "name": "Puring Saten Hitam Pekat",
        "purchase_uom": "ROLL",
        "usage_uom": "CM",
        "conversion_ratio": "9144",
        "unit_price": "700000",
    },
    {
        "code": "MAT-KARET",
        "name": "Karet Lebar 5cm",
        "purchase_uom": "KG",
        "usage_uom": "CM",
        "conversion_ratio": "2862",
        "unit_price": "37000",
    },
    {
        "code": "MAT-SLETING-30",
        "name": "Sleting Coil YKK 30 Inch Hitam",
        "purchase_uom": "LUSIN",
        "usage_uom": "SET",
        "conversion_ratio": "12",
        "unit_price": "48000",
    },
    {
        "code": "MAT-SLETING-ROLL",
        "name": "Sleting Roll",
        "purchase_uom": "ROLL",
        "usage_uom": "CM",
        "conversion_ratio": "9144",
        "unit_price": "55000",
    },
    {
        "code": "MAT-SLETING-KEPALA",
        "name": "Sleting Kepala YKK",
        "purchase_uom": "PAK",
        "usage_uom": "PCS",
        "conversion_ratio": "100",
        "unit_price": "240000",
    },
    {
        "code": "MAT-STOPER",
        "name": "Stoper Botol Sleting",
        "purchase_uom": "PAK",
        "usage_uom": "PCS",
        "conversion_ratio": "500",
        "unit_price": "67500",
    },
    {
        "code": "MAT-MATA-ITIK",
        "name": "Mata Itik v20 / 350 Nu Tr",
        "purchase_uom": "PAK",
        "usage_uom": "PCS",
        "conversion_ratio": "1400",
        "unit_price": "50000",
    },
    {
        "code": "MAT-TALI",
        "name": "Tali String",
        "purchase_uom": "PAK",
        "usage_uom": "CM",
        "conversion_ratio": "9144",
        "unit_price": "45000",
    },
    {
        "code": "MAT-BENANG",
        "name": "Benang Jahit",
        "purchase_uom": "PAK",
        "usage_uom": "M",
        "conversion_ratio": "27432",
        "unit_price": "80000",
    },
    {
        "code": "MAT-KAPAS",
        "name": "Kain Kapas",
        "purchase_uom": "M",
        "usage_uom": "CM",
        "conversion_ratio": "100",
        "unit_price": "5000",
    },
    {
        "code": "MAT-LBL-SLIP",
        "name": "Label Slip Mr Mads",
        "purchase_uom": "PCS",
        "usage_uom": "PCS",
        "conversion_ratio": "1",
        "unit_price": "213",
        "purchase_qty": "100",
        "moq": "100",
        "purchase_multiple": "100",
    },
    {
        "code": "MAT-LBL-SATIN",
        "name": "Label Satin Mr Mads",
        "purchase_uom": "PCS",
        "usage_uom": "PCS",
        "conversion_ratio": "1",
        "unit_price": "350",
        "purchase_qty": "100",
        "moq": "100",
        "purchase_multiple": "100",
    },
    {
        "code": "MAT-LBL-WOVEN",
        "name": "Label Woven Washing Machine",
        "purchase_uom": "PCS",
        "usage_uom": "PCS",
        "conversion_ratio": "1",
        "unit_price": "450",
        "purchase_qty": "100",
        "moq": "100",
        "purchase_multiple": "100",
    },
    {
        "code": "MAT-LBL-UKURAN",
        "name": "Label Ukuran",
        "purchase_uom": "ROLL",
        "usage_uom": "PCS",
        "conversion_ratio": "200",
        "unit_price": "12000",
    },
    {
        "code": "MAT-PLASTIK",
        "name": "Kemasan Plastik",
        "purchase_uom": "PCS",
        "usage_uom": "PCS",
        "conversion_ratio": "1",
        "unit_price": None,
    },
]

VARIANT_YIELDS = {
    "REINHARD-0-S": ("S", 60, "155", "134"),
    "REINHARD-0-M": ("M", 59, "160", "134"),
    "REINHARD-0-L": ("L", 57, "170", "134"),
    "REINHARD-0-XL": ("XL", 55, "180", "138"),
    "REINHARD-0-XXL": ("XXL", 50, "185", "142"),
}

COMMON_BOM_ITEMS = [
    ("MAT-KARET", "108"),
    ("MAT-SLETING-30", "1"),
    ("MAT-SLETING-ROLL", "17"),
    ("MAT-SLETING-KEPALA", "1"),
    ("MAT-STOPER", "2"),
    ("MAT-MATA-ITIK", "2"),
    ("MAT-TALI", "71"),
    ("MAT-KAPAS", "6.3"),
    ("MAT-PLASTIK", "1"),
    ("MAT-BENANG", "77"),
    ("MAT-LBL-SLIP", "1"),
    ("MAT-LBL-SATIN", "1"),
    ("MAT-LBL-WOVEN", "1"),
    ("MAT-LBL-UKURAN", "1"),
]

PIECE_RATES = [
    ("Potong", "3000"),
    ("Sablon", "1500"),
    ("Jahit", "15000"),
    ("Packing & Buang Benang", "1000"),
    ("Kepala Produksi", "2000"),
]

MONTHLY_COSTS = [
    ("REINHARD-COST-LISTRIK", "Listrik"),
    ("REINHARD-COST-MAKAN", "Makan"),
    ("REINHARD-COST-TRANSPORT", "Transport"),
    ("REINHARD-COST-MAINTENANCE", "Maintenance"),
    ("REINHARD-COST-SEWA", "Sewa Tempat"),
]

ASSETS = [
    "Mesin Jahit",
    "Meja Potong",
    "Mesin Potong",
    "Mesin Zigzag",
    "Roda Troli",
    "Rak",
    "Kursi",
    "Keranjang",
]


class Command(BaseCommand):
    help = "Seed data dummy REINHARD dari plan/dummy/data_dummy.md"

    def add_arguments(self, parser):
        parser.add_argument(
            "--tenant-slug",
            type=str,
            default=os.environ.get("DUMMY_TENANT_SLUG", "dummy-konveksi"),
            help="Slug tenant tujuan",
        )

    def handle(self, *args, **options):
        tenant_slug = options["tenant_slug"]
        try:
            tenant = Tenant.objects.get(slug=tenant_slug)
        except Tenant.DoesNotExist as exc:
            raise CommandError(
                f"Tenant dengan slug '{tenant_slug}' tidak ditemukan. Jalankan seed_dummy_konveksi terlebih dahulu."
            ) from exc

        user = User.objects.filter(
            username=os.environ.get("DUMMY_KEPALA_USERNAME", "kepala")
        ).first()

        today = date.today()
        with transaction.atomic():
            self.stdout.write("Memulai seeding dummy REINHARD...")
            uoms = self._seed_uoms(tenant)
            supplier = self._seed_supplier(tenant)
            materials = self._seed_materials(tenant, uoms, supplier)
            product_model, variants = self._seed_products(tenant)
            self._seed_boms(tenant, today, materials, variants)
            self._seed_routing_and_rates(tenant, today, product_model)
            self._seed_purchase_reference(tenant, today, supplier, materials, user)
            self._seed_monthly_costs(tenant)
            self._seed_assets(tenant, today)

        self.stdout.write(self.style.SUCCESS("Seed dummy REINHARD selesai."))

    def _seed_uoms(self, tenant):
        uoms = {}
        for code, (name, dimension) in UOMS.items():
            uom, _ = UOM.objects.update_or_create(
                tenant=tenant,
                code=code,
                defaults={"name": name, "dimension": dimension},
            )
            uoms[code] = uom
        return uoms

    def _seed_supplier(self, tenant):
        supplier, _ = Supplier.objects.update_or_create(
            tenant=tenant,
            name="Supplier Material REINHARD",
            defaults={"contact_person": "", "is_active": True},
        )
        return supplier

    def _seed_materials(self, tenant, uoms, supplier):
        materials = {}
        for item in MATERIALS:
            conversion_ratio = Decimal(item["conversion_ratio"])
            material, _ = Material.objects.update_or_create(
                tenant=tenant,
                code=item["code"],
                defaults={
                    "name": item["name"],
                    "purchase_uom": uoms[item["purchase_uom"]],
                    "usage_uom": uoms[item["usage_uom"]],
                    "conversion_ratio": conversion_ratio,
                    "package_quantity": conversion_ratio,
                    "moq": Decimal(item.get("moq", "1")),
                    "purchase_multiple": Decimal(item.get("purchase_multiple", "1")),
                    "default_supplier": supplier,
                    "last_purchase_price": (
                        money(item["unit_price"]) if item["unit_price"] is not None else None
                    ),
                    "is_active": True,
                },
            )
            materials[item["code"]] = material
        return materials

    def _seed_products(self, tenant):
        product_model, _ = ProductModel.objects.update_or_create(
            tenant=tenant,
            code="REINHARD",
            defaults={"name": "Jaket REINHARD", "is_active": True},
        )
        variants = {}
        for sku, (
            size,
            estimated_yield,
            _rjn_qty,
            _puring_qty,
        ) in VARIANT_YIELDS.items():
            variant, _ = ProductVariant.objects.update_or_create(
                tenant=tenant,
                sku=sku,
                defaults={
                    "product_model": product_model,
                    "size": size,
                    "metadata": {
                        "estimated_yield_per_rjn_roll": estimated_yield,
                        "source": "plan/dummy/data_dummy.md",
                    },
                    "is_active": True,
                },
            )
            variants[sku] = variant
        return product_model, variants

    def _seed_boms(self, tenant, today, materials, variants):
        for sku, variant in variants.items():
            _size, _estimated_yield, rjn_qty, puring_qty = VARIANT_YIELDS[sku]
            bom, _ = BOM.objects.update_or_create(
                tenant=tenant,
                product_variant=variant,
                version=1,
                defaults={"effective_date": today, "is_active": True},
            )
            BOMItem.objects.filter(tenant=tenant, bom=bom).delete()
            for material_code, quantity in [
                ("MAT-RJN", rjn_qty),
                ("MAT-PURING", puring_qty),
                *COMMON_BOM_ITEMS,
            ]:
                BOMItem.objects.create(
                    tenant=tenant,
                    bom=bom,
                    material=materials[material_code],
                    quantity=Decimal(quantity),
                )

    def _seed_routing_and_rates(self, tenant, today, product_model):
        routing, _ = Routing.objects.update_or_create(
            tenant=tenant,
            product_model=product_model,
            version=1,
            defaults={"effective_date": today, "is_active": True},
        )
        for sequence, (stage_name, _rate) in enumerate(PIECE_RATES, start=1):
            stage = RoutingStage.objects.filter(
                tenant=tenant,
                routing=routing,
                sequence=sequence,
            ).first()
            if stage is None:
                RoutingStage.objects.create(
                    tenant=tenant,
                    routing=routing,
                    sequence=sequence,
                    stage_name=stage_name,
                    requires_qc=False,
                )
            else:
                stage.stage_name = stage_name
                stage.requires_qc = False
                stage.save(update_fields=["stage_name", "requires_qc", "updated_at"])
            PieceRate.objects.update_or_create(
                tenant=tenant,
                product_model=product_model,
                stage_name=stage_name,
                effective_date=today,
                defaults={
                    "rate_amount": Decimal(_rate),
                    "change_reason": "Seed dummy REINHARD",
                    "is_active": True,
                },
            )

    def _seed_purchase_reference(self, tenant, today, supplier, materials, user):
        purchasable_items = [
            item for item in MATERIALS if item["unit_price"] is not None
        ]
        total_amount = sum(
            Decimal(item.get("purchase_qty", "1")) * money(item["unit_price"])
            for item in purchasable_items
        )
        po, _ = PurchaseOrder.objects.update_or_create(
            tenant=tenant,
            po_number="REINHARD-PO-MATERIAL-001",
            defaults={
                "supplier": supplier,
                "order_date": today,
                "status": PurchaseOrder.Status.COMPLETED,
                "total_amount": total_amount,
                "reconciliation_status": "reconciled",
            },
        )
        receipt, _ = MaterialReceipt.objects.update_or_create(
            tenant=tenant,
            receipt_number="REINHARD-GR-MATERIAL-001",
            defaults={
                "purchase_order": po,
                "receipt_date": today,
                "supplier_do_number": "DUMMY-REINHARD",
                "received_by": user,
            },
        )
        for item in purchasable_items:
            material = materials[item["code"]]
            purchase_qty = Decimal(item.get("purchase_qty", "1"))
            unit_price = money(item["unit_price"])
            line, _ = PurchaseOrderLine.objects.update_or_create(
                tenant=tenant,
                purchase_order=po,
                material=material,
                defaults={
                    "quantity": purchase_qty,
                    "unit_price": unit_price,
                    "received_qty": purchase_qty,
                    "invoiced_qty": Decimal("0"),
                    "conversion_ratio_snapshot": material.conversion_ratio,
                },
            )
            MaterialReceiptLine.objects.update_or_create(
                tenant=tenant,
                receipt=receipt,
                purchase_order_line=line,
                defaults={
                    "received_qty": purchase_qty,
                    "accepted_qty": purchase_qty,
                    "rejected_qty": Decimal("0"),
                    "unit_cost": unit_price,
                    "reconciliation_status": "matched",
                },
            )
            MaterialLedger.objects.update_or_create(
                tenant=tenant,
                idempotency_key=f"REINHARD-GR-MATERIAL-001:{material.code}",
                defaults={
                    "material": material,
                    "transaction_type": MaterialLedger.TransactionType.RECEIPT,
                    "quantity": purchase_qty * material.conversion_ratio,
                    "unit_cost": usage_unit_cost(unit_price, material.conversion_ratio),
                    "reference_document": receipt.receipt_number,
                    "responsible_user": user,
                    "conversion_ratio_snapshot": material.conversion_ratio,
                },
            )

    def _seed_monthly_costs(self, tenant):
        coa_oh = ChartOfAccount.objects.filter(tenant=tenant, code="5200").first()
        for code, name in MONTHLY_COSTS:
            CostCategory.objects.update_or_create(
                tenant=tenant,
                code=code,
                defaults={
                    "name": name,
                    "allocation_basis": CostCategory.AllocationBasis.MANUAL,
                    "expense_account": coa_oh,
                    "is_active": True,
                },
            )

    def _seed_assets(self, tenant, today):
        for name in ASSETS:
            Asset.objects.update_or_create(
                tenant=tenant,
                name=name,
                defaults={
                    "category": "Peralatan Konveksi",
                    "acquisition_value": Decimal("0"),
                    "acquisition_date": today,
                    "useful_life_months": 60,
                    "depreciation_start_date": today,
                    "status": Asset.Status.ACTIVE,
                    "location": "Konveksi Dummy",
                },
            )
