/**
 * Memvalidasi dan menyaring URL agar hanya mengizinkan internal relative path.
 * Mencegah serangan Open Redirect (misal: protocol-relative //, backslash \, skema eksternal).
 *
 * @param url URL yang ingin divalidasi
 * @param fallback URL rute internal cadangan jika url tidak valid (default: '/')
 * @returns Relative URL yang aman
 */
export function getSafeReturnUrl(url: string | null | undefined, fallback = '/'): string {
  if (!url || typeof url !== 'string') {
    return fallback;
  }

  // Larang karakter kontrol (ASCII 0-31 dan 127)
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return fallback;
    }
  }

  const trimmed = url.trim();

  // Wajib diawali dengan slash tunggal '/'
  if (!trimmed.startsWith('/')) {
    return fallback;
  }

  // Larang protocol-relative URL ('//') dan backslash ('\')
  if (trimmed.startsWith('//') || trimmed.includes('\\')) {
    return fallback;
  }

  return trimmed;
}
