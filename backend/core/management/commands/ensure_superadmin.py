import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.core.models import Membership, Tenant

SUPER_ADMIN_USERNAME_ENV = "SUPER_ADMIN_USERNAME"
SUPER_ADMIN_PASSWORD_ENV = "SUPER_ADMIN_PASSWORD"


class Command(BaseCommand):
    help = "Pastikan user superadmin dari SUPER_ADMIN_USERNAME dan SUPER_ADMIN_PASSWORD tersedia."

    def add_arguments(self, parser):
        parser.add_argument(
            "--tenant-slug",
            default="mis",
            help="Slug tenant aktif untuk membership superadmin.",
        )
        parser.add_argument(
            "--tenant-name",
            default="Manufacturing Information System",
            help="Nama tenant aktif untuk membership superadmin.",
        )

    def handle(self, *args, **options):
        username = os.environ.get(SUPER_ADMIN_USERNAME_ENV, "").strip()
        password = os.environ.get(SUPER_ADMIN_PASSWORD_ENV, "")
        tenant_slug = options["tenant_slug"].strip()
        tenant_name = options["tenant_name"].strip()

        if not username:
            raise CommandError(f"{SUPER_ADMIN_USERNAME_ENV} wajib diisi di .env.")
        if not password:
            raise CommandError(f"{SUPER_ADMIN_PASSWORD_ENV} wajib diisi di .env.")
        if not tenant_slug:
            raise CommandError("--tenant-slug wajib diisi.")
        if not tenant_name:
            raise CommandError("--tenant-name wajib diisi.")

        user_model = get_user_model()

        with transaction.atomic():
            tenant, tenant_created = Tenant.objects.get_or_create(
                slug=tenant_slug,
                defaults={"name": tenant_name, "is_active": True},
            )
            tenant_updates = []
            if tenant.name != tenant_name:
                tenant.name = tenant_name
                tenant_updates.append("name")
            if not tenant.is_active:
                tenant.is_active = True
                tenant_updates.append("is_active")
            if tenant_updates:
                tenant_updates.append("updated_at")
                tenant.save(update_fields=tenant_updates)

            user, user_created = user_model.objects.get_or_create(
                username=username,
                defaults={
                    "is_staff": True,
                    "is_superuser": True,
                    "is_active": True,
                },
            )
            user.is_staff = True
            user.is_superuser = True
            user.is_active = True
            user.set_password(password)
            user.save()

            membership, membership_created = Membership.objects.get_or_create(
                user=user,
                tenant=tenant,
                defaults={
                    "role": Membership.Role.SUPER_ADMIN,
                    "is_active": True,
                },
            )
            membership_updates = []
            if membership.role != Membership.Role.SUPER_ADMIN:
                membership.role = Membership.Role.SUPER_ADMIN
                membership_updates.append("role")
            if not membership.is_active:
                membership.is_active = True
                membership_updates.append("is_active")
            if membership_updates:
                membership.save(update_fields=membership_updates)

        action = "dibuat" if user_created else "diperbarui"
        tenant_action = "dibuat" if tenant_created else "tersedia"
        membership_action = "dibuat" if membership_created else "tersedia"
        self.stdout.write(
            self.style.SUCCESS(
                f"Superadmin {username} {action}; tenant {tenant.slug} "
                f"{tenant_action}; membership {membership_action}."
            )
        )
