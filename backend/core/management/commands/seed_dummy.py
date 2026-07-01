from django.core.management.base import BaseCommand
from django.db import transaction
from datetime import date


class Command(BaseCommand):
    help = "Seed dummy data to Konveksi Dummy tenant"

    def handle(self, *args, **kwargs):
        from backend.core.models import Tenant
        from backend.masterdata.models import (
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

        self.stdout.write("Mulai import data ke Konveksi Dummy...")

        with transaction.atomic():
            tenant, created = Tenant.objects.get_or_create(
                name="Konveksi Dummy",
            )
            if created:
                self.stdout.write(
                    f"Tenant '{tenant.name}' dibuat dengan ID {tenant.id}"
                )
            else:
                self.stdout.write(
                    f"Tenant '{tenant.name}' ditemukan dengan ID {tenant.id}"
                )

            t_id = tenant.id

            # UOMs
            uom_map = {}
            for code, name, dimension in [
                ("CM", "Centimeter", UOM.Dimension.LENGTH),
                ("GROSS", "Gross", UOM.Dimension.COUNT),
                ("KG", "Kilogram", UOM.Dimension.MASS),
                ("LUSIN", "Lusin", UOM.Dimension.COUNT),
                ("M", "Meter", UOM.Dimension.LENGTH),
                ("PAK", "Pak", UOM.Dimension.COUNT),
                ("PCS", "Pieces", UOM.Dimension.COUNT),
                ("ROLL", "Roll", UOM.Dimension.COUNT),
                ("SET", "Set", UOM.Dimension.COUNT),
                ("YARD", "Yard", UOM.Dimension.LENGTH),
            ]:
                uom, _ = UOM.objects.update_or_create(
                    tenant_id=t_id,
                    code=code,
                    defaults={"name": name, "dimension": dimension},
                )
                uom_map[code] = uom

            # Materials
            materials_data = [
                ("MAT-RJN", "Bahan Kain RJN", "ROLL", "CM", 9144),
                ("MAT-PURING", "Puring Saten Hitam Pekat", "ROLL", "CM", 9144),
                ("MAT-KARET", "Karet Lebar 5cm", "KG", "CM", 2862),
                (
                    "MAT-SLETING-30",
                    "Sleting Coil YKK 30 Inch Hitam",
                    "LUSIN",
                    "SET",
                    12,
                ),
                ("MAT-SLETING-ROLL", "Sleting Roll", "ROLL", "CM", 9144),
                ("MAT-SLETING-KEPALA", "Sleting Kepala YKK", "PAK", "PCS", 100),
                ("MAT-STOPER", "Stoper Botol Sleting", "PAK", "PCS", 500),
                ("MAT-MATA-ITIK", "Mata Itik v20 / 350 Nu Tr", "PAK", "PCS", 1400),
                ("MAT-TALI", "Tali String", "PAK", "CM", 9144),
                ("MAT-BENANG", "Benang Jahit", "PAK", "M", 27432),
                ("MAT-KAPAS", "Kain Kapas", "M", "CM", 100),
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
                        "name": name,
                        "purchase_uom": uom_map[pur_uom],
                        "usage_uom": uom_map[use_uom],
                        "conversion_ratio": conv,
                    },
                )
                mat_map[code] = mat

            # Products
            model, _ = ProductModel.objects.get_or_create(
                tenant_id=t_id, code="REINHARD", defaults={"name": "Jaket Reinhard"}
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
                    defaults={"size": size},
                )
                var_map[sku] = var

            # BOM
            common_bom_items = [
                ("MAT-KARET", 108),
                ("MAT-SLETING-30", 1),
                ("MAT-SLETING-ROLL", 17),
                ("MAT-SLETING-KEPALA", 1),
                ("MAT-STOPER", 2),
                ("MAT-MATA-ITIK", 2),
                ("MAT-TALI", 71),
                ("MAT-KAPAS", 6.3),
                ("MAT-PLASTIK", 1),
                ("MAT-BENANG", 77),
                ("MAT-LBL-SLIP", 1),
                ("MAT-LBL-SATIN", 1),
                ("MAT-LBL-WOVEN", 1),
                ("MAT-LBL-UKURAN", 1),
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
                    defaults={"effective_date": date.today()},
                )
                BOMItem.objects.filter(bom=bom).delete()

                from decimal import Decimal

                for mat_code, qty in bom_variations[sku]:
                    BOMItem.objects.create(
                        tenant_id=t_id,
                        bom=bom,
                        material=mat_map[mat_code],
                        quantity=Decimal(str(qty)),
                    )

                for mat_code, qty in common_bom_items:
                    BOMItem.objects.create(
                        tenant_id=t_id,
                        bom=bom,
                        material=mat_map[mat_code],
                        quantity=Decimal(str(qty)),
                    )

            # Routing
            routing, _ = Routing.objects.get_or_create(
                tenant_id=t_id,
                product_model=model,
                version=1,
                defaults={"effective_date": date.today()},
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
                )
                stage_map[stage_name] = rs

            # Piece Rates
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
                    product_model=model,
                    stage_name=st_name,
                    rate_amount=amount,
                    effective_date=date.today(),
                    change_reason="Initial Data",
                )

            self.stdout.write(
                self.style.SUCCESS(
                    "Import data dummy ke Konveksi Dummy selesai dengan sukses!"
                )
            )
