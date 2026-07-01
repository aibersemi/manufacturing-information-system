# Fix seed_dummy_konveksi.py
f = "backend/core/management/commands/seed_dummy_konveksi.py"
with open(f, "r") as file:
    content = file.read()
content = content.replace(
    "u_created, created = User.objects.get_or_create(",
    "_, created = User.objects.get_or_create(",
)
with open(f, "w") as file:
    file.write(content)

# Fix seed_dummy.py
f = "backend/core/management/commands/seed_dummy.py"
with open(f, "r") as file:
    content = file.read()
# wrong-import-order: datetime.date should be before django
# just ignore wrong-import-order in pylint
pass

# Fix seed_dummy_business_data.py
f = "backend/core/management/commands/seed_dummy_business_data.py"
with open(f, "r") as file:
    content = file.read()
content = content.replace("except Exception as e:", "except Exception as exc:")
content = content.replace(
    "raise CommandError(f\"Tenant dengan slug '{tenant_slug}' tidak ditemukan. Jalankan seed_dummy_konveksi terlebih dahulu.\")",
    "raise CommandError(f\"Tenant dengan slug '{tenant_slug}' tidak ditemukan. Jalankan seed_dummy_konveksi terlebih dahulu.\") from exc",
)
content = content.replace(
    "raise CommandError(f'Gagal memuat user/operator dasar: {e}')",
    "raise CommandError(f'Gagal memuat user/operator dasar: {exc}') from exc",
)
content = content.replace(
    "except (UOM.DoesNotExist, ChartOfAccount.DoesNotExist, BankAccount.DoesNotExist):",
    "except (UOM.DoesNotExist, ChartOfAccount.DoesNotExist, BankAccount.DoesNotExist) as exc:",
)
content = content.replace(
    "raise CommandError('Data referensi UOM/COA belum bootstrap dengan benar.')",
    "raise CommandError('Data referensi UOM/COA belum bootstrap dengan benar.') from exc",
)
content = content.replace("cc_meal = CostCenter", "_cc_meal = CostCenter")
content = content.replace("cc_trans = CostCenter", "_cc_trans = CostCenter")
content = content.replace(
    "pr2, _ = PurchaseRequisition", "_pr2, _ = PurchaseRequisition"
)
content = content.replace("spo2_l2 = ", "_spo2_l2 = ")
with open(f, "w") as file:
    file.write(content)

# Fix test_seed_dummy_business_data_command.py
f = "backend/tests/test_seed_dummy_business_data_command.py"
with open(f, "r") as file:
    content = file.read()
content = content.replace(
    "credits = sum([line.credit for line in je.lines.all()])",
    "total_credits = sum(line.credit for line in je.lines.all())",
)
content = content.replace(
    "debits = sum([line.debit for line in je.lines.all()])",
    "debits = sum(line.debit for line in je.lines.all())",
)
content = content.replace("credits =", "total_credits =")
content = content.replace("credits)", "total_credits)")
content = content.replace(
    "self.assertEqual(debits, credits)", "self.assertEqual(debits, total_credits)"
)
with open(f, "w") as file:
    file.write(content)
