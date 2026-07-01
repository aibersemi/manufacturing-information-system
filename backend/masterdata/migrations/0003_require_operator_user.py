import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def ensure_no_operator_without_user(apps, schema_editor):
    operator = apps.get_model("masterdata", "Operator")
    count = operator.objects.filter(user__isnull=True).count()
    if count:
        raise RuntimeError(
            f"Terdapat {count} operator tanpa akun. Tautkan akun sebelum migrasi."
        )


class Migration(migrations.Migration):
    dependencies = [
        ("masterdata", "0002_bankaccount_costcategory_customeraddress_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(
            ensure_no_operator_without_user, migrations.RunPython.noop
        ),
        migrations.AlterField(
            model_name="operator",
            name="user",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="operator_profiles",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
