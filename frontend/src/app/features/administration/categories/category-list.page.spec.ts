import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AdminCategory, AdministrationDataAccess } from '../data-access/administration-data-access';
import { CategoryListPage } from './category-list.page';

const ACTIVE: AdminCategory = {
  id: 3,
  name: 'Hardware',
  description: 'Physical equipment',
  isActive: true,
  createdAt: new Date('2026-09-17T08:00:00Z'),
  updatedAt: new Date('2026-09-17T08:00:00Z'),
};
const INACTIVE: AdminCategory = { ...ACTIVE, id: 4, name: 'Legacy', isActive: false };

describe('CategoryListPage', () => {
  let fixture: ComponentFixture<CategoryListPage>;
  const administration = {
    listCategories: vi.fn<(_includeInactive: boolean) => Observable<readonly AdminCategory[]>>(),
    updateCategory: vi.fn(),
  };
  const dialog = { open: vi.fn() };

  async function render(withTemplate = false): Promise<void> {
    const testModule = TestBed.configureTestingModule({
      imports: [CategoryListPage],
      providers: [
        { provide: AdministrationDataAccess, useValue: administration },
        { provide: MatDialog, useValue: dialog },
      ],
    }).overrideProvider(MatDialog, { useValue: dialog });
    if (!withTemplate) testModule.overrideComponent(CategoryListPage, { set: { template: '' } });
    await testModule.compileComponents();
    fixture = TestBed.createComponent(CategoryListPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    administration.listCategories.mockReturnValue(of([ACTIVE]));
    administration.updateCategory.mockReturnValue(of(ACTIVE));
  });

  it('loads active categories initially and can show all categories', async () => {
    administration.listCategories.mockImplementation((includeInactive) =>
      of(includeInactive ? [ACTIVE, INACTIVE] : [ACTIVE]),
    );
    await render();

    expect(administration.listCategories).toHaveBeenNthCalledWith(1, false);
    fixture.componentInstance['toggleInactive'](true);
    expect(administration.listCategories).toHaveBeenNthCalledWith(2, true);
    const state = fixture.componentInstance['state']();
    if (state.kind === 'loaded') expect(state.items).toEqual([ACTIVE, INACTIVE]);
  });

  it.each([
    [null, { category: ACTIVE }, 'Hardware was created.'],
    [ACTIVE, { category: { ...ACTIVE, description: 'Updated' } }, 'Hardware was updated.'],
  ])('refreshes after create/edit dialog completion', async (category, result, message) => {
    dialog.open.mockReturnValue({ afterClosed: () => of(result) });
    await render();

    fixture.componentInstance['openForm'](category);

    expect(dialog.open).toHaveBeenCalledOnce();
    expect(administration.listCategories).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['successMessage']()).toBe(message);
  });

  it('confirms deactivation with ticket-retention and selector behavior', async () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    administration.updateCategory.mockReturnValue(of({ ...ACTIVE, isActive: false }));
    await render();

    fixture.componentInstance['requestActivationChange'](ACTIVE);

    const data = dialog.open.mock.calls[0][1].data;
    expect(data.title).toBe('Deactivate Hardware?');
    expect(data.message).toContain('Existing tickets retain this category');
    expect(data.message).toContain('new-ticket and category-change selectors');
    expect(administration.updateCategory).toHaveBeenCalledWith(ACTIVE.id, { is_active: false });
  });

  it('reactivates without confirmation and gates duplicate submission', async () => {
    const pending = new Subject<AdminCategory>();
    administration.updateCategory.mockReturnValue(pending);
    await render();

    fixture.componentInstance['requestActivationChange'](INACTIVE);
    fixture.componentInstance['requestActivationChange'](INACTIVE);

    expect(dialog.open).not.toHaveBeenCalled();
    expect(administration.updateCategory).toHaveBeenCalledOnce();
    expect(administration.updateCategory).toHaveBeenCalledWith(INACTIVE.id, { is_active: true });
  });

  it('retains confirmed mutation state when the following refresh fails', async () => {
    let calls = 0;
    administration.listCategories.mockImplementation(() =>
      calls++ === 0 ? of([ACTIVE]) : throwError(() => new Error('offline')),
    );
    administration.updateCategory.mockReturnValue(of({ ...ACTIVE, isActive: false }));
    await render();

    fixture.componentInstance['changeActivation'](ACTIVE, false);

    const state = fixture.componentInstance['state']();
    expect(state.kind).toBe('loaded');
    if (state.kind === 'loaded') {
      expect(state.items).toEqual([]);
      expect(state.refreshError).toBeDefined();
    }
    expect(fixture.componentInstance['successMessage']()).toContain('deactivated');
    expect(fixture.componentInstance['actionError']()).toBeNull();
  });

  it('closes stale form UI and refreshes after a dialog 404 result', async () => {
    dialog.open.mockReturnValue({ afterClosed: () => of({ notFound: true }) });
    await render();

    fixture.componentInstance['openForm'](ACTIVE);

    expect(fixture.componentInstance['actionError']()).toContain('no longer exists');
    expect(administration.listCategories).toHaveBeenCalledTimes(2);
  });

  it('refreshes a stale activation target after 404 without changing confirmed data', async () => {
    administration.updateCategory.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    await render();

    fixture.componentInstance['changeActivation'](ACTIVE, false);

    expect(administration.listCategories).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['actionError']()).toContain('no longer exists');
    const state = fixture.componentInstance['state']();
    if (state.kind === 'loaded') expect(state.items).toEqual([ACTIVE]);
  });

  it('retains confirmed data after a failed mutation', async () => {
    administration.updateCategory.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503 })),
    );
    await render();

    fixture.componentInstance['changeActivation'](ACTIVE, false);

    expect(administration.listCategories).toHaveBeenCalledOnce();
    const state = fixture.componentInstance['state']();
    if (state.kind === 'loaded') expect(state.items).toEqual([ACTIVE]);
    expect(fixture.componentInstance['actionError']()).toContain('temporarily unavailable');
  });

  it('offers the same edit/activation behavior in desktop and mobile without delete', async () => {
    await render(true);

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Delete');
    expect(text.match(/Edit/g)).toHaveLength(2);
    expect(text.match(/Deactivate/g)).toHaveLength(2);
  });
});
