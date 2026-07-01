import decimal

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("masterdata", "0003_require_operator_user"),
    ]

    operations = [
        migrations.AddField(
            model_name="material",
            name="last_purchase_price",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=15,
                null=True,
                validators=[django.core.validators.MinValueValidator(decimal.Decimal("0"))],
                verbose_name="Harga Beli Terakhir",
            ),
        ),
    ]
