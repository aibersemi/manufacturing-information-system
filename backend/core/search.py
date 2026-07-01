"""
Utilitas sinkronisasi search projection ke Meilisearch.

PostgreSQL tetap menjadi sumber kebenaran. Semua dokumen di modul ini adalah
proyeksi read-only yang dapat dibangun ulang kapan pun dari ORM.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from django.apps import apps
from django.conf import settings
from django.db.models import Model, QuerySet
from meilisearch import Client
from meilisearch.errors import (
    MeilisearchApiError,
    MeilisearchCommunicationError,
    MeilisearchError,
    MeilisearchTimeoutError,
)


class SearchIndexError(RuntimeError):
    """Error saat komunikasi dengan Meilisearch."""


class SearchIndexPermissionError(SearchIndexError):
    """API key Meilisearch hilang atau tidak punya izin indexing."""


@dataclass(frozen=True)
class SearchIndex:
    uid: str
    model_label: str
    serializer: Callable[[Model], dict[str, Any]]

    def queryset(self) -> QuerySet:
        return apps.get_model(self.model_label).objects.all()


def _customer_document(instance: Model) -> dict[str, Any]:
    return {
        "id": str(instance.id),
        "tenant_id": instance.tenant_id,
        "name": instance.name,
        "phone": instance.phone,
        "email": instance.email,
        "is_active": instance.is_active,
    }


def _material_document(instance: Model) -> dict[str, Any]:
    return {
        "id": str(instance.id),
        "tenant_id": instance.tenant_id,
        "code": instance.code,
        "name": instance.name,
        "is_active": instance.is_active,
    }


def _sales_po_document(instance: Model) -> dict[str, Any]:
    return {
        "id": str(instance.id),
        "tenant_id": instance.tenant_id,
        "po_number": instance.po_number,
        "customer_id": str(instance.customer_id),
        "order_date": instance.order_date.isoformat(),
        "due_date": instance.due_date.isoformat() if instance.due_date else None,
        "status": instance.status,
    }


def _production_order_document(instance: Model) -> dict[str, Any]:
    return {
        "id": str(instance.id),
        "tenant_id": instance.tenant_id,
        "order_number": instance.order_number,
        "order_type": instance.order_type,
        "product_variant_id": str(instance.product_variant_id),
        "target_quantity": instance.target_quantity,
        "status": instance.status,
    }


SEARCH_INDEXES: dict[str, SearchIndex] = {
    "customers": SearchIndex("customers", "masterdata.Customer", _customer_document),
    "materials": SearchIndex("materials", "masterdata.Material", _material_document),
    "sales_po": SearchIndex("sales_po", "sales.SalesPO", _sales_po_document),
    "production_order": SearchIndex(
        "production_order",
        "production.ProductionOrder",
        _production_order_document,
    ),
}

MODEL_INDEX_UIDS = {index.model_label: index.uid for index in SEARCH_INDEXES.values()}


def get_index_for_instance(instance: Model) -> SearchIndex | None:
    model_label = instance._meta.label
    index_uid = MODEL_INDEX_UIDS.get(model_label)
    if index_uid is None:
        return None
    return SEARCH_INDEXES[index_uid]


def build_outbox_payload(instance: Model, action: str) -> dict[str, Any] | None:
    index = get_index_for_instance(instance)
    if index is None:
        return None

    if action == "delete":
        data = {"id": str(instance.id)}
    else:
        data = index.serializer(instance)

    return {
        "index": index.uid,
        "action": action,
        "data": data,
    }


def iter_index_documents(index_uid: str) -> Iterable[dict[str, Any]]:
    index = SEARCH_INDEXES[index_uid]
    for instance in index.queryset().iterator(chunk_size=500):
        yield index.serializer(instance)


def get_index_count(index_uid: str) -> int:
    return SEARCH_INDEXES[index_uid].queryset().count()


def _meilisearch_headers() -> dict[str, str]:
    return {"Content-Type": "application/json"}


def _meilisearch_client(*, timeout: int = 10) -> Client:
    base_url = settings.MEILISEARCH_URL.rstrip("/")
    api_key = settings.MEILISEARCH_API_KEY or None
    return Client(
        base_url,
        api_key,
        timeout=timeout,
        custom_headers=_meilisearch_headers(),
    )


def _meilisearch_index(index_uid: str, *, timeout: int = 10):
    return _meilisearch_client(timeout=timeout).index(index_uid)


def _run_meilisearch(
    operation: Callable[[], Any],
    *,
    path: str,
) -> Any:
    try:
        return operation()
    except MeilisearchApiError as exc:
        if exc.status_code == 404:
            raise FileNotFoundError(path) from exc
        if exc.status_code in {401, 403}:
            raise SearchIndexPermissionError(
                "Meilisearch menolak request. Pastikan MEILISEARCH_API_KEY "
                "diisi dengan key yang punya izin indexing/reindex."
            ) from exc
        raise SearchIndexError(f"Meilisearch HTTP {exc.status_code}: {path}") from exc
    except (MeilisearchCommunicationError, MeilisearchTimeoutError) as exc:
        raise SearchIndexError(f"Meilisearch tidak dapat dihubungi: {exc}") from exc
    except MeilisearchError as exc:
        raise SearchIndexError(f"Meilisearch error: {exc}") from exc


def upsert_document(index_uid: str, document: dict[str, Any]) -> None:
    path = f"/indexes/{index_uid}/documents"
    index = _meilisearch_index(index_uid)
    _run_meilisearch(
        lambda: index.add_documents([document]),
        path=path,
    )


def delete_document(index_uid: str, document_id: str) -> None:
    path = f"/indexes/{index_uid}/documents/{document_id}"
    index = _meilisearch_index(index_uid)
    try:
        _run_meilisearch(lambda: index.delete_document(document_id), path=path)
    except FileNotFoundError:
        return


def delete_all_documents(index_uid: str) -> None:
    path = f"/indexes/{index_uid}/documents"
    index = _meilisearch_index(index_uid)
    try:
        _run_meilisearch(index.delete_all_documents, path=path)
    except FileNotFoundError:
        return


def upsert_documents(index_uid: str, documents: list[dict[str, Any]]) -> None:
    if not documents:
        return
    path = f"/indexes/{index_uid}/documents"
    index = _meilisearch_index(index_uid, timeout=30)
    _run_meilisearch(
        lambda: index.add_documents(documents),
        path=path,
    )


def configure_index(index_uid: str) -> None:
    """Tenant identifier wajib filterable sebelum indeks boleh dipakai."""

    path = f"/indexes/{index_uid}/settings/filterable-attributes"
    index = _meilisearch_index(index_uid)
    _run_meilisearch(
        lambda: index.update_filterable_attributes(["tenant_id"]),
        path=path,
    )


def get_meilisearch_document_count(index_uid: str) -> int | None:
    path = f"/indexes/{index_uid}/stats"
    index = _meilisearch_index(index_uid)
    try:
        stats = _run_meilisearch(index.get_stats, path=path)
    except FileNotFoundError:
        return None
    return int(stats.number_of_documents)


def apply_search_event(payload: dict[str, Any]) -> None:
    index_uid = payload.get("index")
    action = payload.get("action")
    data = payload.get("data")

    if not index_uid or index_uid not in SEARCH_INDEXES:
        return
    if not isinstance(data, dict):
        return

    if action == "upsert":
        upsert_document(index_uid, data)
    elif action == "delete":
        document_id = data.get("id")
        if document_id:
            delete_document(index_uid, str(document_id))


def search_documents(
    index_uid: str, *, tenant_id: int, query: str, limit: int = 20
) -> list[dict[str, Any]]:
    """Cari proyeksi read-only dengan filter tenant yang tidak dapat dioverride client."""

    if index_uid not in SEARCH_INDEXES:
        raise ValueError("Indeks pencarian tidak dikenal.")
    payload = {
        "q": query[:200],
        "filter": f"tenant_id = {int(tenant_id)}",
        "limit": min(max(limit, 1), 100),
    }
    path = f"/indexes/{index_uid}/search"
    index = _meilisearch_index(index_uid)
    search_params = {"filter": payload["filter"], "limit": payload["limit"]}
    result = _run_meilisearch(
        lambda: index.search(payload["q"], search_params),
        path=path,
    )
    hits = result.get("hits", [])
    return [hit for hit in hits if hit.get("tenant_id") == tenant_id]
