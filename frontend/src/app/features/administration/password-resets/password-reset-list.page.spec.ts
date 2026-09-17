import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../../api/generated/model/userRole';
import { AdministrationDataAccess } from '../data-access/administration-data-access';
import { PasswordResetListPage } from './password-reset-list.page';

const PAGE = {
  items: [
    {
      id: 12,
      requestedAt: new Date('2026-09-17T08:00:00Z'),
      user: {
        id: 7,
        email: 'alex@example.com',
        firstName: 'Alex',
        lastName: 'Morgan',
        role: UserRole.AGENT,
        isActive: true,
      },
    },
  ],
  page: 1,
  pageSize: 20,
  total: 21,
  totalPages: 2,
};

describe('PasswordResetListPage', () => {
  let fixture: ComponentFixture<PasswordResetListPage>;
  const params = new BehaviorSubject(convertToParamMap({ page: 1, pageSize: 20 }));
  const administration = { listPendingPasswordResets: vi.fn() };
  const dialog = { open: vi.fn() };
  const router = { navigate: vi.fn().mockResolvedValue(true) };

  beforeEach(async () => {
    vi.clearAllMocks();
    administration.listPendingPasswordResets.mockReturnValue(of(PAGE));
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
    TestBed.configureTestingModule({
      imports: [PasswordResetListPage],
      providers: [
        { provide: AdministrationDataAccess, useValue: administration },
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: Router, useValue: router },
      ],
    });
    TestBed.overrideProvider(MatDialog, { useValue: dialog });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(PasswordResetListPage);
    fixture.detectChanges();
  });

  it('renders the pending queue and pagination metadata', () => {
    expect(administration.listPendingPasswordResets).toHaveBeenCalledWith(1, 20);
    expect(fixture.nativeElement.textContent).toContain('Alex Morgan');
    expect(fixture.nativeElement.textContent).toContain('alex@example.com');
    expect(fixture.nativeElement.textContent).toContain('21 pending requests');
    expect(fixture.nativeElement.querySelector('mat-paginator')).not.toBeNull();
  });

  it('uses URL-backed pagination consistent with administration lists', () => {
    fixture.componentInstance['changePage']({ pageIndex: 1, pageSize: 20, length: 21 });

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { page: 2, pageSize: 20 },
    });
  });

  it('refreshes and reports contextual feedback after a successful reset', () => {
    dialog.open.mockReturnValue({
      afterClosed: () => of({ kind: 'resolved', userName: 'Alex Morgan' }),
    });
    const request = PAGE.items[0];

    fixture.componentInstance['openResetDialog'](request);
    fixture.detectChanges();

    expect(administration.listPendingPasswordResets).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain(
      "Alex Morgan's temporary password was set.",
    );
  });

  it('refreshes an already-resolved conflict without showing stale success', () => {
    dialog.open.mockReturnValue({ afterClosed: () => of({ kind: 'conflict' }) });

    fixture.componentInstance['openResetDialog'](PAGE.items[0]);
    fixture.detectChanges();

    expect(administration.listPendingPasswordResets).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain(
      'This request was already resolved. The pending queue was refreshed.',
    );
  });
});
