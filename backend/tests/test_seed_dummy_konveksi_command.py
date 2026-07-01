import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError

from backend.core.models import Membership, Tenant
from backend.masterdata.models import Operator

User = get_user_model()


def set_dummy_env(monkeypatch):
    monkeypatch.setenv("DUMMY_TENANT_NAME", "Dummy Konveksi")
    monkeypatch.setenv("DUMMY_TENANT_SLUG", "dummy-konveksi")
    monkeypatch.setenv("DUMMY_TENANT_CODE", "DUMMY")

    monkeypatch.setenv("DUMMY_KEPALA_USERNAME", "kepala")
    monkeypatch.setenv("DUMMY_KEPALA_PASSWORD", "pass123")
    monkeypatch.setenv("DUMMY_KEPALA_FIRST_NAME", "Kepala")
    monkeypatch.setenv("DUMMY_KEPALA_LAST_NAME", "Dummy")

    monkeypatch.setenv("DUMMY_FINANCE_USERNAME", "finance")
    monkeypatch.setenv("DUMMY_FINANCE_PASSWORD", "pass123")
    monkeypatch.setenv("DUMMY_FINANCE_FIRST_NAME", "Finance")
    monkeypatch.setenv("DUMMY_FINANCE_LAST_NAME", "Dummy")

    monkeypatch.setenv("DUMMY_OPERATOR_POTONG_USERNAME", "potong")
    monkeypatch.setenv("DUMMY_OPERATOR_POTONG_PASSWORD", "pass123")
    monkeypatch.setenv("DUMMY_OPERATOR_POTONG_FIRST_NAME", "Tukang")
    monkeypatch.setenv("DUMMY_OPERATOR_POTONG_LAST_NAME", "Potong")

    monkeypatch.setenv("DUMMY_OPERATOR_PENJAHIT_1_USERNAME", "jahit1")
    monkeypatch.setenv("DUMMY_OPERATOR_PENJAHIT_1_PASSWORD", "pass123")
    monkeypatch.setenv("DUMMY_OPERATOR_PENJAHIT_1_FIRST_NAME", "Penjahit")
    monkeypatch.setenv("DUMMY_OPERATOR_PENJAHIT_1_LAST_NAME", "Satu")

    monkeypatch.setenv("DUMMY_OPERATOR_PENJAHIT_2_USERNAME", "jahit2")
    monkeypatch.setenv("DUMMY_OPERATOR_PENJAHIT_2_PASSWORD", "pass123")
    monkeypatch.setenv("DUMMY_OPERATOR_PENJAHIT_2_FIRST_NAME", "Penjahit")
    monkeypatch.setenv("DUMMY_OPERATOR_PENJAHIT_2_LAST_NAME", "Dua")

    monkeypatch.setenv("DUMMY_OPERATOR_DAPUR_USERNAME", "dapur")
    monkeypatch.setenv("DUMMY_OPERATOR_DAPUR_PASSWORD", "pass123")
    monkeypatch.setenv("DUMMY_OPERATOR_DAPUR_FIRST_NAME", "Bagian")
    monkeypatch.setenv("DUMMY_OPERATOR_DAPUR_LAST_NAME", "Dapur")

    monkeypatch.setenv("DUMMY_OPERATOR_GUDANG_USERNAME", "gudang")
    monkeypatch.setenv("DUMMY_OPERATOR_GUDANG_PASSWORD", "pass123")
    monkeypatch.setenv("DUMMY_OPERATOR_GUDANG_FIRST_NAME", "Bagian")
    monkeypatch.setenv("DUMMY_OPERATOR_GUDANG_LAST_NAME", "Gudang")


@pytest.mark.django_db
def test_seed_dummy_konveksi_creates_records(monkeypatch):
    set_dummy_env(monkeypatch)

    call_command("seed_dummy_konveksi")

    # 1. Tenant verification
    tenant = Tenant.objects.get(slug="dummy-konveksi")
    assert tenant.name == "Dummy Konveksi"
    assert tenant.code == "DUMMY"
    assert tenant.is_active is True
    # check bootstrap happened (Warehouse should be created)
    from backend.inventory.models import Warehouse

    assert Warehouse.objects.filter(tenant=tenant).exists()

    # 2. Users & Memberships verification
    kepala = User.objects.get(username="kepala")
    assert kepala.check_password("pass123")
    assert Membership.objects.filter(
        user=kepala, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    ).exists()

    finance = User.objects.get(username="finance")
    assert finance.check_password("pass123")
    assert Membership.objects.filter(
        user=finance, tenant=tenant, role=Membership.Role.FINANCE
    ).exists()

    # 3. Operators verification
    operators = Operator.objects.filter(tenant=tenant)
    assert operators.count() == 5

    op_potong = operators.get(user__username="potong")
    assert op_potong.operator_type == Operator.OperatorType.POTONG
    assert op_potong.status == Operator.OperatorStatus.INTERNAL

    op_jahit1 = operators.get(user__username="jahit1")
    assert op_jahit1.operator_type == Operator.OperatorType.PENJAHIT
    assert op_jahit1.status == Operator.OperatorStatus.INTERNAL

    op_jahit2 = operators.get(user__username="jahit2")
    assert op_jahit2.operator_type == Operator.OperatorType.PENJAHIT
    assert op_jahit2.status == Operator.OperatorStatus.EXTERNAL

    op_dapur = operators.get(user__username="dapur")
    assert op_dapur.operator_type == Operator.OperatorType.DAPUR
    assert op_dapur.status == Operator.OperatorStatus.INTERNAL

    op_gudang = operators.get(user__username="gudang")
    assert op_gudang.operator_type == Operator.OperatorType.GUDANG
    assert op_gudang.status == Operator.OperatorStatus.INTERNAL


@pytest.mark.django_db
def test_seed_dummy_konveksi_is_idempotent(monkeypatch):
    set_dummy_env(monkeypatch)

    call_command("seed_dummy_konveksi")

    # Run twice
    call_command("seed_dummy_konveksi")

    # Should not duplicate records
    assert Tenant.objects.filter(slug="dummy-konveksi").count() == 1
    assert User.objects.filter(username="kepala").count() == 1
    assert Membership.objects.filter(user__username="potong").count() == 1
    assert Operator.objects.filter(user__username="dapur").count() == 1


@pytest.mark.django_db
def test_seed_dummy_konveksi_fails_if_env_missing(monkeypatch):
    set_dummy_env(monkeypatch)
    # Remove one required var
    monkeypatch.delenv("DUMMY_KEPALA_PASSWORD", raising=False)

    with pytest.raises(
        CommandError,
        match="Environment variable\\(s\\) wajib diisi: DUMMY_KEPALA_PASSWORD",
    ):
        call_command("seed_dummy_konveksi")
