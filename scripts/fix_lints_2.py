def replace_in_file(filename, replacements):
    with open(filename, "r") as f:
        content = f.read()
    for old, new in replacements:
        content = content.replace(old, new)
    with open(filename, "w") as f:
        f.write(content)


replace_in_file(
    "backend/core/management/commands/seed_dummy_konveksi.py",
    [
        (
            "u_created, created = User.objects.get_or_create(",
            "_, created = User.objects.get_or_create(",
        ),
    ],
)

replace_in_file(
    "backend/core/management/commands/seed_dummy_business_data.py",
    [
        ("except Exception as e:", "except Exception as exc:"),
        (
            "raise CommandError(f\"Tenant dengan slug '{tenant_slug}' tidak ditemukan. Jalankan seed_dummy_konveksi terlebih dahulu.\")",
            "raise CommandError(f\"Tenant dengan slug '{tenant_slug}' tidak ditemukan. Jalankan seed_dummy_konveksi terlebih dahulu.\") from exc",
        ),
        (
            "raise CommandError(f'Gagal memuat user/operator dasar: {e}')",
            "raise CommandError(f'Gagal memuat user/operator dasar: {exc}') from exc",
        ),
        (
            "except (UOM.DoesNotExist, ChartOfAccount.DoesNotExist, BankAccount.DoesNotExist):",
            "except (UOM.DoesNotExist, ChartOfAccount.DoesNotExist, BankAccount.DoesNotExist) as exc:",
        ),
        (
            "raise CommandError('Data referensi UOM/COA belum bootstrap dengan benar.')",
            "raise CommandError('Data referensi UOM/COA belum bootstrap dengan benar.') from exc",
        ),
        ("cc_meal = CostCenter", "_cc_meal = CostCenter"),
        ("cc_trans = CostCenter", "_cc_trans = CostCenter"),
        ("pr2, _ = PurchaseRequisition", "_pr2, _ = PurchaseRequisition"),
        ("spo2_l2 = ", "_spo2_l2 = "),
    ],
)
