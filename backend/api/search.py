from django.http import HttpRequest
from ninja import Router, Schema
from ninja.errors import HttpError

from backend.core.access import get_tenant_context, tenant_session_auth
from backend.core.search import SearchIndexError, search_documents

router = Router(tags=["Search"], auth=tenant_session_auth)


class SearchResponse(Schema):
    index: str
    items: list[dict]


@router.get("/", response=SearchResponse)
def search(request: HttpRequest, q: str, index: str = "customers", limit: int = 20):
    context = get_tenant_context(request)
    try:
        items = search_documents(
            index, tenant_id=context.tenant_id, query=q, limit=limit
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    except SearchIndexError as exc:
        raise HttpError(503, "Indeks pencarian sedang tidak tersedia") from exc
    return {"index": index, "items": items}
