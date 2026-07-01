from django.db import migrations


def merge_meter_uom_into_m(apps, schema_editor):
    UOM = apps.get_model("masterdata", "UOM")
    Material = apps.get_model("masterdata", "Material")

    meter_uoms = UOM.objects.filter(code="METER").order_by("tenant_id")
    for meter_uom in meter_uoms.iterator():
        m_uom = UOM.objects.filter(tenant_id=meter_uom.tenant_id, code="M").first()
        if m_uom is None:
            meter_uom.code = "M"
            meter_uom.name = "Meter"
            meter_uom.dimension = "length"
            meter_uom.save(update_fields=["code", "name", "dimension", "updated_at"])
            continue

        changed_fields = []
        if m_uom.name != "Meter":
            m_uom.name = "Meter"
            changed_fields.append("name")
        if m_uom.dimension != "length":
            m_uom.dimension = "length"
            changed_fields.append("dimension")
        if changed_fields:
            changed_fields.append("updated_at")
            m_uom.save(update_fields=changed_fields)

        Material.objects.filter(purchase_uom_id=meter_uom.id).update(
            purchase_uom_id=m_uom.id
        )
        Material.objects.filter(usage_uom_id=meter_uom.id).update(usage_uom_id=m_uom.id)
        meter_uom.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("masterdata", "0004_material_last_purchase_price"),
    ]

    operations = [
        migrations.RunPython(merge_meter_uom_into_m, migrations.RunPython.noop),
    ]
