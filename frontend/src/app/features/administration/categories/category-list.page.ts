import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { catchError, filter, finalize, map, of, startWith, Subject, switchMap, take } from 'rxjs';

import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from '../confirmation-dialog.component';
import { AdminCategory, AdministrationDataAccess } from '../data-access/administration-data-access';
import { CategoryDialogResult, CategoryFormDialog } from './category-form-dialog';

type CategoryListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: AppError }
  | {
      readonly kind: 'loaded' | 'refreshing';
      readonly items: readonly AdminCategory[];
      readonly refreshError?: AppError;
    };

@Component({
  selector: 'app-category-list-page',
  imports: [
    LocalDateTimePipe,
    NgTemplateOutlet,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatProgressBarModule,
    PageMessageComponent,
  ],
  templateUrl: './category-list.page.html',
  styleUrl: './category-list.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryListPage {
  private readonly administration = inject(AdministrationDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly loadRequests = new Subject<void>();

  protected readonly includeInactive = signal(false);
  protected readonly state = signal<CategoryListState>({ kind: 'loading' });
  protected readonly mutatingCategoryId = signal<number | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);

  constructor() {
    this.loadRequests
      .pipe(
        startWith(undefined),
        map(() => this.includeInactive()),
        switchMap((includeInactive) => {
          this.beginLoad();
          return this.administration.listCategories(includeInactive).pipe(
            map((items) => ({ ok: true as const, items })),
            catchError((error: unknown) =>
              of({ ok: false as const, error: normalizeHttpError(error) }),
            ),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (result.ok) {
          this.state.set({ kind: 'loaded', items: result.items });
        } else {
          const current = this.state();
          this.state.set(
            current.kind === 'loaded' || current.kind === 'refreshing'
              ? { ...current, kind: 'loaded', refreshError: result.error }
              : { kind: 'error', error: result.error },
          );
        }
      });
  }

  protected toggleInactive(checked: boolean): void {
    this.includeInactive.set(checked);
    this.loadRequests.next();
  }

  protected retry(): void {
    this.loadRequests.next();
  }

  protected openForm(category: AdminCategory | null = null): void {
    this.dialog
      .open(CategoryFormDialog, {
        data: category,
        width: '38rem',
        maxWidth: '96vw',
        restoreFocus: true,
      })
      .afterClosed()
      .pipe(
        filter((result): result is CategoryDialogResult => Boolean(result)),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.actionError.set(
          result.notFound ? 'That category no longer exists. The list was refreshed.' : null,
        );
        if (result.category) {
          this.successMessage.set(
            `${result.category.name} was ${category ? 'updated' : 'created'}.`,
          );
        }
        this.loadRequests.next();
      });
  }

  protected requestActivationChange(category: AdminCategory): void {
    if (this.mutatingCategoryId() !== null) return;
    if (!category.isActive) {
      this.changeActivation(category, true);
      return;
    }
    const data: ConfirmationDialogData = {
      title: `Deactivate ${category.name}?`,
      message:
        'Existing tickets retain this category, but it will disappear from new-ticket and category-change selectors.',
      confirmLabel: 'Deactivate',
    };
    this.dialog
      .open(ConfirmationDialogComponent, { data, width: '30rem', restoreFocus: true })
      .afterClosed()
      .pipe(filter(Boolean), take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.changeActivation(category, false));
  }

  protected errorTitle(error: AppError): string {
    if (error.kind === 'forbidden') return 'Administration access is required';
    if (error.kind === 'network') return 'PulseDesk could not be reached';
    if (error.kind === 'unavailable') return 'Categories are temporarily unavailable';
    return 'Categories could not be loaded';
  }

  private changeActivation(category: AdminCategory, isActive: boolean): void {
    this.mutatingCategoryId.set(category.id);
    this.actionError.set(null);
    this.successMessage.set(null);
    this.administration
      .updateCategory(category.id, { is_active: isActive })
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.mutatingCategoryId.set(null)),
      )
      .subscribe({
        next: (updated) => {
          this.applyAuthoritativeCategory(updated);
          this.successMessage.set(
            `${updated.name} was ${isActive ? 'reactivated' : 'deactivated'}.`,
          );
          this.loadRequests.next();
        },
        error: (error: unknown) => {
          const normalized = normalizeHttpError(error);
          if (normalized.kind === 'not-found') this.loadRequests.next();
          this.actionError.set(
            normalized.kind === 'not-found'
              ? 'That category no longer exists. The list is being refreshed.'
              : normalized.kind === 'network'
                ? 'The category change could not reach PulseDesk. Try again.'
                : normalized.kind === 'unavailable'
                  ? 'Category management is temporarily unavailable.'
                  : 'The category change could not be completed. Try again.',
          );
        },
      });
  }

  private applyAuthoritativeCategory(updated: AdminCategory): void {
    const current = this.state();
    if (current.kind !== 'loaded' && current.kind !== 'refreshing') return;
    const items = current.items
      .map((item) => (item.id === updated.id ? updated : item))
      .filter((item) => this.includeInactive() || item.isActive);
    this.state.set({
      ...current,
      kind: 'loaded',
      items,
    });
  }

  private beginLoad(): void {
    const current = this.state();
    this.state.set(
      current.kind === 'loaded' || current.kind === 'refreshing'
        ? { ...current, kind: 'refreshing', refreshError: undefined }
        : { kind: 'loading' },
    );
  }
}
