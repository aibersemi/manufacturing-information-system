import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { ManualJournalsComponent } from './manual-journals.component';
import { FinanceService } from '../../../core/services/finance.service';

describe('ManualJournalsComponent', () => {
  let component: ManualJournalsComponent;
  let fixture: ComponentFixture<ManualJournalsComponent>;
  let mockFinanceService: any;

  beforeEach(async () => {
    mockFinanceService = {
      manualJournals: signal([
        {
          id: 'j-1',
          entryNumber: 'JU-202609-0001',
          transactionDate: '2026-09-13',
          entryType: 'manual',
          memo: 'Penyesuaian persediaan',
          description: 'Penyesuaian persediaan kain rusak',
          status: 'posted',
          reversalOfId: null,
          postedAt: '2026-09-13T10:00:00Z',
          lines: [
            {
              id: 'l-1',
              accountId: 'la-exp-1',
              accountCode: '5-1.1.01',
              accountName: 'Beban Kerusakan',
              debit: 500000,
              credit: 0,
              description: 'Kain rusak',
            },
            {
              id: 'l-2',
              accountId: 'la-ast-1',
              accountCode: '1-1.3.01',
              accountName: 'Persediaan Kain',
              debit: 0,
              credit: 500000,
              description: 'Pengurangan stok kain',
            },
          ],
        },
        {
          id: 'j-2',
          entryNumber: 'JU-202609-0002',
          transactionDate: '2026-09-12',
          entryType: 'manual',
          memo: 'Jurnal koreksi',
          description: 'Koreksi salah catat',
          status: 'reversed',
          reversalOfId: null,
          postedAt: '2026-09-12T10:00:00Z',
          lines: [
            {
              id: 'l-3',
              accountId: 'la-ast-1',
              accountCode: '1-1.3.01',
              accountName: 'Persediaan Kain',
              debit: 200000,
              credit: 0,
              description: 'Koreksi',
            },
            {
              id: 'l-4',
              accountId: 'la-exp-1',
              accountCode: '5-1.1.01',
              accountName: 'Beban Kerusakan',
              debit: 0,
              credit: 200000,
              description: 'Koreksi',
            },
          ],
        },
      ]),
      ledgerAccounts: signal([
        { id: 'la-ast-1', code: '1-1.3.01', name: 'Persediaan Kain', account_type: 'asset', is_active: true },
        { id: 'la-exp-1', code: '5-1.1.01', name: 'Beban Kerusakan', account_type: 'expense', is_active: true },
        { id: 'la-virt', code: '3-3.0.00', name: 'Laba Tahun Berjalan', account_type: 'equity', is_active: true }, // Virtual presentation
      ]),
      loading: signal(false),
      loadManualJournals: vi.fn().mockResolvedValue([]),
      loadLedgerAccounts: vi.fn().mockResolvedValue([]),
      postManualJournal: vi.fn().mockResolvedValue({ id: 'j-new' }),
      reverseManualJournal: vi.fn().mockResolvedValue({}),
    };

    await TestBed.configureTestingModule({
      imports: [ManualJournalsComponent],
      providers: [
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManualJournalsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create ManualJournalsComponent and compute KPIs (excluding virtual 3-3.0.00 in allowedAccounts)', () => {
    expect(component).toBeTruthy();
    expect(mockFinanceService.loadManualJournals).toHaveBeenCalled();
    expect(mockFinanceService.loadLedgerAccounts).toHaveBeenCalled();

    expect(component.allowedAccounts().length).toBe(2);
    expect(component.totalPostedJournalsCount()).toBe(1);
    expect(component.totalReversalsCount()).toBe(1);
    expect(component.totalMemorialValueThisMonth()).toBe(500000);
  });

  it('should filter manual journals by status and query', () => {
    expect(component.filteredJournals().length).toBe(2);

    component.statusFilter.set('posted');
    expect(component.filteredJournals().length).toBe(1);
    expect(component.filteredJournals()[0].id).toBe('j-1');

    component.statusFilter.set('reversed');
    expect(component.filteredJournals().length).toBe(1);
    expect(component.filteredJournals()[0].id).toBe('j-2');

    component.statusFilter.set('all');
    component.searchQuery.set('JU-202609-0001');
    expect(component.filteredJournals().length).toBe(1);
  });

  it('should manage dynamic rows and calculate real-time balance in form', () => {
    component.openCreateModal();
    expect(component.isCreateModalOpen()).toBe(true);
    expect(component.journalLines().length).toBe(2);

    component.addLine();
    expect(component.journalLines().length).toBe(3);

    component.removeLine(2);
    expect(component.journalLines().length).toBe(2);

    // Update lines to be balanced
    component.updateLine(0, { accountId: 'la-ast-1', debit: 350000 });
    component.updateLine(1, { accountId: 'la-exp-1', credit: 350000 });

    expect(component.totalFormDebit()).toBe(350000);
    expect(component.totalFormCredit()).toBe(350000);
    expect(component.isFormBalanced()).toBe(true);
  });

  it('should validate and post manual journal when balanced', async () => {
    component.openCreateModal();
    component.journalDescription.set('Penyesuaian stok');
    component.transactionDate.set('2026-09-13');
    component.updateLine(0, { accountId: 'la-ast-1', debit: 100000, description: 'Debit' });
    component.updateLine(1, { accountId: 'la-exp-1', credit: 100000, description: 'Kredit' });

    await component.submitJournal();
    expect(mockFinanceService.postManualJournal).toHaveBeenCalledWith({
      transactionDate: '2026-09-13',
      description: 'Penyesuaian stok',
      lines: [
        { account_id: 'la-ast-1', debit: 100000, credit: 0, description: 'Debit' },
        { account_id: 'la-exp-1', debit: 0, credit: 100000, description: 'Kredit' },
      ],
    });
    expect(component.isCreateModalOpen()).toBe(false);
    expect(component.successMessage()).toContain('berhasil diposting');
  });

  it('should reverse a posted journal', async () => {
    const journal = mockFinanceService.manualJournals()[0];
    component.openReverseModal(journal);
    expect(component.selectedJournalForReverse()).toBe(journal);

    // Empty reason
    component.reverseReason.set('');
    await component.submitReverse();
    expect(component.errorMessage()).toContain('Alasan pembalikan');

    // Valid reversal
    component.reverseReason.set('Koreksi salah input');
    await component.submitReverse();
    expect(mockFinanceService.reverseManualJournal).toHaveBeenCalledWith(
      'j-1',
      'Koreksi salah input'
    );
    expect(component.selectedJournalForReverse()).toBeNull();
    expect(component.successMessage()).toContain('berhasil dibalik');
  });
});
