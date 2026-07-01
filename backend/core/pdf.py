"""Generator PDF A4 sederhana tanpa dependency eksternal untuk dokumen bisnis V1."""

from __future__ import annotations


def _escape_pdf_text(value: object) -> str:
    return (
        str(value)
        .encode("latin-1", errors="replace")
        .decode("latin-1")
        .replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )


def a4_document(title: str, lines: list[str]) -> bytes:
    """Buat PDF A4 satu halaman; cukup untuk surat jalan/invoice teks V1."""
    commands = ["BT", "/F1 16 Tf", "50 790 Td", f"({_escape_pdf_text(title)}) Tj"]
    for line in lines[:42]:
        commands.extend(("0 -17 Td", "/F1 10 Tf", f"({_escape_pdf_text(line)}) Tj"))
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1")
    page_object = b" ".join(
        [
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]",
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        ]
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        page_object,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + b" >>\nstream\n"
        + stream
        + b"\nendstream",
    ]
    payload = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(payload))
        payload.extend(f"{index} 0 obj\n".encode())
        payload.extend(obj)
        payload.extend(b"\nendobj\n")
    xref = len(payload)
    payload.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    payload.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        payload.extend(f"{offset:010d} 00000 n \n".encode())
    payload.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(payload)
