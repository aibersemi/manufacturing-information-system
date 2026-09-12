import { TestBed } from '@angular/core/testing';
import { StorageService, DEFAULT_STORAGE_BUCKET } from './storage.service';
import { SupabaseService } from './supabase.service';

describe('StorageService', () => {
  let service: StorageService;
  let supabaseService: SupabaseService;

  const mockStorageFrom = {
    upload: vi.fn(),
    createSignedUrl: vi.fn(),
    getPublicUrl: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StorageService, SupabaseService],
    });
    service = TestBed.inject(StorageService);
    supabaseService = TestBed.inject(SupabaseService);

    vi.spyOn(supabaseService.client.storage, 'from').mockReturnValue(mockStorageFrom as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('uploadFile', () => {
    it('should upload a file with auto-generated path and sanitized name', async () => {
      const mockFile = new File(['test content'], 'sample file (v1).png', { type: 'image/png' });
      mockStorageFrom.upload.mockResolvedValue({
        data: { path: 'qc/123-sample_file__v1_.png', id: 'obj-123', fullPath: 'manufacturing-media/qc/123' },
        error: null,
      });

      const result = await service.uploadFile(mockFile, undefined, { folder: 'qc' });

      expect(supabaseService.client.storage.from).toHaveBeenCalledWith(DEFAULT_STORAGE_BUCKET);
      expect(mockStorageFrom.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^qc\/\d+-sample_file__v1_\.png$/),
        mockFile,
        { upsert: false, contentType: 'image/png' }
      );
      expect(result.path).toBe('qc/123-sample_file__v1_.png');
      expect(result.id).toBe('obj-123');
    });

    it('should use explicitly specified path and custom bucket when provided', async () => {
      const mockBlob = new Blob(['sample data'], { type: 'application/pdf' });
      mockStorageFrom.upload.mockResolvedValue({
        data: { path: 'manuals/sop-01.pdf', id: 'obj-456', fullPath: 'custom-bucket/manuals/sop-01.pdf' },
        error: null,
      });

      const result = await service.uploadFile(mockBlob, 'sop-01.pdf', {
        path: 'manuals/sop-01.pdf',
        bucket: 'custom-bucket',
        upsert: true,
        contentType: 'application/pdf',
      });

      expect(supabaseService.client.storage.from).toHaveBeenCalledWith('custom-bucket');
      expect(mockStorageFrom.upload).toHaveBeenCalledWith('manuals/sop-01.pdf', mockBlob, {
        upsert: true,
        contentType: 'application/pdf',
      });
      expect(result.path).toBe('manuals/sop-01.pdf');
    });

    it('should throw an error when upload fails', async () => {
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      mockStorageFrom.upload.mockResolvedValue({
        data: null,
        error: { message: 'Entity too large' },
      });

      await expect(service.uploadFile(mockFile)).rejects.toThrow('Upload file gagal: Entity too large');
    });
  });

  describe('getSignedUrl', () => {
    it('should return a signed URL when successful', async () => {
      mockStorageFrom.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://supabase.local/storage/sign/file.png?token=xyz' },
        error: null,
      });

      const url = await service.getSignedUrl('qc/sample.png', 7200);

      expect(mockStorageFrom.createSignedUrl).toHaveBeenCalledWith('qc/sample.png', 7200);
      expect(url).toBe('https://supabase.local/storage/sign/file.png?token=xyz');
    });

    it('should throw an error if signed URL generation fails', async () => {
      mockStorageFrom.createSignedUrl.mockResolvedValue({
        data: null,
        error: { message: 'Object not found' },
      });

      await expect(service.getSignedUrl('nonexistent.png')).rejects.toThrow('Gagal membuat signed URL: Object not found');
    });
  });

  describe('getPublicUrl', () => {
    it('should return the public URL', () => {
      mockStorageFrom.getPublicUrl.mockReturnValue({
        data: { publicUrl: 'https://supabase.local/storage/public/test.jpg' },
      });

      const url = service.getPublicUrl('test.jpg');

      expect(mockStorageFrom.getPublicUrl).toHaveBeenCalledWith('test.jpg');
      expect(url).toBe('https://supabase.local/storage/public/test.jpg');
    });
  });

  describe('downloadFile', () => {
    it('should return a Blob when download succeeds', async () => {
      const mockBlob = new Blob(['downloaded data'], { type: 'image/png' });
      mockStorageFrom.download.mockResolvedValue({
        data: mockBlob,
        error: null,
      });

      const blob = await service.downloadFile('qc/file.png');

      expect(mockStorageFrom.download).toHaveBeenCalledWith('qc/file.png');
      expect(blob).toBe(mockBlob);
    });

    it('should throw an error when download fails', async () => {
      mockStorageFrom.download.mockResolvedValue({
        data: null,
        error: { message: 'Not Found' },
      });

      await expect(service.downloadFile('missing.png')).rejects.toThrow('Gagal mengunduh file: Not Found');
    });
  });

  describe('deleteFiles', () => {
    it('should delete specified files', async () => {
      mockStorageFrom.remove.mockResolvedValue({
        data: [{ name: 'file1.png' }, { name: 'file2.png' }],
        error: null,
      });

      await service.deleteFiles(['file1.png', 'file2.png']);

      expect(mockStorageFrom.remove).toHaveBeenCalledWith(['file1.png', 'file2.png']);
    });

    it('should throw an error when deletion fails', async () => {
      mockStorageFrom.remove.mockResolvedValue({
        data: null,
        error: { message: 'Permission denied' },
      });

      await expect(service.deleteFiles(['file1.png'])).rejects.toThrow('Gagal menghapus file: Permission denied');
    });
  });

  describe('listFiles', () => {
    it('should list files in directory', async () => {
      const mockFiles = [
        { id: '1', name: 'sop1.pdf', created_at: '2026-09-13T00:00:00Z' },
        { id: '2', name: 'sop2.pdf', created_at: '2026-09-13T01:00:00Z' },
      ];
      mockStorageFrom.list.mockResolvedValue({
        data: mockFiles,
        error: null,
      });

      const files = await service.listFiles('sop', { limit: 10 });

      expect(mockStorageFrom.list).toHaveBeenCalledWith('sop', { limit: 10 });
      expect(files).toEqual(mockFiles);
    });

    it('should throw an error when listing fails', async () => {
      mockStorageFrom.list.mockResolvedValue({
        data: null,
        error: { message: 'Directory error' },
      });

      await expect(service.listFiles('invalid')).rejects.toThrow('Gagal memuat daftar file: Directory error');
    });
  });
});
