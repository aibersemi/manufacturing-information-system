import django.db.models.deletion
import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0003_alter_asset_location_alter_customerpayment_reference_and_more"),
        ("inventory", "0006_alter_productledger_unit_cost"),
    ]

    operations = [
        migrations.CreateModel(
            name="SupplierInvoiceLine",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True, verbose_name="Dibuat"),
                ),
                (
                    "updated_at",
                    models.DateTimeField(auto_now=True, verbose_name="Diperbarui"),
                ),
                (
                    "quantity",
                    models.DecimalField(
                        decimal_places=4,
                        max_digits=15,
                        verbose_name="Kuantitas Invoice",
                    ),
                ),
                (
                    "unit_price",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=15,
                        verbose_name="Harga Satuan Invoice",
                    ),
                ),
                (
                    "line_total",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=15,
                        verbose_name="Total Baris",
                    ),
                ),
                (
                    "invoice",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lines",
                        to="finance.supplierinvoice",
                    ),
                ),
                (
                    "purchase_order_line",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="invoice_lines",
                        to="inventory.purchaseorderline",
                    ),
                ),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="core.tenant",
                    ),
                ),
            ],
            options={
                "db_table": "finance_supplier_invoice_line",
            },
        ),
    ]
