from django.db import migrations


DEFAULT_UOMS = {
    "CM": ("Centimeter", "length"),
    "GROSS": ("Gross", "count"),
    "KG": ("Kilogram", "mass"),
    "LUSIN": ("Lusin", "count"),
    "M": ("Meter", "length"),
    "PAK": ("Pak", "count"),
    "PCS": ("Pieces", "count"),
    "ROLL": ("Roll", "count"),
    "SET": ("Set", "count"),
    "YARD": ("Yard", "length"),
}


def update_default_uom_dimensions(apps, schema_editor):
    Tenant = apps.get_model("core", "Tenant")
    UOM = apps.get_model("masterdata", "UOM")

    for tenant in Tenant.objects.iterator():
        for code, (name, dimension) in DEFAULT_UOMS.items():
            UOM.objects.update_or_create(
                tenant_id=tenant.id,
                code=code,
                defaults={"name": name, "dimension": dimension},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0004_filemetadata_resource_id_filemetadata_resource_type_and_more"),
        ("masterdata", "0005_merge_meter_uom_into_m"),
    ]

    operations = [
        migrations.RunPython(
            update_default_uom_dimensions,
            migrations.RunPython.noop,
        ),
    ]
