import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.core.models import Membership, Tenant
from backend.masterdata.models import Operator
from backend.masterdata.services import bootstrap_tenant

User = get_user_model()


class Command(BaseCommand):
    help = "Seed dummy data konveksi, accounts, and operators"

    def handle(self, *args, **options):
        required_vars = [
            "DUMMY_TENANT_NAME",
            "DUMMY_TENANT_SLUG",
            "DUMMY_TENANT_CODE",
            "DUMMY_KEPALA_USERNAME",
            "DUMMY_KEPALA_PASSWORD",
            "DUMMY_KEPALA_FIRST_NAME",
            "DUMMY_KEPALA_LAST_NAME",
            "DUMMY_FINANCE_USERNAME",
            "DUMMY_FINANCE_PASSWORD",
            "DUMMY_FINANCE_FIRST_NAME",
            "DUMMY_FINANCE_LAST_NAME",
            "DUMMY_OPERATOR_POTONG_USERNAME",
            "DUMMY_OPERATOR_POTONG_PASSWORD",
            "DUMMY_OPERATOR_POTONG_FIRST_NAME",
            "DUMMY_OPERATOR_POTONG_LAST_NAME",
            "DUMMY_OPERATOR_PENJAHIT_1_USERNAME",
            "DUMMY_OPERATOR_PENJAHIT_1_PASSWORD",
            "DUMMY_OPERATOR_PENJAHIT_1_FIRST_NAME",
            "DUMMY_OPERATOR_PENJAHIT_1_LAST_NAME",
            "DUMMY_OPERATOR_PENJAHIT_2_USERNAME",
            "DUMMY_OPERATOR_PENJAHIT_2_PASSWORD",
            "DUMMY_OPERATOR_PENJAHIT_2_FIRST_NAME",
            "DUMMY_OPERATOR_PENJAHIT_2_LAST_NAME",
            "DUMMY_OPERATOR_DAPUR_USERNAME",
            "DUMMY_OPERATOR_DAPUR_PASSWORD",
            "DUMMY_OPERATOR_DAPUR_FIRST_NAME",
            "DUMMY_OPERATOR_DAPUR_LAST_NAME",
            "DUMMY_OPERATOR_GUDANG_USERNAME",
            "DUMMY_OPERATOR_GUDANG_PASSWORD",
            "DUMMY_OPERATOR_GUDANG_FIRST_NAME",
            "DUMMY_OPERATOR_GUDANG_LAST_NAME",
        ]

        env_data = {}
        missing_vars = []
        for var in required_vars:
            val = os.environ.get(var)
            if not val:
                missing_vars.append(var)
            env_data[var] = val

        if missing_vars:
            raise CommandError(
                f"Environment variable(s) wajib diisi: {', '.join(missing_vars)}"
            )

        with transaction.atomic():
            # 1. Tenant
            tenant, created = Tenant.objects.update_or_create(
                slug=env_data["DUMMY_TENANT_SLUG"],
                defaults={
                    "name": env_data["DUMMY_TENANT_NAME"],
                    "code": env_data["DUMMY_TENANT_CODE"],
                    "is_active": True,
                },
            )

            if created:
                bootstrap_tenant(tenant)
                self.stdout.write(
                    self.style.SUCCESS(f"Membuat tenant {tenant.name} dan bootstrap.")
                )
            else:
                self.stdout.write(self.style.SUCCESS(f"Update tenant {tenant.name}."))

            # Helper for User + Membership
            def upsert_user(username, password, first_name, last_name, role):
                user, u_created = User.objects.update_or_create(
                    username=username,
                    defaults={
                        "first_name": first_name,
                        "last_name": last_name,
                        "is_active": True,
                    },
                )
                user.set_password(password)
                user.save()

                Membership.objects.update_or_create(
                    user=user,
                    tenant=tenant,
                    defaults={
                        "role": role,
                        "is_active": True,
                    },
                )

                # Batasi membership agar konsisten, hanya pada tenant dummy ini untuk role tertentu
                if role in [Membership.Role.KEPALA_KONVEKSI, Membership.Role.OPERATOR]:
                    Membership.objects.filter(user=user).exclude(tenant=tenant).delete()

                return user

            # Helper for Operator Profile
            def upsert_operator(user, name, op_type, status):
                Operator.objects.update_or_create(
                    tenant=tenant,
                    user=user,
                    defaults={
                        "name": name,
                        "operator_type": op_type,
                        "status": status,
                        "is_active": True,
                    },
                )

            # 2. Kepala Konveksi
            upsert_user(
                env_data["DUMMY_KEPALA_USERNAME"],
                env_data["DUMMY_KEPALA_PASSWORD"],
                env_data["DUMMY_KEPALA_FIRST_NAME"],
                env_data["DUMMY_KEPALA_LAST_NAME"],
                Membership.Role.KEPALA_KONVEKSI,
            )
            self.stdout.write(
                f"  - Akun Kepala Konveksi: {env_data['DUMMY_KEPALA_USERNAME']}"
            )

            # 3. Finance
            upsert_user(
                env_data["DUMMY_FINANCE_USERNAME"],
                env_data["DUMMY_FINANCE_PASSWORD"],
                env_data["DUMMY_FINANCE_FIRST_NAME"],
                env_data["DUMMY_FINANCE_LAST_NAME"],
                Membership.Role.FINANCE,
            )
            self.stdout.write(f"  - Akun Finance: {env_data['DUMMY_FINANCE_USERNAME']}")

            # 4. Operator Configurations
            operators_config = [
                {
                    "username": env_data["DUMMY_OPERATOR_POTONG_USERNAME"],
                    "password": env_data["DUMMY_OPERATOR_POTONG_PASSWORD"],
                    "first_name": env_data["DUMMY_OPERATOR_POTONG_FIRST_NAME"],
                    "last_name": env_data["DUMMY_OPERATOR_POTONG_LAST_NAME"],
                    "type": Operator.OperatorType.POTONG,
                    "status": Operator.OperatorStatus.INTERNAL,
                },
                {
                    "username": env_data["DUMMY_OPERATOR_PENJAHIT_1_USERNAME"],
                    "password": env_data["DUMMY_OPERATOR_PENJAHIT_1_PASSWORD"],
                    "first_name": env_data["DUMMY_OPERATOR_PENJAHIT_1_FIRST_NAME"],
                    "last_name": env_data["DUMMY_OPERATOR_PENJAHIT_1_LAST_NAME"],
                    "type": Operator.OperatorType.PENJAHIT,
                    "status": Operator.OperatorStatus.INTERNAL,
                },
                {
                    "username": env_data["DUMMY_OPERATOR_PENJAHIT_2_USERNAME"],
                    "password": env_data["DUMMY_OPERATOR_PENJAHIT_2_PASSWORD"],
                    "first_name": env_data["DUMMY_OPERATOR_PENJAHIT_2_FIRST_NAME"],
                    "last_name": env_data["DUMMY_OPERATOR_PENJAHIT_2_LAST_NAME"],
                    "type": Operator.OperatorType.PENJAHIT,
                    "status": Operator.OperatorStatus.EXTERNAL,
                },
                {
                    "username": env_data["DUMMY_OPERATOR_DAPUR_USERNAME"],
                    "password": env_data["DUMMY_OPERATOR_DAPUR_PASSWORD"],
                    "first_name": env_data["DUMMY_OPERATOR_DAPUR_FIRST_NAME"],
                    "last_name": env_data["DUMMY_OPERATOR_DAPUR_LAST_NAME"],
                    "type": Operator.OperatorType.DAPUR,
                    "status": Operator.OperatorStatus.INTERNAL,
                },
                {
                    "username": env_data["DUMMY_OPERATOR_GUDANG_USERNAME"],
                    "password": env_data["DUMMY_OPERATOR_GUDANG_PASSWORD"],
                    "first_name": env_data["DUMMY_OPERATOR_GUDANG_FIRST_NAME"],
                    "last_name": env_data["DUMMY_OPERATOR_GUDANG_LAST_NAME"],
                    "type": Operator.OperatorType.GUDANG,
                    "status": Operator.OperatorStatus.INTERNAL,
                },
            ]

            for op in operators_config:
                u = upsert_user(
                    op["username"],
                    op["password"],
                    op["first_name"],
                    op["last_name"],
                    Membership.Role.OPERATOR,
                )
                full_name = f"{op['first_name']} {op['last_name']}".strip()
                upsert_operator(u, full_name, op["type"], op["status"])
                self.stdout.write(
                    f"  - Akun Operator: {op['username']} ({op['type']}, {op['status']})"
                )

        self.stdout.write(self.style.SUCCESS("Seed dummy data konveksi selesai."))
