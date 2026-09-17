import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize, take } from 'rxjs';

import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { AdminCategory, AdministrationDataAccess } from '../data-access/administration-data-access';

export interface CategoryDialogResult {
  readonly category?: AdminCategory;
  readonly notFound?: true;
}

@Component({
  selector: 'app-category-form-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './category-form-dialog.html',
  styleUrl: './category-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryFormDialog {
  private readonly administration = inject(AdministrationDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef<CategoryFormDialog, CategoryDialogResult>);
  protected readonly category = inject<AdminCategory | null>(MAT_DIALOG_DATA);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly nameServerError = signal<string | null>(null);
  protected readonly form = new FormGroup({
    name: new FormControl(this.category?.name ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    description: new FormControl(this.category?.description ?? '', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });

  constructor() {
    this.form.controls.name.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.clearNameError());
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.errorMessage.set(null));
  }

  protected unchanged(): boolean {
    if (!this.category) return false;
    const value = this.form.getRawValue();
    return (
      value.name.trim() === this.category.name &&
      (value.description.trim() || null) === this.category.description
    );
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting() || this.unchanged()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const request = { name: value.name.trim(), description: value.description.trim() || null };
    const operation = this.category
      ? this.administration.updateCategory(this.category.id, request)
      : this.administration.createCategory(request);
    this.submitting.set(true);
    this.errorMessage.set(null);
    operation
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false)),
      )
      .subscribe({
        next: (category) => this.dialogRef.close({ category }),
        error: (error: unknown) => this.handleError(normalizeHttpError(error)),
      });
  }

  private handleError(error: AppError): void {
    if (error.code === 'CATEGORY_ALREADY_EXISTS') {
      this.nameServerError.set('A category with this name already exists.');
      this.form.controls.name.setErrors({ ...this.form.controls.name.errors, server: true });
      return;
    }
    if (error.kind === 'validation') {
      const nameError = error.validationErrors.find((item) => item.field === 'name');
      if (nameError) {
        this.nameServerError.set(nameError.message);
        this.form.controls.name.setErrors({ ...this.form.controls.name.errors, server: true });
        return;
      }
    }
    if (error.kind === 'not-found') {
      this.dialogRef.close({ notFound: true });
      return;
    }
    this.errorMessage.set(
      error.kind === 'network'
        ? 'PulseDesk could not be reached. Try again.'
        : error.kind === 'unavailable'
          ? 'Category management is temporarily unavailable.'
          : 'The category could not be saved. Review the details and try again.',
    );
  }

  private clearNameError(): void {
    this.nameServerError.set(null);
    const control = this.form.controls.name;
    if (control.hasError('server')) {
      const remaining = { ...control.errors };
      delete remaining['server'];
      control.setErrors(Object.keys(remaining).length ? remaining : null);
    }
  }
}
