"""Endpoint file privat; storage lokal tidak pernah diekspos langsung."""

from uuid import UUID

from django.http import FileResponse, HttpRequest
from ninja import File, Form, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from backend.core.access import get_tenant_context, tenant_session_auth
from backend.core.file_services import (
    archive_business_file,
    resolve_business_file,
    store_business_file,
    store_generated_file,
)
from backend.core.models import FileMetadata
from backend.core.pdf import a4_document
from backend.core.services import record_audit
from backend.finance.models import CustomerInvoice
from backend.sales.models import Delivery

router = Router(tags=["Files"], auth=tenant_session_auth)


class FileResponseSchema(Schema):
    id: UUID
    category: str
    resource_type: str
    resource_id: str
    original_filename: str
    content_type: str
    size_bytes: int
    checksum_sha256: str
    is_archived: bool


@router.get("/documents/{document_type}/{document_id}")
def generate_document(request: HttpRequest, document_type: str, document_id: UUID):
    """Generate, simpan, dan kirim surat jalan atau invoice PDF ukuran A4."""
    context = get_tenant_context(request)
    if document_type == "delivery":
        document = (
            Delivery.objects.filter(tenant=context.tenant, id=document_id)
            .select_related("sales_po__customer")
            .prefetch_related("lines__sales_po_line__product_variant")
            .first()
        )
        if document is None:
            raise HttpError(404, "Pengiriman tidak ditemukan")
        lines = [
            f"Nomor: {document.delivery_number}",
            f"Tanggal: {document.date}",
            f"Pelanggan: {document.sales_po.customer.name}",
            f"Alamat: {document.delivery_address}",
            "",
            "Produk:",
            *[
                f"- {line.sales_po_line.product_variant.sku}: {line.quantity} pcs"
                for line in document.lines.all()
            ],
            "",
            f"Penerima: {document.receiver_name or '-'}",
            f"Waktu terima: {document.received_time or '-'}",
        ]
        title = "SURAT JALAN"
        number = document.delivery_number
        resource_type = "Delivery"
    elif document_type == "invoice":
        document = (
            CustomerInvoice.objects.filter(tenant=context.tenant, id=document_id)
            .select_related("customer", "sales_po")
            .prefetch_related(
                "invoicedelivery_set__delivery__lines__sales_po_line__product_variant"
            )
            .first()
        )
        if document is None:
            raise HttpError(404, "Invoice tidak ditemukan")
        product_lines = []
        for relation in document.invoicedelivery_set.all():
            for line in relation.delivery.lines.all():
                product_lines.append(
                    f"- {line.sales_po_line.product_variant.sku}: "
                    f"{line.quantity} x Rp {line.sales_po_line.unit_price}"
                )
        lines = [
            f"Nomor: {document.invoice_number}",
            f"Tanggal: {document.date}",
            f"Pelanggan: {document.customer.name}",
            f"PO: {document.sales_po.po_number}",
            "",
            *product_lines,
            "",
            f"Total: Rp {document.total_amount}",
            f"Dibayar: Rp {document.amount_paid}",
            f"Status: {document.status}",
        ]
        title = "INVOICE"
        number = document.invoice_number
        resource_type = "CustomerInvoice"
    else:
        raise HttpError(404, "Jenis dokumen tidak dikenal")

    metadata = store_generated_file(
        tenant=context.tenant,
        user=request.user,
        content=a4_document(title, lines),
        filename=f"{number}.pdf".replace("/", "-"),
        category="generated-documents",
        resource_type=resource_type,
        resource_id=str(document_id),
        content_type="application/pdf",
    )
    path = resolve_business_file(metadata)
    response = FileResponse(path.open("rb"), content_type="application/pdf")
    response["Content-Disposition"] = (
        f'attachment; filename="{metadata.original_filename}"'
    )
    response["Cache-Control"] = "private, no-store"
    return response


@router.post("/", response=FileResponseSchema)
def upload_file(
    request: HttpRequest,
    category: Form[str],
    resource_type: Form[str] = "",
    resource_id: Form[str] = "",
    uploaded_file: File[UploadedFile] = None,
):
    context = get_tenant_context(request)
    if uploaded_file is None:
        raise HttpError(422, "File wajib diisi")
    try:
        return store_business_file(
            tenant=context.tenant,
            user=request.user,
            uploaded_file=uploaded_file,
            category=category,
            resource_type=resource_type,
            resource_id=resource_id,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.get("/{file_id}")
def download_file(request: HttpRequest, file_id: UUID):
    context = get_tenant_context(request)
    metadata = FileMetadata.objects.filter(tenant=context.tenant, id=file_id).first()
    if metadata is None:
        raise HttpError(404, "File tidak ditemukan")
    try:
        path = resolve_business_file(metadata)
    except FileNotFoundError as exc:
        raise HttpError(404, "File tidak ditemukan") from exc
    record_audit(
        tenant=context.tenant,
        user=request.user,
        action="business_file_accessed",
        resource_type="FileMetadata",
        resource_id=metadata.id,
        request_id=getattr(request, "request_id", ""),
    )
    response = FileResponse(path.open("rb"), content_type=metadata.content_type)
    response["Content-Disposition"] = (
        f'attachment; filename="{metadata.original_filename}"'
    )
    response["Cache-Control"] = "private, no-store"
    return response


@router.post("/{file_id}/archive", response=FileResponseSchema)
def archive_file(request: HttpRequest, file_id: UUID):
    context = get_tenant_context(request)
    metadata = FileMetadata.objects.filter(tenant=context.tenant, id=file_id).first()
    if metadata is None:
        raise HttpError(404, "File tidak ditemukan")
    return archive_business_file(metadata, user=request.user)
