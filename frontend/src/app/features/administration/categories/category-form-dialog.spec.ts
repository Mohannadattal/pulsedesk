import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AdminCategory, AdministrationDataAccess } from '../data-access/administration-data-access';
import { CategoryFormDialog } from './category-form-dialog';

const CATEGORY: AdminCategory = {
  id: 3,
  name: 'Hardware',
  description: 'Physical equipment',
  isActive: true,
  createdAt: new Date('2026-09-17T08:00:00Z'),
  updatedAt: new Date('2026-09-17T08:00:00Z'),
};

describe('CategoryFormDialog', () => {
  let fixture: ComponentFixture<CategoryFormDialog>;
  const administration = {
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
  };
  const dialogRef = { close: vi.fn() };

  async function render(category: AdminCategory | null = null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CategoryFormDialog],
      providers: [
        { provide: AdministrationDataAccess, useValue: administration },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: category },
      ],
    })
      .overrideComponent(CategoryFormDialog, { set: { template: '' } })
      .compileComponents();
    fixture = TestBed.createComponent(CategoryFormDialog);
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    administration.createCategory.mockReturnValue(of(CATEGORY));
    administration.updateCategory.mockReturnValue(of(CATEGORY));
  });

  it('creates a category with normalized optional description', async () => {
    await render();
    fixture.componentInstance['form'].setValue({ name: ' Hardware ', description: ' ' });

    fixture.componentInstance['submit']();

    expect(administration.createCategory).toHaveBeenCalledWith({
      name: 'Hardware',
      description: null,
    });
    expect(dialogRef.close).toHaveBeenCalledWith({ category: CATEGORY });
  });

  it('edits a changed category and prevents an unchanged edit', async () => {
    await render(CATEGORY);

    fixture.componentInstance['submit']();
    expect(fixture.componentInstance['unchanged']()).toBe(true);
    expect(administration.updateCategory).not.toHaveBeenCalled();

    fixture.componentInstance['form'].controls.description.setValue('Updated');
    fixture.componentInstance['submit']();
    expect(administration.updateCategory).toHaveBeenCalledWith(CATEGORY.id, {
      name: CATEGORY.name,
      description: 'Updated',
    });
  });

  it('maps a duplicate category conflict to the name field', async () => {
    administration.createCategory.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'CATEGORY_ALREADY_EXISTS', detail: 'Duplicate' },
          }),
      ),
    );
    await render();
    fixture.componentInstance['form'].setValue({ name: 'Hardware', description: '' });

    fixture.componentInstance['submit']();

    expect(fixture.componentInstance['form'].controls.name.hasError('server')).toBe(true);
    expect(fixture.componentInstance['nameServerError']()).toContain('already exists');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('closes stale edit UI on a concurrent 404', async () => {
    administration.updateCategory.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    await render(CATEGORY);
    fixture.componentInstance['form'].controls.description.setValue('Updated');

    fixture.componentInstance['submit']();

    expect(dialogRef.close).toHaveBeenCalledWith({ notFound: true });
  });

  it('gates duplicate submissions while retaining entered values', async () => {
    const pending = new Subject<AdminCategory>();
    administration.createCategory.mockReturnValue(pending);
    await render();
    fixture.componentInstance['form'].setValue({ name: 'Networking', description: 'Routers' });

    fixture.componentInstance['submit']();
    fixture.componentInstance['submit']();

    expect(administration.createCategory).toHaveBeenCalledOnce();
    expect(fixture.componentInstance['form'].getRawValue()).toEqual({
      name: 'Networking',
      description: 'Routers',
    });
  });
});
