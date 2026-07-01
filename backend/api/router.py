from django.core.exceptions import ValidationError
from django.db import IntegrityError
from ninja import NinjaAPI

from backend.api.accounting import router as accounting_router
from backend.api.administration import router as administration_router
from backend.api.core import router as core_router
from backend.api.files import router as files_router
from backend.api.finance import router as finance_router
from backend.api.inventory import router as inventory_router
from backend.api.labor import router as labor_router
from backend.api.production import router as production_router
from backend.api.reports import router as reports_router
from backend.api.search import router as search_router
from backend.core.access import tenant_session_auth
from backend.core.health import router as health_router

from .auth import router as auth_router
from .masterdata import router as masterdata_router
from .sales import router as sales_router

api = NinjaAPI(
    title="Manufacturing Information System API",
    version="1.0.0",
    description="API untuk aplikasi core MIS.",
    docs_url="/docs",
    openapi_url="/schema",
    auth=tenant_session_auth,
)


@api.exception_handler(ValidationError)
def handle_validation_error(request, exc):
    detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
    return api.create_response(request, {"detail": detail}, status=422)


@api.exception_handler(IntegrityError)
def handle_integrity_error(request, _exc):
    return api.create_response(
        request,
        {"detail": "Data bertentangan dengan constraint atau sudah digunakan."},
        status=409,
    )


api.add_router("/auth", auth_router, auth=None)
api.add_router("/administration", administration_router)
api.add_router("/health", health_router, auth=None)
api.add_router("/masterdata", masterdata_router)
api.add_router("/sales/", sales_router)
api.add_router("/production/", production_router)
api.add_router("/inventory/", inventory_router)
api.add_router("/labor/", labor_router)
api.add_router("/finance/", finance_router)
api.add_router("/accounting/", accounting_router)
api.add_router("/files", files_router)
api.add_router("/search", search_router)
api.add_router("/core", core_router)
api.add_router("/reports", reports_router)
