"""
Rebuild dan rekonsiliasi indeks Meilisearch dari PostgreSQL.
"""

from django.core.management.base import BaseCommand, CommandError

from backend.core.search import (
    SEARCH_INDEXES,
    SearchIndexError,
    SearchIndexPermissionError,
    configure_index,
    delete_all_documents,
    get_index_count,
    get_meilisearch_document_count,
    iter_index_documents,
    upsert_documents,
)


class Command(BaseCommand):
    help = "Rebuild atau cek konsistensi search projection Meilisearch."

    def add_arguments(self, parser):
        parser.add_argument(
            "--index",
            choices=sorted(SEARCH_INDEXES),
            help="Batasi operasi ke satu index.",
        )
        parser.add_argument(
            "--check-only",
            action="store_true",
            help="Hanya bandingkan jumlah dokumen PostgreSQL dan Meilisearch.",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=500,
            help="Jumlah dokumen per batch saat upsert.",
        )
        parser.add_argument(
            "--skip-if-permission-denied",
            action="store_true",
            help=(
                "Keluar sukses jika key Meilisearch belum punya izin indexing. "
                "Dipakai timer agar tidak gagal berulang saat secret belum siap."
            ),
        )

    def handle(self, *args, **options):
        batch_size = options["batch_size"]
        if batch_size < 1:
            raise CommandError("--batch-size minimal 1.")

        index_uids = [options["index"]] if options["index"] else sorted(SEARCH_INDEXES)
        mismatches: list[str] = []

        for index_uid in index_uids:
            source_count = get_index_count(index_uid)

            if options["check_only"]:
                try:
                    projected_count = get_meilisearch_document_count(index_uid)
                except SearchIndexPermissionError as exc:
                    if options["skip_if_permission_denied"]:
                        self.stdout.write(self.style.WARNING(str(exc)))
                        return
                    raise CommandError(str(exc)) from exc
                except SearchIndexError as exc:
                    raise CommandError(str(exc)) from exc
                if projected_count != source_count:
                    mismatches.append(
                        f"{index_uid}: postgres={source_count} "
                        f"meilisearch={projected_count}"
                    )
                self.stdout.write(
                    f"{index_uid}: postgres={source_count}, "
                    f"meilisearch={projected_count}"
                )
                continue

            self.stdout.write(f"Reindex {index_uid}: hapus dokumen lama.")
            try:
                configure_index(index_uid)
                delete_all_documents(index_uid)
            except SearchIndexPermissionError as exc:
                raise CommandError(str(exc)) from exc
            except SearchIndexError as exc:
                raise CommandError(str(exc)) from exc

            batch: list[dict] = []
            indexed_count = 0
            for document in iter_index_documents(index_uid):
                batch.append(document)
                if len(batch) >= batch_size:
                    try:
                        upsert_documents(index_uid, batch)
                    except SearchIndexPermissionError as exc:
                        raise CommandError(str(exc)) from exc
                    except SearchIndexError as exc:
                        raise CommandError(str(exc)) from exc
                    indexed_count += len(batch)
                    batch = []

            if batch:
                try:
                    upsert_documents(index_uid, batch)
                except SearchIndexPermissionError as exc:
                    raise CommandError(str(exc)) from exc
                except SearchIndexError as exc:
                    raise CommandError(str(exc)) from exc
                indexed_count += len(batch)

            self.stdout.write(
                self.style.SUCCESS(
                    f"Reindex {index_uid} selesai: {indexed_count} dokumen."
                )
            )

        if mismatches:
            raise CommandError(
                "Search projection tidak konsisten: " + "; ".join(mismatches)
            )
