from dataclasses import dataclass

import pytest
from meilisearch.errors import MeilisearchApiError
from meilisearch.models.index import IndexStats

from backend.core import search


@dataclass
class _FakeResponse:
    status_code: int
    text: str


def _api_error(status_code: int) -> MeilisearchApiError:
    return MeilisearchApiError(
        "Meilisearch error",
        _FakeResponse(status_code, '{"message": "ditolak"}'),
    )


class _FakeIndex:
    def __init__(self):
        self.added_documents = None
        self.deleted_document_id = None
        self.deleted_all = False
        self.filterable_attributes = None
        self.search_query = None
        self.search_params = None
        self.error = None

    def _maybe_raise(self):
        if self.error:
            raise self.error

    def add_documents(self, documents):
        self._maybe_raise()
        self.added_documents = documents

    def delete_document(self, document_id):
        self._maybe_raise()
        self.deleted_document_id = document_id

    def delete_all_documents(self):
        self._maybe_raise()
        self.deleted_all = True

    def update_filterable_attributes(self, attributes):
        self._maybe_raise()
        self.filterable_attributes = attributes

    def get_stats(self):
        self._maybe_raise()
        return IndexStats(
            numberOfDocuments=7,
            isIndexing=False,
            fieldDistribution={"tenant_id": 7},
        )

    def search(self, query, params):
        self._maybe_raise()
        self.search_query = query
        self.search_params = params
        return {
            "hits": [
                {"id": "1", "tenant_id": 10, "name": "Toko A"},
                {"id": "2", "tenant_id": 11, "name": "Toko B"},
            ]
        }


@pytest.fixture
def fake_index(monkeypatch):
    index = _FakeIndex()
    monkeypatch.setattr(search, "_meilisearch_index", lambda *args, **kwargs: index)
    return index


def test_upsert_documents_memakai_sdk_index(fake_index):
    documents = [{"id": "1", "tenant_id": 10}]

    search.upsert_documents("customers", documents)

    assert fake_index.added_documents == documents


def test_configure_index_menetapkan_tenant_filterable(fake_index):
    search.configure_index("customers")

    assert fake_index.filterable_attributes == ["tenant_id"]


def test_get_meilisearch_document_count_membaca_stats_sdk(fake_index):
    assert search.get_meilisearch_document_count("customers") == 7


def test_search_documents_membatasi_tenant_dan_limit(fake_index):
    result = search.search_documents(
        "customers",
        tenant_id=10,
        query="a" * 250,
        limit=500,
    )

    assert result == [{"id": "1", "tenant_id": 10, "name": "Toko A"}]
    assert fake_index.search_query == "a" * 200
    assert fake_index.search_params == {"filter": "tenant_id = 10", "limit": 100}


def test_delete_document_mengabaikan_not_found(fake_index):
    fake_index.error = _api_error(404)

    search.delete_document("customers", "missing")

    assert fake_index.deleted_document_id is None


def test_permission_error_sdk_dinormalisasi(fake_index):
    fake_index.error = _api_error(403)

    with pytest.raises(search.SearchIndexPermissionError):
        search.upsert_document("customers", {"id": "1", "tenant_id": 10})
