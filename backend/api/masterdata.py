from datetime import date
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from django.db import transaction
from django.db.models import F, Window
from django.db.models.deletion import ProtectedError, RestrictedError
from django.db.models.functions import RowNumber
from django.http import HttpRequest
from ninja import Router, Schema, Status
from ninja.errors import HttpError

from backend.core.access import require_capability, tenant_session_auth
from backend.masterdata.models import (
    BOM,
    UOM,
    BankAccount,
    BOMItem,
    ChartOfAccount,
    CostCategory,
    Customer,
    Material,
    Operator,
    PieceRate,
    ProductModel,
    ProductVariant,
    Routing,
    RoutingStage,
    Supplier,
)

router = Router(tags=["Master Data"], auth=tenant_session_auth)


class DetailResponse(Schema):
    detail: str


def _tenant_id_for(request: HttpRequest, capability: str) -> int:
    return require_capability(request, capability).tenant_id


def _get_tenant_object(model, tenant_id: int, object_id: str, label: str):
    item = model.objects.filter(id=object_id, tenant_id=tenant_id).first()
    if item is None:
        raise HttpError(404, f"{label} tidak ditemukan")
    return item


def _delete_object(item, *, success: str, protected: str):
    try:
        item.delete()
    except (ProtectedError, RestrictedError):
        return Status(409, {"detail": protected})
    return {"detail": success}


def _set_active(item, active: bool):
    item.is_active = active
    item.save(update_fields=["is_active", "updated_at"])
    return item


# --- Customer ---
class CustomerResponse(Schema):
    id: UUID
    name: str
    phone: str
    email: str
    address: str
    is_active: bool


class CustomerPayload(Schema):
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    is_active: bool = True


@router.get("/customers", response=List[CustomerResponse])
def list_customers(request: HttpRequest):
    tenant_id = _tenant_id_for(request, "masterdata.customers.read")
    return list(Customer.objects.filter(tenant_id=tenant_id).order_by("name"))


@router.post("/customers", response=CustomerResponse)
def create_customer(request: HttpRequest, payload: CustomerPayload):
    tenant_id = _tenant_id_for(request, "masterdata.customers.create")
    return Customer.objects.create(tenant_id=tenant_id, **payload.dict())


@router.put("/customers/{customer_id}", response=CustomerResponse)
def update_customer(request: HttpRequest, customer_id: str, payload: CustomerPayload):
    tenant_id = _tenant_id_for(request, "masterdata.customers.update")
    customer = Customer.objects.filter(id=customer_id, tenant_id=tenant_id).first()
    if not customer:
        raise HttpError(404, "Data tidak ditemukan")

    for attr, value in payload.dict().items():
        setattr(customer, attr, value)
    customer.save()
    return customer


@router.delete(
    "/customers/{customer_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_customer(request: HttpRequest, customer_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.customers.delete")
    customer = _get_tenant_object(Customer, tenant_id, customer_id, "Pelanggan")
    return _delete_object(
        customer,
        success="Pelanggan berhasil dihapus.",
        protected="Pelanggan masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/customers/{customer_id}/activate", response=CustomerResponse)
def activate_customer(request: HttpRequest, customer_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.customers.activate")
    return _set_active(
        _get_tenant_object(Customer, tenant_id, customer_id, "Pelanggan"), True
    )


@router.post("/customers/{customer_id}/deactivate", response=CustomerResponse)
def deactivate_customer(request: HttpRequest, customer_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.customers.deactivate")
    return _set_active(
        _get_tenant_object(Customer, tenant_id, customer_id, "Pelanggan"), False
    )


# --- Supplier ---
class SupplierResponse(Schema):
    id: UUID
    name: str
    contact_person: str
    phone: str
    email: str
    address: str
    is_active: bool


class SupplierPayload(Schema):
    name: str
    contact_person: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    is_active: bool = True


@router.get("/suppliers", response=List[SupplierResponse])
def list_suppliers(request: HttpRequest):
    return list(
        Supplier.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.suppliers.read")
        ).order_by("name")
    )


@router.post("/suppliers", response=SupplierResponse)
def create_supplier(request: HttpRequest, payload: SupplierPayload):
    return Supplier.objects.create(
        tenant_id=_tenant_id_for(request, "masterdata.suppliers.create"),
        **payload.dict(),
    )


@router.put("/suppliers/{supplier_id}", response=SupplierResponse)
def update_supplier(request: HttpRequest, supplier_id: str, payload: SupplierPayload):
    supplier = Supplier.objects.filter(
        id=supplier_id,
        tenant_id=_tenant_id_for(request, "masterdata.suppliers.update"),
    ).first()
    if not supplier:
        raise HttpError(404, "Data tidak ditemukan")
    for attr, value in payload.dict().items():
        setattr(supplier, attr, value)
    supplier.save()
    return supplier


@router.delete(
    "/suppliers/{supplier_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_supplier(request: HttpRequest, supplier_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.suppliers.delete")
    supplier = _get_tenant_object(Supplier, tenant_id, supplier_id, "Pemasok")
    return _delete_object(
        supplier,
        success="Pemasok berhasil dihapus.",
        protected="Pemasok masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/suppliers/{supplier_id}/activate", response=SupplierResponse)
def activate_supplier(request: HttpRequest, supplier_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.suppliers.activate")
    return _set_active(
        _get_tenant_object(Supplier, tenant_id, supplier_id, "Pemasok"), True
    )


@router.post("/suppliers/{supplier_id}/deactivate", response=SupplierResponse)
def deactivate_supplier(request: HttpRequest, supplier_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.suppliers.deactivate")
    return _set_active(
        _get_tenant_object(Supplier, tenant_id, supplier_id, "Pemasok"), False
    )


# --- UOM ---
class UOMResponse(Schema):
    id: UUID
    code: str
    name: str
    dimension: str


class UOMPayload(Schema):
    code: str
    name: str
    dimension: str = "count"


@router.get("/uoms", response=List[UOMResponse])
def list_uoms(request: HttpRequest):
    return list(
        UOM.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.uoms.read")
        ).order_by("name")
    )


@router.post("/uoms", response=UOMResponse)
def create_uom(request: HttpRequest, payload: UOMPayload):
    return UOM.objects.create(
        tenant_id=_tenant_id_for(request, "masterdata.uoms.create"),
        **payload.dict(),
    )


@router.put("/uoms/{uom_id}", response=UOMResponse)
def update_uom(request: HttpRequest, uom_id: str, payload: UOMPayload):
    tenant_id = _tenant_id_for(request, "masterdata.uoms.update")
    uom = _get_tenant_object(UOM, tenant_id, uom_id, "Satuan")
    for attr, value in payload.dict().items():
        setattr(uom, attr, value)
    uom.save()
    return uom


@router.delete("/uoms/{uom_id}", response={200: DetailResponse, 409: DetailResponse})
def delete_uom(request: HttpRequest, uom_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.uoms.delete")
    uom = _get_tenant_object(UOM, tenant_id, uom_id, "Satuan")
    return _delete_object(
        uom,
        success="Satuan berhasil dihapus.",
        protected="Satuan masih digunakan dan tidak dapat dihapus.",
    )


# --- Material ---
class MaterialResponse(Schema):
    id: UUID
    code: str
    name: str
    purchase_uom_id: UUID
    purchase_uom_code: str
    usage_uom_id: UUID
    usage_uom_code: str
    conversion_ratio: Decimal
    moq: Decimal
    purchase_multiple: Decimal
    package_quantity: Decimal
    shrinkage_percent: Decimal
    default_supplier_id: Optional[UUID] = None
    last_purchase_price: Optional[Decimal] = None
    is_active: bool

    @staticmethod
    def resolve_purchase_uom_code(obj: Material) -> str:
        return obj.purchase_uom.code

    @staticmethod
    def resolve_usage_uom_code(obj: Material) -> str:
        return obj.usage_uom.code


class MaterialPayload(Schema):
    code: Optional[str] = None
    name: str
    purchase_uom_id: UUID
    usage_uom_id: UUID
    conversion_ratio: Optional[Decimal] = None
    moq: Decimal = Decimal("1")
    purchase_multiple: Optional[Decimal] = None
    package_quantity: Decimal = Decimal("1")
    shrinkage_percent: Decimal = Decimal("0")
    default_supplier_id: Optional[UUID] = None
    last_purchase_price: Optional[Decimal] = None
    is_active: bool = True


def _next_material_code(tenant_id: int) -> str:
    sequence = 1
    while True:
        code = f"MAT-{sequence:06d}"
        if not Material.objects.filter(tenant_id=tenant_id, code=code).exists():
            return code
        sequence += 1


def _material_payload_data(payload: MaterialPayload) -> dict:
    data = payload.dict(exclude={"code", "conversion_ratio"})
    data["name"] = data["name"].strip()
    data["conversion_ratio"] = data["package_quantity"]
    if data["purchase_multiple"] is None:
        data["purchase_multiple"] = Decimal("1")
    return data


@router.get("/materials", response=List[MaterialResponse])
def list_materials(request: HttpRequest):
    return list(
        Material.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.materials.read")
        )
        .select_related("purchase_uom", "usage_uom")
        .order_by("name")
    )


@router.post("/materials", response=MaterialResponse)
def create_material(request: HttpRequest, payload: MaterialPayload):
    tenant_id = _tenant_id_for(request, "masterdata.materials.create")
    return Material.objects.create(
        tenant_id=tenant_id,
        code=_next_material_code(tenant_id),
        **_material_payload_data(payload),
    )


@router.put("/materials/{material_id}", response=MaterialResponse)
def update_material(request: HttpRequest, material_id: str, payload: MaterialPayload):
    mat = Material.objects.filter(
        id=material_id,
        tenant_id=_tenant_id_for(request, "masterdata.materials.update"),
    ).first()
    if not mat:
        raise HttpError(404, "Data tidak ditemukan")
    for attr, value in _material_payload_data(payload).items():
        setattr(mat, attr, value)
    mat.save()
    return mat


@router.delete(
    "/materials/{material_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_material(request: HttpRequest, material_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.materials.delete")
    material = _get_tenant_object(Material, tenant_id, material_id, "Material")
    return _delete_object(
        material,
        success="Material berhasil dihapus.",
        protected="Material masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/materials/{material_id}/activate", response=MaterialResponse)
def activate_material(request: HttpRequest, material_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.materials.activate")
    return _set_active(
        _get_tenant_object(Material, tenant_id, material_id, "Material"), True
    )


@router.post("/materials/{material_id}/deactivate", response=MaterialResponse)
def deactivate_material(request: HttpRequest, material_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.materials.deactivate")
    return _set_active(
        _get_tenant_object(Material, tenant_id, material_id, "Material"), False
    )


# --- Product ---
class ProductModelResponse(Schema):
    id: UUID
    code: str
    name: str
    description: str
    is_active: bool


class ProductModelPayload(Schema):
    code: str
    name: str
    description: str = ""
    is_active: bool = True


@router.get("/products", response=List[ProductModelResponse])
def list_products(request: HttpRequest):
    return list(
        ProductModel.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.products.read")
        ).order_by("name")
    )


@router.post("/products", response=ProductModelResponse)
def create_product(request: HttpRequest, payload: ProductModelPayload):
    return ProductModel.objects.create(
        tenant_id=_tenant_id_for(request, "masterdata.products.create"),
        **payload.dict(),
    )


@router.put("/products/{product_id}", response=ProductModelResponse)
def update_product(request: HttpRequest, product_id: str, payload: ProductModelPayload):
    tenant_id = _tenant_id_for(request, "masterdata.products.update")
    product = _get_tenant_object(ProductModel, tenant_id, product_id, "Produk")
    for attr, value in payload.dict().items():
        setattr(product, attr, value)
    product.save()
    return product


@router.delete(
    "/products/{product_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_product(request: HttpRequest, product_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.products.delete")
    product = _get_tenant_object(ProductModel, tenant_id, product_id, "Produk")
    return _delete_object(
        product,
        success="Produk berhasil dihapus.",
        protected="Produk masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/products/{product_id}/activate", response=ProductModelResponse)
def activate_product(request: HttpRequest, product_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.products.activate")
    return _set_active(
        _get_tenant_object(ProductModel, tenant_id, product_id, "Produk"), True
    )


@router.post("/products/{product_id}/deactivate", response=ProductModelResponse)
def deactivate_product(request: HttpRequest, product_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.products.deactivate")
    return _set_active(
        _get_tenant_object(ProductModel, tenant_id, product_id, "Produk"), False
    )


# --- Operator ---
class OperatorResponse(Schema):
    id: UUID
    name: str
    operator_type: str
    status: str
    location: str
    phone: str
    is_active: bool


class OperatorPayload(Schema):
    name: str
    operator_type: str
    status: str
    location: str = ""
    phone: str = ""
    is_active: bool = True


@router.get("/operators", response=List[OperatorResponse])
def list_operators(request: HttpRequest):
    return list(
        Operator.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.operators.read")
        ).order_by("name")
    )


# --- BOM ---
class BOMResponse(Schema):
    id: UUID
    product_variant_id: UUID
    version: int
    effective_date: date
    is_active: bool


class BOMDetailVariantResponse(Schema):
    id: UUID
    product_model_id: UUID
    sku: str
    color: str
    size: str
    metadata: dict


class BOMDetailItemResponse(Schema):
    id: UUID
    material_id: UUID
    material_code: str
    material_name: str
    quantity: Decimal
    usage_uom_code: str
    purchase_uom_code: str
    conversion_ratio: Decimal
    last_purchase_price: Optional[Decimal] = None


class BOMDetailResponse(Schema):
    id: UUID
    product_variant_id: UUID
    product_variant: BOMDetailVariantResponse
    version: int
    effective_date: date
    is_active: bool
    items: List[BOMDetailItemResponse]


class BOMPayload(Schema):
    product_variant_id: UUID
    version: int = 1
    effective_date: date
    is_active: bool = True


@router.get("/boms", response=List[BOMResponse])
def list_boms(request: HttpRequest):
    return list(
        BOM.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.boms.read")
        ).order_by("-effective_date")
    )


@router.get("/boms/{bom_id}", response=BOMDetailResponse)
def get_bom(request: HttpRequest, bom_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.boms.read")
    bom = (
        BOM.objects.filter(tenant_id=tenant_id, id=bom_id)
        .select_related("product_variant", "product_variant__product_model")
        .prefetch_related("items__material__usage_uom", "items__material__purchase_uom")
        .first()
    )
    if bom is None:
        raise HttpError(404, "BOM tidak ditemukan")
    variant = bom.product_variant
    return {
        "id": bom.id,
        "product_variant_id": bom.product_variant_id,
        "product_variant": {
            "id": variant.id,
            "product_model_id": variant.product_model_id,
            "sku": variant.sku,
            "color": variant.color,
            "size": variant.size,
            "metadata": variant.metadata,
        },
        "version": bom.version,
        "effective_date": bom.effective_date,
        "is_active": bom.is_active,
        "items": [
            {
                "id": item.id,
                "material_id": item.material_id,
                "material_code": item.material.code,
                "material_name": item.material.name,
                "quantity": item.quantity,
                "usage_uom_code": item.material.usage_uom.code,
                "purchase_uom_code": item.material.purchase_uom.code,
                "conversion_ratio": item.material.conversion_ratio,
                "last_purchase_price": item.material.last_purchase_price,
            }
            for item in bom.items.select_related(
                "material", "material__usage_uom", "material__purchase_uom"
            ).order_by("created_at", "id")
        ],
    }


@router.post("/boms", response=BOMResponse)
def create_bom(request: HttpRequest, payload: BOMPayload):
    return BOM.objects.create(
        tenant_id=_tenant_id_for(request, "masterdata.boms.create"),
        **payload.dict(),
    )


@router.put("/boms/{bom_id}", response=BOMResponse)
def update_bom(request: HttpRequest, bom_id: str, payload: BOMPayload):
    tenant_id = _tenant_id_for(request, "masterdata.boms.update")
    bom = _get_tenant_object(BOM, tenant_id, bom_id, "BOM")
    for attr, value in payload.dict().items():
        setattr(bom, attr, value)
    bom.save()
    return bom


@router.delete("/boms/{bom_id}", response={200: DetailResponse, 409: DetailResponse})
def delete_bom(request: HttpRequest, bom_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.boms.delete")
    bom = _get_tenant_object(BOM, tenant_id, bom_id, "BOM")
    return _delete_object(
        bom,
        success="BOM berhasil dihapus.",
        protected="BOM masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/boms/{bom_id}/activate", response=BOMResponse)
def activate_bom(request: HttpRequest, bom_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.boms.activate")
    return _set_active(_get_tenant_object(BOM, tenant_id, bom_id, "BOM"), True)


@router.post("/boms/{bom_id}/deactivate", response=BOMResponse)
def deactivate_bom(request: HttpRequest, bom_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.boms.deactivate")
    return _set_active(_get_tenant_object(BOM, tenant_id, bom_id, "BOM"), False)


# --- Routing ---


class PieceRateResponse(Schema):
    id: UUID
    product_model_id: UUID
    stage_name: str
    rate_amount: Decimal
    effective_date: date
    operator_id: Optional[UUID] = None


class RoutingStageResponse(Schema):
    id: UUID
    sequence: int
    stage_name: str
    transition_rule: dict
    requires_qc: bool


class RoutingResponse(Schema):
    id: UUID
    product_model_id: UUID
    version: int
    effective_date: date
    is_active: bool
    stages: List[RoutingStageResponse] = []


class RoutingPayload(Schema):
    product_model_id: UUID
    version: int = 1
    effective_date: date
    is_active: bool = True


class RoutingDuplicatePayload(Schema):
    version: int
    effective_date: date
    is_active: bool = True


VALID_ROUTING_TRANSITION_MODES = {"strict_sequence", "any_to_any"}
DEFAULT_ROUTING_TRANSITION_RULE = {"mode": "any_to_any"}


def _normalize_routing_transition_rule(value, *, strict: bool = True) -> dict:
    if value in (None, "", {}):
        return dict(DEFAULT_ROUTING_TRANSITION_RULE)
    if isinstance(value, str):
        if value in VALID_ROUTING_TRANSITION_MODES:
            return {"mode": value}
        if strict:
            raise HttpError(422, "Aturan transisi routing tidak valid.")
        return dict(DEFAULT_ROUTING_TRANSITION_RULE)
    if not isinstance(value, dict):
        if strict:
            raise HttpError(422, "Aturan transisi routing tidak valid.")
        return dict(DEFAULT_ROUTING_TRANSITION_RULE)

    mode = value.get("mode", DEFAULT_ROUTING_TRANSITION_RULE["mode"])
    if mode not in VALID_ROUTING_TRANSITION_MODES:
        if strict:
            raise HttpError(422, "Aturan transisi routing tidak valid.")
        return dict(DEFAULT_ROUTING_TRANSITION_RULE)
    return {"mode": mode}


def _routing_stage_response(stage: RoutingStage) -> dict:
    return {
        "id": stage.id,
        "sequence": stage.sequence,
        "stage_name": stage.stage_name,
        "transition_rule": _normalize_routing_transition_rule(
            stage.transition_rule, strict=False
        ),
        "requires_qc": stage.requires_qc,
    }


def _routing_response(routing: Routing) -> dict:
    stages = sorted(routing.stages.all(), key=lambda stage: stage.sequence)
    return {
        "id": routing.id,
        "product_model_id": routing.product_model_id,
        "version": routing.version,
        "effective_date": routing.effective_date,
        "is_active": routing.is_active,
        "stages": [_routing_stage_response(stage) for stage in stages],
    }


def _validate_routing_stage_payload(
    tenant_id: int,
    routing_id: str,
    payload: "RoutingStagePayload",
    *,
    exclude_stage_id: str | None = None,
) -> dict:
    stage_name = payload.stage_name.strip()
    if payload.sequence < 1:
        raise HttpError(422, "Urutan tahap routing wajib lebih besar dari 0.")
    if not stage_name:
        raise HttpError(422, "Nama tahapan routing wajib diisi.")
    duplicate = RoutingStage.objects.filter(
        tenant_id=tenant_id, routing_id=routing_id, sequence=payload.sequence
    )
    if exclude_stage_id:
        duplicate = duplicate.exclude(id=exclude_stage_id)
    if duplicate.exists():
        raise HttpError(409, "Urutan tahap routing sudah digunakan.")
    return {
        "sequence": payload.sequence,
        "stage_name": stage_name,
        "transition_rule": _normalize_routing_transition_rule(payload.transition_rule),
        "requires_qc": payload.requires_qc,
    }


@router.get("/routings", response=List[RoutingResponse])
def list_routings(request: HttpRequest):
    routings = (
        Routing.objects.prefetch_related("stages")
        .filter(tenant_id=_tenant_id_for(request, "masterdata.routings.read"))
        .order_by("-effective_date")
    )
    return [_routing_response(routing) for routing in routings]


@router.get("/routings/{routing_id}", response=RoutingResponse)
def get_routing(request: HttpRequest, routing_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.routings.read")
    routing = (
        Routing.objects.prefetch_related("stages")
        .filter(tenant_id=tenant_id, id=routing_id)
        .first()
    )
    if routing is None:
        raise HttpError(404, "Routing tidak ditemukan")
    return _routing_response(routing)


@router.post("/routings", response=RoutingResponse)
def create_routing(request: HttpRequest, payload: RoutingPayload):
    routing = Routing.objects.create(
        tenant_id=_tenant_id_for(request, "masterdata.routings.create"),
        **payload.dict(),
    )
    return _routing_response(routing)


@router.put("/routings/{routing_id}", response=RoutingResponse)
def update_routing(request: HttpRequest, routing_id: str, payload: RoutingPayload):
    tenant_id = _tenant_id_for(request, "masterdata.routings.update")
    routing = _get_tenant_object(Routing, tenant_id, routing_id, "Routing")
    for attr, value in payload.dict().items():
        setattr(routing, attr, value)
    routing.save()
    routing = (
        Routing.objects.prefetch_related("stages")
        .filter(tenant_id=tenant_id, id=routing_id)
        .first()
    )
    return _routing_response(routing)


@router.post("/routings/{routing_id}/duplicate", response=RoutingResponse)
@transaction.atomic
def duplicate_routing(
    request: HttpRequest, routing_id: str, payload: RoutingDuplicatePayload
):
    tenant_id = _tenant_id_for(request, "masterdata.routings.create")
    if payload.version < 1:
        raise HttpError(422, "Versi routing wajib lebih besar dari 0.")
    source = (
        Routing.objects.select_for_update()
        .prefetch_related("stages")
        .filter(tenant_id=tenant_id, id=routing_id)
        .first()
    )
    if source is None:
        raise HttpError(404, "Routing tidak ditemukan")
    if Routing.objects.filter(
        tenant_id=tenant_id, product_model=source.product_model, version=payload.version
    ).exists():
        raise HttpError(409, "Versi routing sudah digunakan untuk model produk ini.")
    routing = Routing.objects.create(
        tenant_id=tenant_id,
        product_model=source.product_model,
        version=payload.version,
        effective_date=payload.effective_date,
        is_active=payload.is_active,
    )
    RoutingStage.objects.bulk_create(
        [
            RoutingStage(
                tenant_id=tenant_id,
                routing=routing,
                sequence=stage.sequence,
                stage_name=stage.stage_name,
                transition_rule=_normalize_routing_transition_rule(
                    stage.transition_rule, strict=False
                ),
                requires_qc=stage.requires_qc,
            )
            for stage in source.stages.all()
        ]
    )
    routing.refresh_from_db()
    return _routing_response(routing)


@router.delete(
    "/routings/{routing_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_routing(request: HttpRequest, routing_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.routings.delete")
    routing = _get_tenant_object(Routing, tenant_id, routing_id, "Routing")
    return _delete_object(
        routing,
        success="Routing berhasil dihapus.",
        protected="Routing masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/routings/{routing_id}/activate", response=RoutingResponse)
def activate_routing(request: HttpRequest, routing_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.routings.activate")
    return _set_active(
        _get_tenant_object(Routing, tenant_id, routing_id, "Routing"), True
    )


@router.post("/routings/{routing_id}/deactivate", response=RoutingResponse)
def deactivate_routing(request: HttpRequest, routing_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.routings.deactivate")
    return _set_active(
        _get_tenant_object(Routing, tenant_id, routing_id, "Routing"), False
    )


class ProductVariantPayload(Schema):
    product_model_id: UUID
    color: str = ""
    size: str = ""
    metadata: dict = {}
    default_margin_percent: Optional[Decimal] = None
    is_active: bool = True


class ProductVariantResponse(Schema):
    id: UUID
    product_model_id: UUID
    sku: str
    color: str
    size: str
    metadata: dict
    default_margin_percent: Optional[Decimal]
    is_active: bool


@router.get("/product-variants", response=List[ProductVariantResponse])
def list_product_variants(request: HttpRequest):
    return list(
        ProductVariant.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.product_variants.read")
        ).order_by("sku")
    )


@router.post("/product-variants", response=ProductVariantResponse)
def create_product_variant(request: HttpRequest, payload: ProductVariantPayload):
    return ProductVariant.objects.create(
        tenant_id=_tenant_id_for(request, "masterdata.product_variants.create"),
        **payload.dict(),
    )


@router.put("/product-variants/{variant_id}", response=ProductVariantResponse)
def update_product_variant(
    request: HttpRequest, variant_id: str, payload: ProductVariantPayload
):
    tenant_id = _tenant_id_for(request, "masterdata.product_variants.update")
    variant = _get_tenant_object(ProductVariant, tenant_id, variant_id, "Varian produk")
    for attr, value in payload.dict().items():
        setattr(variant, attr, value)
    variant.save()
    return variant


@router.delete(
    "/product-variants/{variant_id}",
    response={200: DetailResponse, 409: DetailResponse},
)
def delete_product_variant(request: HttpRequest, variant_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.product_variants.delete")
    variant = _get_tenant_object(ProductVariant, tenant_id, variant_id, "Varian produk")
    return _delete_object(
        variant,
        success="Varian produk berhasil dihapus.",
        protected="Varian produk masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/product-variants/{variant_id}/activate", response=ProductVariantResponse)
def activate_product_variant(request: HttpRequest, variant_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.product_variants.activate")
    return _set_active(
        _get_tenant_object(ProductVariant, tenant_id, variant_id, "Varian produk"), True
    )


@router.post(
    "/product-variants/{variant_id}/deactivate", response=ProductVariantResponse
)
def deactivate_product_variant(request: HttpRequest, variant_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.product_variants.deactivate")
    return _set_active(
        _get_tenant_object(ProductVariant, tenant_id, variant_id, "Varian produk"),
        False,
    )


class BOMItemPayload(Schema):
    material_id: UUID
    quantity: Decimal


class BOMItemUpdatePayload(Schema):
    quantity: Decimal


def _bom_detail_item_response(item: BOMItem) -> dict:
    material = item.material
    return {
        "id": item.id,
        "material_id": item.material_id,
        "material_code": material.code,
        "material_name": material.name,
        "quantity": item.quantity,
        "usage_uom_code": material.usage_uom.code,
        "purchase_uom_code": material.purchase_uom.code,
        "conversion_ratio": material.conversion_ratio,
        "last_purchase_price": material.last_purchase_price,
    }


@router.post("/boms/{bom_id}/items", response=BOMDetailItemResponse)
def add_bom_item(request: HttpRequest, bom_id: str, payload: BOMItemPayload):
    tenant_id = _tenant_id_for(request, "masterdata.bom_items.create")
    bom = BOM.objects.filter(tenant_id=tenant_id, id=bom_id).first()
    if bom is None:
        raise HttpError(404, "BOM tidak ditemukan")
    material = Material.objects.filter(tenant_id=tenant_id, id=payload.material_id).first()
    if material is None:
        raise HttpError(404, "Material tidak ditemukan")
    if BOMItem.objects.filter(
        tenant_id=tenant_id, bom=bom, material_id=payload.material_id
    ).exists():
        raise HttpError(409, "Material sudah ada di formula ini")
    item = BOMItem.objects.create(
        tenant_id=tenant_id,
        bom=bom,
        material=material,
        quantity=payload.quantity,
    )
    item.refresh_from_db()
    return _bom_detail_item_response(item)


@router.put("/boms/{bom_id}/items/{item_id}", response=BOMDetailItemResponse)
def update_bom_item(
    request: HttpRequest, bom_id: str, item_id: str, payload: BOMItemUpdatePayload
):
    tenant_id = _tenant_id_for(request, "masterdata.bom_items.update")
    item = (
        BOMItem.objects.filter(tenant_id=tenant_id, bom_id=bom_id, id=item_id)
        .select_related("material", "material__usage_uom", "material__purchase_uom")
        .first()
    )
    if item is None:
        raise HttpError(404, "Item BOM tidak ditemukan")
    item.quantity = payload.quantity
    item.save(update_fields=["quantity", "updated_at"])
    item.refresh_from_db()
    return _bom_detail_item_response(item)


@router.delete(
    "/boms/{bom_id}/items/{item_id}",
    response={200: DetailResponse, 409: DetailResponse},
)
def delete_bom_item(request: HttpRequest, bom_id: str, item_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.bom_items.delete")
    item = BOMItem.objects.filter(
        tenant_id=tenant_id, bom_id=bom_id, id=item_id
    ).first()
    if item is None:
        raise HttpError(404, "Item BOM tidak ditemukan")
    return _delete_object(
        item,
        success="Item BOM berhasil dihapus.",
        protected="Item BOM masih digunakan dan tidak dapat dihapus.",
    )


class RoutingStagePayload(Schema):
    sequence: int
    stage_name: str
    transition_rule: dict = {}
    requires_qc: bool = False


@router.post("/routings/{routing_id}/stages", response=RoutingStageResponse)
def add_routing_stage(
    request: HttpRequest, routing_id: str, payload: RoutingStagePayload
):
    tenant_id = _tenant_id_for(request, "masterdata.routing_stages.create")
    routing = Routing.objects.filter(tenant_id=tenant_id, id=routing_id).first()
    if routing is None:
        raise HttpError(404, "Routing tidak ditemukan")
    values = _validate_routing_stage_payload(tenant_id, routing_id, payload)
    stage = RoutingStage.objects.create(
        tenant_id=tenant_id,
        routing=routing,
        **values,
    )
    return _routing_stage_response(stage)


@router.put(
    "/routings/{routing_id}/stages/{stage_id}", response=RoutingStageResponse
)
def update_routing_stage(
    request: HttpRequest, routing_id: str, stage_id: str, payload: RoutingStagePayload
):
    tenant_id = _tenant_id_for(request, "masterdata.routing_stages.update")
    stage = RoutingStage.objects.filter(
        tenant_id=tenant_id, routing_id=routing_id, id=stage_id
    ).first()
    if stage is None:
        raise HttpError(404, "Tahap routing tidak ditemukan")
    values = _validate_routing_stage_payload(
        tenant_id, routing_id, payload, exclude_stage_id=stage_id
    )
    for attr, value in values.items():
        setattr(stage, attr, value)
    stage.save(update_fields=["sequence", "stage_name", "transition_rule", "requires_qc", "updated_at"])
    stage.refresh_from_db()
    return _routing_stage_response(stage)


@router.delete(
    "/routings/{routing_id}/stages/{stage_id}",
    response={200: DetailResponse, 409: DetailResponse},
)
def delete_routing_stage(request: HttpRequest, routing_id: str, stage_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.routing_stages.delete")
    stage = RoutingStage.objects.filter(
        tenant_id=tenant_id, routing_id=routing_id, id=stage_id
    ).first()
    if stage is None:
        raise HttpError(404, "Tahap routing tidak ditemukan")
    return _delete_object(
        stage,
        success="Tahap routing berhasil dihapus.",
        protected="Tahap routing sudah digunakan dan tidak dapat dihapus.",
    )


class PieceRatePayload(Schema):
    product_model_id: UUID
    stage_name: str
    rate_amount: Decimal
    effective_date: date
    operator_id: Optional[str] = None
    location: str = ""
    operator_status: str = ""
    change_reason: str


def _piece_rate_conflict_exists(
    tenant_id: int, payload: PieceRatePayload, exclude_id: str | None = None
) -> bool:
    queryset = PieceRate.objects.filter(
        tenant_id=tenant_id,
        product_model_id=payload.product_model_id,
        stage_name=payload.stage_name,
        effective_date=payload.effective_date,
        location=payload.location,
        operator_status=payload.operator_status,
    )
    if payload.operator_id:
        queryset = queryset.filter(operator_id=payload.operator_id)
    else:
        queryset = queryset.filter(operator__isnull=True)
    if exclude_id is not None:
        queryset = queryset.exclude(id=exclude_id)
    return queryset.exists()


@router.get("/piece-rates", response=List[PieceRateResponse])
def list_piece_rates(request: HttpRequest):
    tenant_id = _tenant_id_for(request, "masterdata.piece_rates.read")
    return list(
        PieceRate.objects.filter(tenant_id=tenant_id, is_active=True)
        .annotate(
            latest_rank=Window(
                expression=RowNumber(),
                partition_by=[
                    F("product_model_id"),
                    F("stage_name"),
                    F("operator_id"),
                    F("location"),
                    F("operator_status"),
                ],
                order_by=[
                    F("effective_date").desc(),
                    F("updated_at").desc(),
                    F("created_at").desc(),
                    F("id").desc(),
                ],
            )
        )
        .filter(latest_rank=1)
        .order_by("product_model_id", "stage_name", "-effective_date")
        .values(
            "id",
            "product_model_id",
            "operator_id",
            "stage_name",
            "rate_amount",
            "effective_date",
            "location",
            "operator_status",
            "is_active",
        )
    )


@router.post("/piece-rates")
def create_piece_rate(request: HttpRequest, payload: PieceRatePayload):
    tenant_id = _tenant_id_for(request, "masterdata.piece_rates.create")
    if _piece_rate_conflict_exists(tenant_id, payload):
        raise HttpError(
            409,
            "Tarif borongan untuk model, tahapan, dan tanggal efektif ini sudah ada.",
        )
    rate = PieceRate.objects.create(tenant_id=tenant_id, **payload.dict())
    return {"id": str(rate.id)}


@router.put("/piece-rates/{rate_id}", response=PieceRateResponse)
def update_piece_rate(request: HttpRequest, rate_id: str, payload: PieceRatePayload):
    tenant_id = _tenant_id_for(request, "masterdata.piece_rates.update")
    rate = _get_tenant_object(PieceRate, tenant_id, rate_id, "Tarif borongan")
    if _piece_rate_conflict_exists(tenant_id, payload, exclude_id=rate_id):
        raise HttpError(
            409,
            "Tarif borongan untuk model, tahapan, dan tanggal efektif ini sudah ada.",
        )
    for attr, value in payload.dict().items():
        setattr(rate, attr, value)
    rate.save()
    return rate


@router.delete(
    "/piece-rates/{rate_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_piece_rate(request: HttpRequest, rate_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.piece_rates.delete")
    rate = _get_tenant_object(PieceRate, tenant_id, rate_id, "Tarif borongan")
    return _delete_object(
        rate,
        success="Tarif borongan berhasil dihapus.",
        protected="Tarif borongan masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/piece-rates/{rate_id}/activate", response=PieceRateResponse)
def activate_piece_rate(request: HttpRequest, rate_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.piece_rates.activate")
    return _set_active(
        _get_tenant_object(PieceRate, tenant_id, rate_id, "Tarif borongan"), True
    )


@router.post("/piece-rates/{rate_id}/deactivate", response=PieceRateResponse)
def deactivate_piece_rate(request: HttpRequest, rate_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.piece_rates.deactivate")
    return _set_active(
        _get_tenant_object(PieceRate, tenant_id, rate_id, "Tarif borongan"), False
    )


class ChartOfAccountResponse(Schema):
    id: UUID
    code: str
    name: str
    account_type: str
    is_active: bool


class ChartOfAccountPayload(Schema):
    code: str
    name: str
    account_type: str
    is_active: bool = True


@router.get("/chart-of-accounts", response=List[ChartOfAccountResponse])
def list_chart_of_accounts(request: HttpRequest):
    return list(
        ChartOfAccount.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.chart_of_accounts.read")
        )
        .order_by("code")
        .values("id", "code", "name", "account_type", "is_active")
    )


@router.post("/chart-of-accounts", response=ChartOfAccountResponse)
def create_chart_of_account(request: HttpRequest, payload: ChartOfAccountPayload):
    return ChartOfAccount.objects.create(
        tenant_id=_tenant_id_for(request, "masterdata.chart_of_accounts.create"),
        **payload.dict(),
    )


@router.put("/chart-of-accounts/{account_id}", response=ChartOfAccountResponse)
def update_chart_of_account(
    request: HttpRequest, account_id: str, payload: ChartOfAccountPayload
):
    tenant_id = _tenant_id_for(request, "masterdata.chart_of_accounts.update")
    account = _get_tenant_object(ChartOfAccount, tenant_id, account_id, "Akun")
    for attr, value in payload.dict().items():
        setattr(account, attr, value)
    account.save()
    return account


@router.delete(
    "/chart-of-accounts/{account_id}",
    response={200: DetailResponse, 409: DetailResponse},
)
def delete_chart_of_account(request: HttpRequest, account_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.chart_of_accounts.delete")
    account = _get_tenant_object(ChartOfAccount, tenant_id, account_id, "Akun")
    return _delete_object(
        account,
        success="Akun berhasil dihapus.",
        protected="Akun masih digunakan dan tidak dapat dihapus.",
    )


@router.post(
    "/chart-of-accounts/{account_id}/activate", response=ChartOfAccountResponse
)
def activate_chart_of_account(request: HttpRequest, account_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.chart_of_accounts.activate")
    return _set_active(
        _get_tenant_object(ChartOfAccount, tenant_id, account_id, "Akun"), True
    )


@router.post(
    "/chart-of-accounts/{account_id}/deactivate", response=ChartOfAccountResponse
)
def deactivate_chart_of_account(request: HttpRequest, account_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.chart_of_accounts.deactivate")
    return _set_active(
        _get_tenant_object(ChartOfAccount, tenant_id, account_id, "Akun"), False
    )


class BankAccountPayload(Schema):
    name: str
    bank_name: str = ""
    account_number: str = ""
    account_holder: str = ""
    chart_account_id: Optional[UUID] = None
    is_cash: bool = False
    is_petty_cash: bool = False
    is_active: bool = True


class BankAccountResponse(Schema):
    id: UUID
    name: str
    bank_name: str
    account_number: str
    account_holder: str
    is_cash: bool
    is_petty_cash: bool
    is_active: bool


@router.get("/bank-accounts", response=List[BankAccountResponse])
def list_bank_accounts(request: HttpRequest):
    return list(
        BankAccount.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.bank_accounts.read"),
        )
        .order_by("name")
        .values(
            "id",
            "name",
            "bank_name",
            "account_number",
            "account_holder",
            "is_cash",
            "is_petty_cash",
            "is_active",
        )
    )


@router.post("/bank-accounts", response=BankAccountResponse)
def create_bank_account(request: HttpRequest, payload: BankAccountPayload):
    tenant_id = _tenant_id_for(request, "masterdata.bank_accounts.create")
    account = BankAccount.objects.create(tenant_id=tenant_id, **payload.dict())
    return account


@router.put("/bank-accounts/{account_id}", response=BankAccountResponse)
def update_bank_account(
    request: HttpRequest, account_id: str, payload: BankAccountPayload
):
    tenant_id = _tenant_id_for(request, "masterdata.bank_accounts.update")
    account = _get_tenant_object(BankAccount, tenant_id, account_id, "Rekening")
    for attr, value in payload.dict().items():
        setattr(account, attr, value)
    account.save()
    return account


@router.delete(
    "/bank-accounts/{account_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_bank_account(request: HttpRequest, account_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.bank_accounts.delete")
    account = _get_tenant_object(BankAccount, tenant_id, account_id, "Rekening")
    return _delete_object(
        account,
        success="Rekening berhasil dihapus.",
        protected="Rekening masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/bank-accounts/{account_id}/activate", response=BankAccountResponse)
def activate_bank_account(request: HttpRequest, account_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.bank_accounts.activate")
    return _set_active(
        _get_tenant_object(BankAccount, tenant_id, account_id, "Rekening"), True
    )


@router.post("/bank-accounts/{account_id}/deactivate", response=BankAccountResponse)
def deactivate_bank_account(request: HttpRequest, account_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.bank_accounts.deactivate")
    return _set_active(
        _get_tenant_object(BankAccount, tenant_id, account_id, "Rekening"), False
    )


class CostCategoryPayload(Schema):
    code: str
    name: str
    allocation_basis: str = CostCategory.AllocationBasis.QUANTITY
    expense_account_id: Optional[UUID] = None
    is_active: bool = True


class CostCategoryResponse(Schema):
    id: UUID
    code: str
    name: str
    allocation_basis: str
    expense_account_id: Optional[UUID] = None
    is_active: bool


@router.get("/cost-categories", response=List[CostCategoryResponse])
def list_cost_categories(request: HttpRequest):
    return list(
        CostCategory.objects.filter(
            tenant_id=_tenant_id_for(request, "masterdata.cost_categories.read")
        )
        .order_by("code")
        .values(
            "id", "code", "name", "allocation_basis", "expense_account_id", "is_active"
        )
    )


@router.post("/cost-categories", response=CostCategoryResponse)
def create_cost_category(request: HttpRequest, payload: CostCategoryPayload):
    return CostCategory.objects.create(
        tenant_id=_tenant_id_for(request, "masterdata.cost_categories.create"),
        **payload.dict(),
    )


@router.put("/cost-categories/{category_id}", response=CostCategoryResponse)
def update_cost_category(
    request: HttpRequest, category_id: str, payload: CostCategoryPayload
):
    tenant_id = _tenant_id_for(request, "masterdata.cost_categories.update")
    category = _get_tenant_object(
        CostCategory, tenant_id, category_id, "Kategori biaya"
    )
    for attr, value in payload.dict().items():
        setattr(category, attr, value)
    category.save()
    return category


@router.delete(
    "/cost-categories/{category_id}",
    response={200: DetailResponse, 409: DetailResponse},
)
def delete_cost_category(request: HttpRequest, category_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.cost_categories.delete")
    category = _get_tenant_object(
        CostCategory, tenant_id, category_id, "Kategori biaya"
    )
    return _delete_object(
        category,
        success="Kategori biaya berhasil dihapus.",
        protected="Kategori biaya masih digunakan dan tidak dapat dihapus.",
    )


@router.post("/cost-categories/{category_id}/activate", response=CostCategoryResponse)
def activate_cost_category(request: HttpRequest, category_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.cost_categories.activate")
    return _set_active(
        _get_tenant_object(CostCategory, tenant_id, category_id, "Kategori biaya"), True
    )


@router.post("/cost-categories/{category_id}/deactivate", response=CostCategoryResponse)
def deactivate_cost_category(request: HttpRequest, category_id: str):
    tenant_id = _tenant_id_for(request, "masterdata.cost_categories.deactivate")
    return _set_active(
        _get_tenant_object(CostCategory, tenant_id, category_id, "Kategori biaya"),
        False,
    )
