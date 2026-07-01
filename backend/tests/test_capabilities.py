from datetime import date

import pytest
from django.core.management import call_command
from django.test import Client

from backend.core.models import Membership, Tenant, User
from backend.finance.models import PettyCashTransaction
from backend.masterdata.models import (
    Operator,
    ProductModel,
    ProductVariant,
    Routing,
    RoutingStage,
)
from backend.production.models import (
    JobPacket,
    ProductionOrder,
    ProductionStageProgress,
    ReworkOrder,
)
from backend.tests.test_seed_dummy_konveksi_command import set_dummy_env


@pytest.fixture()
def dummy_tenant(monkeypatch):
    set_dummy_env(monkeypatch)
    call_command("seed_dummy_konveksi")
    return Tenant.objects.get(slug="dummy-konveksi")


def _login(client: Client, username: str, tenant_slug: str, password: str = "pass123"):
    response = client.post(
        "/api/auth/login",
        {
            "username": username,
            "password": password,
            "tenant_slug": tenant_slug,
        },
        content_type="application/json",
    )
    assert response.status_code == 200


def _capabilities_for(username: str, tenant_slug: str = "dummy-konveksi") -> dict:
    client = Client()
    _login(client, username, tenant_slug)
    response = client.get("/api/auth/capabilities")
    assert response.status_code == 200
    data = response.json()
    assert data["capabilities"] == sorted(data["capabilities"])
    return data


@pytest.mark.django_db
def test_capabilities_requires_authenticated_session():
    response = Client().get("/api/auth/capabilities")

    assert response.status_code == 401


@pytest.mark.django_db
def test_capabilities_superuser_effective_role_without_membership():
    Tenant.objects.create(name="Konveksi A", slug="konveksi-a", code="KA")
    User.objects.create_superuser(username="root", password="pass123")

    client = Client()
    _login(client, "root", "konveksi-a")
    response = client.get("/api/auth/capabilities")

    assert response.status_code == 200
    data = response.json()
    assert data["role"] == Membership.Role.SUPER_ADMIN
    assert data["operator"] is None
    assert {
        "dashboard.system",
        "settings.tenants.delete",
        "accounting.journals.create",
        "sales.orders.delete",
        "masterdata.materials.delete",
        "masterdata.uoms.delete",
        "masterdata.products.delete",
        "masterdata.product_variants.delete",
        "masterdata.boms.delete",
        "masterdata.routings.delete",
        "masterdata.piece_rates.delete",
    }.issubset(set(data["capabilities"]))


@pytest.mark.django_db
def test_capabilities_operator_without_active_profile_gets_minimal_operator_ui():
    tenant = Tenant.objects.create(name="Konveksi O", slug="konveksi-o", code="KO")
    user = User.objects.create_user(username="operator-kosong", password="pass123")
    Membership.objects.create(user=user, tenant=tenant, role=Membership.Role.OPERATOR)

    client = Client()
    _login(client, user.username, tenant.slug)
    response = client.get("/api/auth/capabilities")

    assert response.status_code == 200
    data = response.json()
    assert data["role"] == Membership.Role.OPERATOR
    assert data["operator"] is None
    assert "auth.change_password" in data["capabilities"]
    assert "dashboard.operator" in data["capabilities"]
    assert "labor.attendance.self" not in data["capabilities"]
    assert "production.progress.submit.assigned" not in data["capabilities"]


@pytest.mark.django_db
def test_dummy_konveksi_capabilities_per_role_and_operator(dummy_tenant):
    kepala = _capabilities_for("kepala")
    finance = _capabilities_for("finance")
    potong = _capabilities_for("potong")
    jahit1 = _capabilities_for("jahit1")
    jahit2 = _capabilities_for("jahit2")
    dapur = _capabilities_for("dapur")
    gudang = _capabilities_for("gudang")

    assert kepala["role"] == Membership.Role.KEPALA_KONVEKSI
    assert "dashboard.operational" in kepala["capabilities"]
    assert "settings.operators.create" in kepala["capabilities"]
    assert "settings.operators.delete" not in kepala["capabilities"]
    assert "masterdata.materials.read" in kepala["capabilities"]
    assert "masterdata.materials.create" in kepala["capabilities"]
    assert "masterdata.materials.update" in kepala["capabilities"]
    assert "masterdata.materials.delete" not in kepala["capabilities"]
    assert "masterdata.uoms.read" in kepala["capabilities"]
    assert "masterdata.uoms.create" in kepala["capabilities"]
    assert "masterdata.uoms.update" in kepala["capabilities"]
    assert "masterdata.uoms.delete" not in kepala["capabilities"]
    assert "masterdata.products.read" in kepala["capabilities"]
    assert "masterdata.products.create" in kepala["capabilities"]
    assert "masterdata.products.update" in kepala["capabilities"]
    assert "masterdata.products.delete" not in kepala["capabilities"]
    assert "masterdata.product_variants.read" in kepala["capabilities"]
    assert "masterdata.product_variants.create" in kepala["capabilities"]
    assert "masterdata.product_variants.update" in kepala["capabilities"]
    assert "masterdata.product_variants.delete" not in kepala["capabilities"]
    assert "masterdata.boms.read" in kepala["capabilities"]
    assert "masterdata.boms.create" in kepala["capabilities"]
    assert "masterdata.boms.update" in kepala["capabilities"]
    assert "masterdata.boms.delete" not in kepala["capabilities"]
    assert "masterdata.routings.read" in kepala["capabilities"]
    assert "masterdata.routings.create" in kepala["capabilities"]
    assert "masterdata.routings.update" in kepala["capabilities"]
    assert "masterdata.routings.delete" not in kepala["capabilities"]
    assert "masterdata.piece_rates.read" in kepala["capabilities"]
    assert "masterdata.piece_rates.create" in kepala["capabilities"]
    assert "masterdata.piece_rates.update" in kepala["capabilities"]
    assert "masterdata.piece_rates.delete" not in kepala["capabilities"]
    assert "sales.orders.create" in kepala["capabilities"]
    assert "sales.orders.update" in kepala["capabilities"]
    assert "sales.orders.delete" not in kepala["capabilities"]
    assert "finance.petty_cash.create" in kepala["capabilities"]
    assert "finance.petty_cash.verify" in kepala["capabilities"]
    assert "finance.payment_requests.create" in kepala["capabilities"]
    assert "finance.payment_requests.pay" not in kepala["capabilities"]
    assert "accounting.journals.create" not in kepala["capabilities"]
    assert "finance.assets.read" not in kepala["capabilities"]

    assert finance["role"] == Membership.Role.FINANCE
    assert "tenant.switch" in finance["capabilities"]
    assert "dashboard.finance" in finance["capabilities"]
    assert "accounting.journals.create" in finance["capabilities"]
    assert "finance.assets.create" in finance["capabilities"]
    assert "finance.assets.deactivate" in finance["capabilities"]
    assert "masterdata.bank_accounts.delete" in finance["capabilities"]
    assert "sales.orders.read" in finance["capabilities"]
    assert "sales.orders.create" not in finance["capabilities"]
    assert "production.orders.read" in finance["capabilities"]
    assert "production.orders.update" not in finance["capabilities"]
    assert "settings.operators.read" not in finance["capabilities"]

    assert potong["operator"]["operator_type"] == Operator.OperatorType.POTONG
    assert potong["operator"]["status"] == Operator.OperatorStatus.INTERNAL
    assert "production.progress.submit.assigned" in potong["capabilities"]
    assert "labor.attendance.self" in potong["capabilities"]
    assert "labor.cash_advance.self" in potong["capabilities"]

    assert jahit1["operator"]["operator_type"] == Operator.OperatorType.PENJAHIT
    assert "production.progress.submit.assigned" in jahit1["capabilities"]

    assert jahit2["operator"]["status"] == Operator.OperatorStatus.EXTERNAL
    assert "production.progress.submit.assigned" in jahit2["capabilities"]
    assert "labor.attendance.self" not in jahit2["capabilities"]
    assert "labor.cash_advance.self" not in jahit2["capabilities"]

    assert "finance.petty_cash.dapur_draft" in dapur["capabilities"]
    assert "production.progress.submit.assigned" not in dapur["capabilities"]

    assert gudang["operator"]["operator_type"] == Operator.OperatorType.GUDANG
    assert "production.job_packets.assigned.read" in gudang["capabilities"]


@pytest.mark.django_db
def test_operator_cannot_access_global_business_modules(dummy_tenant):
    client = Client()
    _login(client, "potong", dummy_tenant.slug)

    for path in [
        "/api/sales/orders",
        "/api/inventory/material-ledger",
        "/api/accounting/journals",
        "/api/masterdata/customers",
    ]:
        response = client.get(path)
        assert response.status_code == 403


@pytest.mark.django_db
def test_dapur_can_create_out_petty_cash_draft_but_other_operator_cannot(dummy_tenant):
    dapur_client = Client()
    _login(dapur_client, "dapur", dummy_tenant.slug)

    out_response = dapur_client.post(
        "/api/finance/petty-cash",
        {
            "date": "2026-06-21",
            "type": "out",
            "amount": "75000.00",
            "category": "Dapur",
            "description": "Konsumsi lembur",
            "pic": "Dapur",
        },
        content_type="application/json",
    )
    assert out_response.status_code == 200
    tx = PettyCashTransaction.objects.get(id=out_response.json()["id"])
    assert tx.status == PettyCashTransaction.Status.DRAFT

    in_response = dapur_client.post(
        "/api/finance/petty-cash",
        {
            "date": "2026-06-21",
            "type": "in",
            "amount": "75000.00",
            "category": "Dapur",
        },
        content_type="application/json",
    )
    assert in_response.status_code == 403

    potong_client = Client()
    _login(potong_client, "potong", dummy_tenant.slug)
    response = potong_client.post(
        "/api/finance/petty-cash",
        {
            "date": "2026-06-21",
            "type": "out",
            "amount": "75000.00",
            "category": "Dapur",
        },
        content_type="application/json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_external_operator_cannot_submit_attendance_or_cash_advance(dummy_tenant):
    external_operator = Operator.objects.get(
        tenant=dummy_tenant, user__username="jahit2"
    )
    client = Client()
    _login(client, "jahit2", dummy_tenant.slug)

    attendance_response = client.post(
        "/api/labor/attendance",
        {
            "operator_id": str(external_operator.id),
            "date": "2026-06-21",
            "is_present": True,
        },
        content_type="application/json",
    )
    assert attendance_response.status_code == 403

    cash_advance_response = client.post(
        "/api/labor/cash-advance",
        {
            "operator_id": str(external_operator.id),
            "date": "2026-06-21",
            "amount": "100000.00",
            "notes": "Kasbon",
        },
        content_type="application/json",
    )
    assert cash_advance_response.status_code == 403


@pytest.mark.django_db
def test_operator_progress_requires_assignment_and_matching_stage():
    tenant = Tenant.objects.create(name="Konveksi P", slug="konveksi-p", code="KP")
    user = User.objects.create_user(username="op-potong", password="pass123")
    other_user = User.objects.create_user(username="op-jahit", password="pass123")
    Membership.objects.create(user=user, tenant=tenant, role=Membership.Role.OPERATOR)

    potong = Operator.objects.create(
        tenant=tenant,
        user=user,
        name="Operator Potong",
        operator_type=Operator.OperatorType.POTONG,
        status=Operator.OperatorStatus.INTERNAL,
    )
    other_operator = Operator.objects.create(
        tenant=tenant,
        user=other_user,
        name="Operator Jahit",
        operator_type=Operator.OperatorType.PENJAHIT,
        status=Operator.OperatorStatus.INTERNAL,
    )
    product_model = ProductModel.objects.create(
        tenant=tenant, code="PM_1", name="Kemeja"
    )
    product_variant = ProductVariant.objects.create(
        tenant=tenant, product_model=product_model, size="1"
    )
    routing = Routing.objects.create(
        tenant=tenant,
        product_model=product_model,
        version=1,
        effective_date=date(2026, 1, 1),
    )
    potong_stage = RoutingStage.objects.create(
        tenant=tenant,
        routing=routing,
        sequence=1,
        stage_name="Potong",
    )
    jahit_stage = RoutingStage.objects.create(
        tenant=tenant,
        routing=routing,
        sequence=2,
        stage_name="Jahit",
    )
    order = ProductionOrder.objects.create(
        tenant=tenant,
        order_number="SPK-1",
        order_type=ProductionOrder.Type.FOR_STOCK,
        product_variant=product_variant,
        target_quantity=30,
    )
    own_packet = JobPacket.objects.create(
        tenant=tenant,
        production_order=order,
        packet_number="JP-1",
        quantity=10,
        current_stage=potong_stage,
        assigned_operator=potong,
    )
    other_packet = JobPacket.objects.create(
        tenant=tenant,
        production_order=order,
        packet_number="JP-2",
        quantity=10,
        current_stage=potong_stage,
        assigned_operator=other_operator,
    )
    wrong_stage_packet = JobPacket.objects.create(
        tenant=tenant,
        production_order=order,
        packet_number="JP-3",
        quantity=10,
        current_stage=jahit_stage,
        assigned_operator=potong,
    )

    client = Client()
    _login(client, user.username, tenant.slug)

    list_response = client.get("/api/production/job-packets")
    assert list_response.status_code == 200
    packet_ids = {item["id"] for item in list_response.json()}
    assert str(own_packet.id) in packet_ids
    assert str(wrong_stage_packet.id) in packet_ids
    assert str(other_packet.id) not in packet_ids

    progress_response = client.post(
        "/api/production/progress",
        {
            "job_packet_id": str(own_packet.id),
            "stage_id": str(potong_stage.id),
            "operator_id": str(other_operator.id),
            "qty_in": 10,
            "qty_good": 8,
            "qty_defect": 2,
            "qty_rework": 1,
            "qty_scrap": 0,
            "qty_remaining": 0,
            "defect_type": "Jahitan ulang",
            "duration_minutes": 45,
        },
        content_type="application/json",
    )
    assert progress_response.status_code == 200
    data = progress_response.json()
    assert data["operator_id"] == str(potong.id)
    progress = ProductionStageProgress.objects.get(id=data["id"])
    assert progress.operator_id == potong.id

    rework = ReworkOrder.objects.get(source_progress=progress)
    complete_response = client.post(
        f"/api/production/rework/{rework.id}/complete",
        {"result_good": 1, "result_scrap": 0},
        content_type="application/json",
    )
    assert complete_response.status_code == 200

    other_rework = ReworkOrder.objects.create(
        tenant=tenant,
        source_progress=progress,
        target_stage=potong_stage,
        operator=other_operator,
        quantity=1,
    )
    denied_rework_response = client.post(
        f"/api/production/rework/{other_rework.id}/complete",
        {"result_good": 1, "result_scrap": 0},
        content_type="application/json",
    )
    assert denied_rework_response.status_code == 403

    wrong_stage_response = client.post(
        "/api/production/progress",
        {
            "job_packet_id": str(wrong_stage_packet.id),
            "stage_id": str(jahit_stage.id),
            "operator_id": str(potong.id),
            "qty_in": 5,
            "qty_good": 5,
            "qty_defect": 0,
            "qty_rework": 0,
            "qty_scrap": 0,
            "qty_remaining": 0,
        },
        content_type="application/json",
    )
    assert wrong_stage_response.status_code == 403

    unassigned_response = client.post(
        "/api/production/progress",
        {
            "job_packet_id": str(other_packet.id),
            "stage_id": str(potong_stage.id),
            "operator_id": str(potong.id),
            "qty_in": 5,
            "qty_good": 5,
            "qty_defect": 0,
            "qty_rework": 0,
            "qty_scrap": 0,
            "qty_remaining": 0,
        },
        content_type="application/json",
    )
    assert unassigned_response.status_code == 403
