"""Bootstrap master data minimum untuk tenant baru."""

from datetime import date, timedelta

from django.db import transaction

from backend.accounting.models import AccountingMapping, AccountingPeriod
from backend.core.models import BusinessPolicy, Tenant
from backend.inventory.models import Warehouse
from backend.masterdata.models import UOM, BankAccount, ChartOfAccount

DEFAULT_UOMS = [
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
]

DEFAULT_COA = [
    ("1000", "Kas", ChartOfAccount.AccountType.ASSET),
    ("1010", "Bank", ChartOfAccount.AccountType.ASSET),
    ("1100", "Piutang Usaha", ChartOfAccount.AccountType.ASSET),
    ("1200", "Persediaan Material", ChartOfAccount.AccountType.ASSET),
    ("1210", "Persediaan WIP", ChartOfAccount.AccountType.ASSET),
    ("1220", "Persediaan Produk Jadi", ChartOfAccount.AccountType.ASSET),
    ("1500", "Aset Tetap", ChartOfAccount.AccountType.ASSET),
    ("1590", "Akumulasi Penyusutan", ChartOfAccount.AccountType.ASSET),
    ("2000", "Utang Usaha", ChartOfAccount.AccountType.LIABILITY),
    ("2100", "Utang Dana Talangan", ChartOfAccount.AccountType.LIABILITY),
    ("2200", "Uang Muka Pelanggan", ChartOfAccount.AccountType.LIABILITY),
    ("3000", "Modal", ChartOfAccount.AccountType.EQUITY),
    ("4000", "Penjualan", ChartOfAccount.AccountType.REVENUE),
    ("5000", "Harga Pokok Penjualan", ChartOfAccount.AccountType.EXPENSE),
    ("5100", "Biaya Tenaga Kerja", ChartOfAccount.AccountType.EXPENSE),
    ("5200", "Biaya Overhead", ChartOfAccount.AccountType.EXPENSE),
    ("5300", "Biaya Penyusutan", ChartOfAccount.AccountType.EXPENSE),
]

DEFAULT_ACCOUNTING_MAPPINGS = {
    "payment.supplier": ("1200", "1010"),
    "payment.operator": ("5100", "1010"),
    "payment.outsource": ("5100", "1010"),
    "payment.asset": ("1500", "1010"),
    "payment.expense": ("5200", "1010"),
    "customer_payment.received": ("1010", "1100"),
    "depreciation.posted": ("5300", "1590"),
    "asset.disposal": ("1010", "1500"),
    "production.completed": ("1220", "1210"),
    "delivery.cogs": ("5000", "1220"),
    "invoice.issued": ("1100", "4000"),
    "return.adjustment": ("4000", "1100"),
    "petty_cash.out": ("5200", "1000"),
    "petty_cash.in": ("1000", "1010"),
}


@transaction.atomic
def bootstrap_tenant(tenant: Tenant) -> None:
    if not tenant.code:
        Tenant.objects.filter(pk=tenant.pk).update(code=tenant.slug.upper()[:12])
        tenant.code = tenant.slug.upper()[:12]
    BusinessPolicy.objects.get_or_create(tenant=tenant)
    Warehouse.objects.get_or_create(
        tenant=tenant, defaults={"name": "Gudang Utama", "code": "WH"}
    )
    for code, name, dimension in DEFAULT_UOMS:
        UOM.objects.get_or_create(
            tenant=tenant,
            code=code,
            defaults={"name": name, "dimension": dimension},
        )
    for code, name, account_type in DEFAULT_COA:
        ChartOfAccount.objects.get_or_create(
            tenant=tenant,
            code=code,
            defaults={"name": name, "account_type": account_type},
        )
    accounts = {
        account.code: account
        for account in ChartOfAccount.objects.filter(tenant=tenant)
    }
    BankAccount.objects.get_or_create(
        tenant=tenant,
        name="Bank Utama",
        defaults={"chart_account": accounts["1010"]},
    )
    BankAccount.objects.get_or_create(
        tenant=tenant,
        name="Kas Kecil",
        defaults={
            "chart_account": accounts["1000"],
            "is_cash": True,
            "is_petty_cash": True,
        },
    )
    for event_type, (debit_code, credit_code) in DEFAULT_ACCOUNTING_MAPPINGS.items():
        AccountingMapping.objects.get_or_create(
            tenant=tenant,
            event_type=event_type,
            defaults={
                "debit_account": accounts[debit_code],
                "credit_account": accounts[credit_code],
            },
        )
    today = date.today()
    month_start = today.replace(day=1)
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    AccountingPeriod.objects.get_or_create(
        tenant=tenant,
        start_date=month_start,
        end_date=next_month - timedelta(days=1),
        defaults={"name": today.strftime("%B %Y")},
    )
