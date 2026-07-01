"""Acceptance test lintas-domain untuk invariant wajib PRD."""

# Fixture pytest sengaja diinjeksikan melalui nama argumen test.
# pylint: disable=redefined-outer-name,unused-argument

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from backend.accounting.models import AccountingMapping, AccountingPeriod, JournalEntry
from backend.accounting.services import close_period, create_journal, reopen_period
from backend.core.file_services import resolve_business_file, store_business_file
from backend.core.models import FileMetadata, Membership, Tenant, User
from backend.core.services import next_document_number
from backend.finance.models import PaymentRequest
from backend.finance.services import pay_payment_request, submit_payment_request
from backend.inventory.models import MaterialLedger, ProductLedger
from backend.inventory.services import material_balance, record_material_movement
from backend.masterdata.models import (
    BOM,
    UOM,
    BankAccount,
    BOMItem,
    ChartOfAccount,
    Customer,
    Material,
    Operator,
    PieceRate,
    ProductModel,
    ProductVariant,
    Routing,
    RoutingStage,
)
from backend.production.models import (
    JobPacket,
    MaterialConsumption,
    ProductionOrder,
    ReworkOrder,
)
from backend.production.services import (
    complete_production_order,
    complete_rework,
    estimate_hpp,
    recalculate_material_requirements,
    release_production_order,
    submit_stage_progress,
    verify_stage_progress,
)
from backend.sales.models import SalesPO, SalesPOLine


@pytest.fixture()
def tenant_and_users(db):
    tenant = Tenant.objects.create(name="Konveksi Pilot", slug="pilot", code="PLT")
    kepala = User.objects.create_user("kepala-pilot", password="rahasia")
    finance = User.objects.create_user("finance-pilot", password="rahasia")
    super_admin = User.objects.create_user("super-pilot", password="rahasia")
    Membership.objects.create(
        tenant=tenant, user=kepala, role=Membership.Role.KEPALA_KONVEKSI
    )
    Membership.objects.create(tenant=tenant, user=finance, role=Membership.Role.FINANCE)
    Membership.objects.create(
        tenant=tenant, user=super_admin, role=Membership.Role.SUPER_ADMIN
    )
    return tenant, kepala, finance, super_admin


def _material(tenant, *, ratio=Decimal("1"), moq=Decimal("1"), multiple=Decimal("1")):
    usage = UOM.objects.create(
        tenant=tenant,
        code=f"M-{UOM.objects.filter(tenant=tenant).count()}",
        name="Meter",
        dimension=UOM.Dimension.LENGTH,
    )
    purchase = UOM.objects.create(
        tenant=tenant,
        code=f"R-{UOM.objects.filter(tenant=tenant).count()}",
        name="Roll",
        dimension=UOM.Dimension.LENGTH,
    )
    return Material.objects.create(
        tenant=tenant,
        code=f"MAT-{Material.objects.filter(tenant=tenant).count() + 1}",
        name="Kain",
        purchase_uom=purchase,
        usage_uom=usage,
        conversion_ratio=ratio,
        moq=moq,
        purchase_multiple=multiple,
    )


def _product_recipe(tenant, material):
    product = ProductModel.objects.create(tenant=tenant, code="KAOS", name="Kaos")
    variant = ProductVariant.objects.create(
        tenant=tenant,
        product_model=product,
        sku="KAOS-HITAM-M",
        color="Hitam",
        size="M",
    )
    bom = BOM.objects.create(
        tenant=tenant,
        product_variant=variant,
        version=1,
        effective_date=date(2026, 1, 1),
    )
    BOMItem.objects.create(tenant=tenant, bom=bom, material=material, quantity=3)
    routing = Routing.objects.create(
        tenant=tenant,
        product_model=product,
        version=1,
        effective_date=date(2026, 1, 1),
    )
    stage = RoutingStage.objects.create(
        tenant=tenant,
        routing=routing,
        sequence=1,
        stage_name="Jahit",
    )
    return variant, bom, routing, stage


@pytest.mark.django_db
def test_nomor_dokumen_urut_dan_terpisah_per_jenis(tenant_and_users):
    tenant, *_users = tenant_and_users

    first = next_document_number(tenant, "PO", at=date(2026, 6, 1))
    second = next_document_number(tenant, "PO", at=date(2026, 6, 30))
    production = next_document_number(tenant, "PROD", at=date(2026, 6, 1))

    assert first == "PLT/PO/202606/0001"
    assert second == "PLT/PO/202606/0002"
    assert production == "PLT/PROD/202606/0001"


@pytest.mark.django_db
def test_ledger_material_menolak_negatif_dan_idempotent(tenant_and_users):
    tenant, kepala, *_users = tenant_and_users
    material = _material(tenant)
    receipt = record_material_movement(
        tenant=tenant,
        material=material,
        transaction_type=MaterialLedger.TransactionType.RECEIPT,
        quantity=Decimal("10"),
        unit_cost=Decimal("25000"),
        reference_document="RCV-1",
        user=kepala,
        idempotency_key="receipt-1",
    )
    duplicate = record_material_movement(
        tenant=tenant,
        material=material,
        transaction_type=MaterialLedger.TransactionType.RECEIPT,
        quantity=Decimal("10"),
        unit_cost=Decimal("25000"),
        reference_document="RCV-1",
        user=kepala,
        idempotency_key="receipt-1",
    )
    assert duplicate.id == receipt.id
    assert material_balance(tenant, material) == Decimal("10")

    with pytest.raises(ValueError, match="tidak mencukupi"):
        record_material_movement(
            tenant=tenant,
            material=material,
            transaction_type=MaterialLedger.TransactionType.ISSUE,
            quantity=Decimal("11"),
            unit_cost=Decimal("25000"),
            reference_document="PROD-1",
            user=kepala,
            idempotency_key="issue-1",
            reason="Sampel resmi",
        )


@pytest.mark.django_db
def test_mrp_mematuhi_moq_dan_kelipatan_kemasan(tenant_and_users):
    tenant, *_users = tenant_and_users
    material = _material(
        tenant, ratio=Decimal("10"), moq=Decimal("2"), multiple=Decimal("2")
    )
    variant, _bom, _routing, _stage = _product_recipe(tenant, material)
    order = ProductionOrder.objects.create(
        tenant=tenant,
        order_number="PROD-MRP",
        order_type=ProductionOrder.Type.FOR_STOCK,
        product_variant=variant,
        target_quantity=10,
    )

    requirement = recalculate_material_requirements(order)[0]

    assert requirement.required_usage_qty == Decimal("30")
    assert requirement.shortage_usage_qty == Decimal("30")
    assert requirement.recommended_purchase_qty == Decimal("4")
    assert requirement.packaging_excess_usage_qty == Decimal("10")


@pytest.mark.django_db
def test_produksi_mengunci_po_mencatat_progress_dan_hpp_batch(tenant_and_users):
    tenant, kepala, *_users = tenant_and_users
    material = _material(tenant)
    variant, _bom, _routing, stage = _product_recipe(tenant, material)
    customer = Customer.objects.create(tenant=tenant, name="Pelanggan")
    po = SalesPO.objects.create(
        tenant=tenant,
        customer=customer,
        po_number="PO-PILOT",
        order_date=date(2026, 6, 1),
        status=SalesPO.Status.CONFIRMED,
    )
    line = SalesPOLine.objects.create(
        tenant=tenant,
        sales_po=po,
        product_variant=variant,
        quantity=10,
        unit_price=100_000,
    )
    order = ProductionOrder.objects.create(
        tenant=tenant,
        order_number="PROD-PILOT",
        order_type=ProductionOrder.Type.FOR_PO,
        sales_po_line=line,
        product_variant=variant,
        target_quantity=10,
        target_completion_date=date(2026, 6, 30),
    )
    operator_user = User.objects.create_user("operator-pilot", password="rahasia")
    operator = Operator.objects.create(
        tenant=tenant,
        user=operator_user,
        name="Operator Jahit",
        operator_type=Operator.OperatorType.PENJAHIT,
        status=Operator.OperatorStatus.INTERNAL,
    )
    PieceRate.objects.create(
        tenant=tenant,
        operator=operator,
        product_model=variant.product_model,
        stage_name="Jahit",
        rate_amount=5_000,
        effective_date=date(2026, 1, 1),
    )

    release_production_order(order, user=kepala)
    order.refresh_from_db()
    po.refresh_from_db()
    assert order.bom_snapshot["version"] == 1
    assert order.routing_snapshot["version"] == 1
    assert po.is_locked is True

    packet = JobPacket.objects.create(
        tenant=tenant,
        production_order=order,
        packet_number="PKT-1",
        quantity=10,
        current_stage=stage,
        assigned_operator=operator,
    )
    progress = submit_stage_progress(
        packet=packet,
        stage_id=str(stage.id),
        operator_id=str(operator.id),
        qty_in=10,
        qty_good=9,
        qty_defect=1,
        qty_rework=1,
        qty_scrap=0,
        qty_remaining=0,
        defect_type="Jahitan lepas",
        duration_minutes=120,
        user=operator_user,
    )
    verify_stage_progress(progress, user=kepala)
    complete_rework(
        ReworkOrder.objects.get(source_progress=progress),
        result_good=1,
        result_scrap=0,
        user=kepala,
    )
    MaterialConsumption.objects.create(
        tenant=tenant,
        production_order=order,
        material=material,
        quantity=Decimal("30"),
        unit_cost=Decimal("20000"),
        inventory_reference="ISSUE-1",
    )
    order.refresh_from_db()
    completed, batch, hpp = complete_production_order(
        order, output_quantity=9, lot_number="LOT-PILOT", user=kepala
    )

    assert completed.status == ProductionOrder.Status.COMPLETED
    assert batch.unit_cost == hpp.unit_cost
    assert Decimal(hpp.components["material"]) == Decimal("600000")
    assert Decimal(hpp.components["labor"]) == Decimal("45000")
    assert ProductLedger.objects.filter(batch=batch).exists()


@pytest.mark.django_db
def test_periode_tertutup_menolak_jurnal_dan_hanya_superadmin_membuka(
    tenant_and_users,
):
    tenant, _kepala, finance, super_admin = tenant_and_users
    cash = ChartOfAccount.objects.create(
        tenant=tenant,
        code="1000",
        name="Kas",
        account_type=ChartOfAccount.AccountType.ASSET,
    )
    equity = ChartOfAccount.objects.create(
        tenant=tenant,
        code="3000",
        name="Modal",
        account_type=ChartOfAccount.AccountType.EQUITY,
    )
    period = AccountingPeriod.objects.create(
        tenant=tenant,
        name="Juni 2026",
        start_date=date(2026, 6, 1),
        end_date=date(2026, 6, 30),
    )
    create_journal(
        tenant=tenant,
        journal_date=date(2026, 6, 21),
        description="Modal",
        lines=[
            {"account_id": cash.id, "debit": 1_000_000, "credit": 0},
            {"account_id": equity.id, "debit": 0, "credit": 1_000_000},
        ],
        user=finance,
        final=True,
    )
    close_period(period, user=finance)
    with pytest.raises(ValueError, match="ditutup"):
        create_journal(
            tenant=tenant,
            journal_date=date(2026, 6, 22),
            description="Ditolak",
            lines=[
                {"account_id": cash.id, "debit": 1, "credit": 0},
                {"account_id": equity.id, "debit": 0, "credit": 1},
            ],
            user=finance,
            final=True,
        )
    with pytest.raises(PermissionError):
        reopen_period(period, user=finance, reason="Koreksi")
    reopened = reopen_period(period, user=super_admin, reason="Koreksi sah")
    assert reopened.status == AccountingPeriod.Status.REOPENED


@pytest.mark.django_db
def test_pembayaran_membuat_jurnal_final_dan_audit(tenant_and_users):
    tenant, kepala, finance, _super_admin = tenant_and_users
    cash = ChartOfAccount.objects.create(
        tenant=tenant,
        code="1010",
        name="Bank",
        account_type=ChartOfAccount.AccountType.ASSET,
    )
    expense = ChartOfAccount.objects.create(
        tenant=tenant,
        code="5200",
        name="Beban",
        account_type=ChartOfAccount.AccountType.EXPENSE,
    )
    AccountingMapping.objects.create(
        tenant=tenant,
        event_type="payment.supplier",
        debit_account=expense,
        credit_account=cash,
    )
    AccountingPeriod.objects.create(
        tenant=tenant,
        name="Periode Aktif",
        start_date=timezone.localdate() - timedelta(days=5),
        end_date=timezone.localdate() + timedelta(days=5),
    )
    account = BankAccount.objects.create(
        tenant=tenant, name="Bank Utama", chart_account=cash
    )
    proof = FileMetadata.objects.create(
        tenant=tenant,
        uploaded_by=finance,
        category="payments",
        original_filename="bukti.pdf",
        stored_path="pilot/payments/bukti.pdf",
        content_type="application/pdf",
        size_bytes=10,
    )
    payment_request = submit_payment_request(
        tenant=tenant,
        user=kepala,
        request_type="supplier",
        source_type="PurchaseOrder",
        source_id="PUR-1",
        amount=Decimal("500000"),
        recipient="Pemasok",
    )

    paid = pay_payment_request(
        payment_request,
        user=finance,
        account=account,
        payment_date=timezone.localdate(),
        payment_method="transfer",
        proof_id=str(proof.id),
    )

    assert paid.status == PaymentRequest.Status.PAID
    assert JournalEntry.objects.filter(
        tenant=tenant,
        source_type="PaymentRequest",
        source_id=str(payment_request.id),
        status=JournalEntry.Status.POSTED,
    ).exists()


@pytest.mark.django_db
def test_file_privat_divalidasi_dan_disimpan_di_scope_tenant(
    tenant_and_users, tmp_path, settings
):
    tenant, kepala, *_users = tenant_and_users
    settings.MEDIA_ROOT = tmp_path
    uploaded = SimpleUploadedFile(
        "nota.pdf", b"dokumen", content_type="application/pdf"
    )

    metadata = store_business_file(
        tenant=tenant,
        user=kepala,
        uploaded_file=uploaded,
        category="receipts",
        resource_type="PurchaseOrder",
        resource_id="PUR-1",
    )

    path = resolve_business_file(metadata)
    assert path.read_bytes() == b"dokumen"
    assert path.is_relative_to(tmp_path / tenant.slug)
    with pytest.raises(ValueError, match="Ekstensi"):
        store_business_file(
            tenant=tenant,
            user=kepala,
            uploaded_file=SimpleUploadedFile(
                "malware.exe", b"x", content_type="application/octet-stream"
            ),
            category="receipts",
        )


@pytest.mark.django_db
def test_hpp_estimasi_menyimpan_versi_sumber_dan_harga_rekomendasi(
    tenant_and_users,
):
    tenant, kepala, *_users = tenant_and_users
    material = _material(tenant)
    variant, bom, routing, _stage = _product_recipe(tenant, material)
    record_material_movement(
        tenant=tenant,
        material=material,
        transaction_type=MaterialLedger.TransactionType.RECEIPT,
        quantity=Decimal("100"),
        unit_cost=Decimal("20000"),
        reference_document="OPENING-HPP",
        idempotency_key="opening-hpp",
        user=kepala,
    )

    snapshot = estimate_hpp(
        tenant=tenant,
        product_variant=variant,
        quantity=Decimal("10"),
        user=kepala,
    )

    assert snapshot.source_versions == {"bom": bom.version, "routing": routing.version}
    assert snapshot.cost_type == snapshot.CostType.ESTIMATED
    assert snapshot.recommended_price >= snapshot.unit_cost
