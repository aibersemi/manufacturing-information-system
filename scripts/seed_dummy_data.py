from django.db import transaction
from core.models import Tenant
from masterdata.models import (
    UOM,
    Material,
    ProductModel,
    ProductVariant,
    BOM,
    BOMItem,
    Routing,
    RoutingStage,
    PieceRate,
)
from datetime import date
import uuid


def run():
    print("Mulai import data ke Konveksi Dummy...")

    with transaction.atomic():
        # 1. Pastikan Tenant Ada
        tenant, created = Tenant.objects.get_or_create(
            name="Konveksi Dummy",
            defaults={
                "id": uuid.uuid4(),
                "schema_name": "public",  # Assuming single-db multi-tenant with tenant_id for now
            },
        )
        if created:
            print(f"Tenant '{tenant.name}' dibuat dengan ID {tenant.id}")
        else:
            print(f"Tenant '{tenant.name}' ditemukan dengan ID {tenant.id}")

        t_id = tenant.id

        # 2. Setup UOMs
        uom_map = {}
        for code, name in [
            ("ROLL", "Roll"),
            ("YARD", "Yard"),
            ("METER", "Meter"),
            ("KG", "Kilogram"),
            ("CM", "Centimeter"),
            ("LUSIN", "Lusin"),
            ("SET", "Set"),
            ("PAK", "Pak"),
            ("PCS", "Pieces"),
            ("GROSS", "Gross"),
        ]:
            uom, _ = UOM.objects.get_or_create(
                tenant_id=t_id, code=code, defaults={"name": name, "id": uuid.uuid4()}
            )
            uom_map[code] = uom

        # 3. Setup Materials
        # Material: (Code, Name, Purchase UOM, Usage UOM, Conv Ratio)
        materials_data = [
            (
                "MAT-RJN",
                "Bahan Kain RJN",
                "ROLL",
                "CM",
                9144,
            ),  # 1 roll = 91.44 meter = 9144 cm
            ("MAT-PURING", "Puring Saten Hitam Pekat", "ROLL", "CM", 9144),
            ("MAT-KARET", "Karet Lebar 5cm", "KG", "CM", 2862),  # 1 kg = 2862 cm
            ("MAT-SLETING-30", "Sleting Coil YKK 30 Inch Hitam", "LUSIN", "SET", 12),
            ("MAT-SLETING-ROLL", "Sleting Roll", "ROLL", "CM", 9144),
            ("MAT-SLETING-KEPALA", "Sleting Kepala YKK", "PAK", "PCS", 100),
            ("MAT-STOPER", "Stoper Botol Sleting", "PAK", "PCS", 500),
            ("MAT-MATA-ITIK", "Mata Itik v20 / 350 Nu Tr", "PAK", "PCS", 1400),
            ("MAT-TALI", "Tali String", "PAK", "CM", 9144),
            ("MAT-BENANG", "Benang Jahit", "PAK", "METER", 27432),
            ("MAT-KAPAS", "Kain Kapas", "METER", "CM", 100),
            ("MAT-LBL-SLIP", "Label Slip Mr Mads", "PCS", "PCS", 1),
            ("MAT-LBL-SATIN", "Label Satin Mr Mads", "PCS", "PCS", 1),
            ("MAT-LBL-WOVEN", "Label Woven Washing Machine", "PCS", "PCS", 1),
            ("MAT-LBL-UKURAN", "Label Ukuran", "ROLL", "PCS", 200),
            ("MAT-PLASTIK", "Kemasan Plastik", "PCS", "PCS", 1),
        ]

        mat_map = {}
        for code, name, pur_uom, use_uom, conv in materials_data:
            mat, _ = Material.objects.get_or_create(
                tenant_id=t_id,
                code=code,
                defaults={
                    "id": uuid.uuid4(),
                    "name": name,
                    "purchase_uom": uom_map[pur_uom],
                    "usage_uom": uom_map[use_uom],
                    "conversion_ratio": conv,
                },
            )
            mat_map[code] = mat

        # 4. Setup Product Model & Variants
        model, _ = ProductModel.objects.get_or_create(
            tenant_id=t_id,
            code="REINHARD",
            defaults={"id": uuid.uuid4(), "name": "Jaket Reinhard"},
        )

        variants_data = [
            ("REINHARD-0-S", "S"),
            ("REINHARD-0-M", "M"),
            ("REINHARD-0-L", "L"),
            ("REINHARD-0-XL", "XL"),
            ("REINHARD-0-XXL", "XXL"),
        ]

        var_map = {}
        for sku, size in variants_data:
            var, _ = ProductVariant.objects.get_or_create(
                tenant_id=t_id,
                product_model=model,
                sku=sku,
                defaults={"id": uuid.uuid4(), "size": size},
            )
            var_map[sku] = var

        # 5. Setup BOM
        common_bom_items = [
            ("MAT-KARET", 108),  # cm
            ("MAT-SLETING-30", 1),  # set
            ("MAT-SLETING-ROLL", 17),  # cm
            ("MAT-SLETING-KEPALA", 1),  # psc
            ("MAT-STOPER", 2),  # psc
            ("MAT-MATA-ITIK", 2),  # psc
            ("MAT-TALI", 71),  # cm
            ("MAT-KAPAS", 6.3),  # cm
            ("MAT-PLASTIK", 1),  # psc
            ("MAT-BENANG", 77),  # meter
            ("MAT-LBL-SLIP", 1),  # psc
            ("MAT-LBL-SATIN", 1),  # psc
            ("MAT-LBL-WOVEN", 1),  # psc
            ("MAT-LBL-UKURAN", 1),  # psc
        ]

        bom_variations = {
            "REINHARD-0-S": [("MAT-RJN", 155), ("MAT-PURING", 134)],
            "REINHARD-0-M": [("MAT-RJN", 160), ("MAT-PURING", 134)],
            "REINHARD-0-L": [("MAT-RJN", 170), ("MAT-PURING", 134)],
            "REINHARD-0-XL": [("MAT-RJN", 180), ("MAT-PURING", 138)],
            "REINHARD-0-XXL": [("MAT-RJN", 185), ("MAT-PURING", 142)],
        }

        for sku, var in var_map.items():
            bom, _ = BOM.objects.get_or_create(
                tenant_id=t_id,
                product_variant=var,
                version=1,
                defaults={"id": uuid.uuid4(), "effective_date": date.today()},
            )
            # Clear old items to avoid duplicates if re-run
            BOMItem.objects.filter(bom=bom).delete()

            # Insert specific items
            for mat_code, qty in bom_variations[sku]:
                BOMItem.objects.create(
                    tenant_id=t_id, bom=bom, material=mat_map[mat_code], quantity=qty
                )

            # Insert common items
            for mat_code, qty in common_bom_items:
                BOMItem.objects.create(
                    tenant_id=t_id, bom=bom, material=mat_map[mat_code], quantity=qty
                )

        # 6. Setup Routing & Routing Stages
        routing, _ = Routing.objects.get_or_create(
            tenant_id=t_id,
            product_model=model,
            version=1,
            defaults={"id": uuid.uuid4(), "effective_date": date.today()},
        )

        RoutingStage.objects.filter(routing=routing).delete()
        stages = [
            "Sablon",
            "Jahit",
            "Potong",
            "Packing & Buang Benang",
            "Kepala Produksi",
        ]

        stage_map = {}
        for idx, stage_name in enumerate(stages):
            rs = RoutingStage.objects.create(
                tenant_id=t_id,
                routing=routing,
                sequence=idx + 1,
                stage_name=stage_name,
                description=f"Tahap {stage_name}",
            )
            stage_map[stage_name] = rs

        # 7. Setup Piece Rates
        PieceRate.objects.filter(tenant_id=t_id, product_model=model).delete()
        rates = [
            ("Sablon", 1500),
            ("Jahit", 15000),
            ("Potong", 3000),
            ("Packing & Buang Benang", 1000),
            ("Kepala Produksi", 2000),
        ]

        for st_name, amount in rates:
            PieceRate.objects.create(
                tenant_id=t_id,
                id=uuid.uuid4(),
                product_model=model,
                stage_name=st_name,
                rate_amount=amount,
                effective_date=date.today(),
                change_reason="Initial Data",
            )

        print("Import data dummy ke Konveksi Dummy selesai dengan sukses!")


if __name__ == "__main__":
    run()
