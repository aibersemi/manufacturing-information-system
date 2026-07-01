from django.db import migrations, models


def dedupe_piece_rate_versions(apps, _schema_editor):
    PieceRate = apps.get_model("masterdata", "PieceRate")
    seen = set()
    duplicate_ids = []
    for rate in (
        PieceRate.objects.order_by(
            "tenant_id",
            "product_model_id",
            "stage_name",
            "effective_date",
            "operator_id",
            "location",
            "operator_status",
            "-updated_at",
            "-created_at",
            "id",
        )
        .values(
            "id",
            "tenant_id",
            "product_model_id",
            "stage_name",
            "effective_date",
            "operator_id",
            "location",
            "operator_status",
        )
        .iterator()
    ):
        key = (
            rate["tenant_id"],
            rate["product_model_id"],
            rate["stage_name"],
            rate["effective_date"],
            rate["operator_id"],
            rate["location"],
            rate["operator_status"],
        )
        if key in seen:
            duplicate_ids.append(rate["id"])
            continue
        seen.add(key)

    if duplicate_ids:
        PieceRate.objects.filter(id__in=duplicate_ids).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("masterdata", "0007_standardize_product_sku"),
    ]

    operations = [
        migrations.RunPython(dedupe_piece_rate_versions, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="piecerate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("operator__isnull", True)),
                fields=(
                    "tenant",
                    "product_model",
                    "stage_name",
                    "effective_date",
                    "location",
                    "operator_status",
                ),
                name="uniq_piece_rate_default_version",
            ),
        ),
        migrations.AddConstraint(
            model_name="piecerate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("operator__isnull", False)),
                fields=(
                    "tenant",
                    "product_model",
                    "stage_name",
                    "effective_date",
                    "operator",
                    "location",
                    "operator_status",
                ),
                name="uniq_piece_rate_operator_version",
            ),
        ),
    ]
