import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface StorageUploadOptions {
  path?: string;
  folder?: string;
  upsert?: boolean;
  contentType?: string;
  bucket?: string;
}

export interface StorageListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: {
    column?: string;
    order?: 'asc' | 'desc';
  };
}

export interface StorageFileItem {
  id?: string;
  name: string;
  updated_at?: string;
  created_at?: string;
  last_accessed_at?: string;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_STORAGE_BUCKET = 'manufacturing-media';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly supabase = inject(SupabaseService);

  /**
   * Mengunggah file ke Supabase Storage.
   * Jika parameter `options.path` tidak disediakan, fungsi akan men-generate path unik
   * berdasarkan folder dan timestamp guna mencegah tabrakan nama file.
   */
  async uploadFile(
    file: File | Blob,
    fileName?: string,
    options?: StorageUploadOptions
  ): Promise<{ path: string; id?: string; fullPath?: string }> {
    const bucket = options?.bucket || DEFAULT_STORAGE_BUCKET;
    const resolvedName = fileName || (file instanceof File ? file.name : 'upload.bin');
    const sanitizedName = resolvedName.replace(/[^a-zA-Z0-9._-]/g, '_');

    let filePath: string;
    if (options?.path) {
      filePath = options.path;
    } else {
      const folderPrefix = options?.folder ? `${options.folder.replace(/\/+$/, '')}/` : '';
      const uniqueTimestamp = Date.now();
      filePath = `${folderPrefix}${uniqueTimestamp}-${sanitizedName}`;
    }

    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .upload(filePath, file, {
        upsert: options?.upsert ?? false,
        contentType: options?.contentType || (file instanceof File ? file.type : undefined),
      });

    if (error) {
      throw new Error(`Upload file gagal: ${error.message}`);
    }

    return {
      path: data.path,
      id: data.id,
      fullPath: data.fullPath,
    };
  }

  /**
   * Menghasilkan Signed URL sementara untuk mengakses file pada private bucket.
   * @param path Path relatif file di dalam bucket.
   * @param expiresInSeconds Masa berlaku URL dalam detik (default: 3600 / 1 jam).
   * @param bucket Nama bucket target (default: 'manufacturing-media').
   */
  async getSignedUrl(
    path: string,
    expiresInSeconds = 3600,
    bucket = DEFAULT_STORAGE_BUCKET
  ): Promise<string> {
    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(`Gagal membuat signed URL: ${error?.message || 'URL tidak ditemukan'}`);
    }

    return data.signedUrl;
  }

  /**
   * Mengambil URL publik file (hanya berlaku jika bucket diset sebagai public).
   */
  getPublicUrl(path: string, bucket = DEFAULT_STORAGE_BUCKET): string {
    const { data } = this.supabase.client.storage
      .from(bucket)
      .getPublicUrl(path);

    return data.publicUrl;
  }

  /**
   * Mengunduh file dari private bucket sebagai Blob biner.
   */
  async downloadFile(path: string, bucket = DEFAULT_STORAGE_BUCKET): Promise<Blob> {
    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .download(path);

    if (error || !data) {
      throw new Error(`Gagal mengunduh file: ${error?.message || 'Data kosong'}`);
    }

    return data;
  }

  /**
   * Menghapus satu atau lebih file dari bucket.
   */
  async deleteFiles(paths: string[], bucket = DEFAULT_STORAGE_BUCKET): Promise<void> {
    const { error } = await this.supabase.client.storage
      .from(bucket)
      .remove(paths);

    if (error) {
      throw new Error(`Gagal menghapus file: ${error.message}`);
    }
  }

  /**
   * Menampilkan daftar file dan folder dalam direktori bucket.
   */
  async listFiles(
    path = '',
    options?: StorageListOptions,
    bucket = DEFAULT_STORAGE_BUCKET
  ): Promise<StorageFileItem[]> {
    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .list(path, options);

    if (error) {
      throw new Error(`Gagal memuat daftar file: ${error.message}`);
    }

    return (data || []) as StorageFileItem[];
  }
}
