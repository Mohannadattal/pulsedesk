import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap, take } from 'rxjs';

import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import {
  AdministrationDataAccess,
  AdminPasswordResetPage,
  AdminPasswordResetRequest,
} from '../data-access/administration-data-access';
import { ResetPasswordDialog, ResetPasswordDialogResult } from './reset-password-dialog';

type PasswordResetListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: AppError }
  | { readonly kind: 'loaded' | 'refreshing'; readonly page: AdminPasswordResetPage };

const PAGE_SIZES = [10, 20, 50] as const;

@Component({
  selector: 'app-password-reset-list-page',
  imports: [
    LocalDateTimePipe,
    MatButtonModule,
    MatDialogModule,
    MatPaginatorModule,
    MatProgressBarModule,
    NgTemplateOutlet,
    PageMessageComponent,
  ],
  templateUrl: './password-reset-list.page.html',
  styleUrl: './password-reset-list.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordResetListPage {
  private readonly administration = inject(AdministrationDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refreshRequests = new Subject<void>();

  protected readonly pageSizes = PAGE_SIZES;
  protected readonly state = signal<PasswordResetListState>({ kind: 'loading' });
  protected readonly successMessage = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  constructor() {
    combineLatest([
      this.route.queryParamMap.pipe(
        map((params) => ({
          page: positiveInteger(params.get('page'), 1),
          pageSize: pageSize(params.get('pageSize')),
        })),
      ),
      this.refreshRequests.pipe(startWith(undefined)),
    ])
      .pipe(
        switchMap(([filters]) => {
          this.beginLoad();
          return this.administration.listPendingPasswordResets(filters.page, filters.pageSize).pipe(
            map((page) => ({ page }) as const),
            catchError((error: unknown) => of({ error: normalizeHttpError(error) } as const)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if ('error' in result) {
          this.state.set({ kind: 'error', error: result.error });
        } else {
          this.state.set({ kind: 'loaded', page: result.page });
        }
      });
  }

  protected changePage(event: PageEvent): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        page: event.pageSize === this.currentPageSize() ? event.pageIndex + 1 : 1,
        pageSize: event.pageSize,
      },
    });
  }

  protected retry(): void {
    this.refreshRequests.next();
  }

  protected openResetDialog(request: AdminPasswordResetRequest): void {
    this.dialog
      .open<ResetPasswordDialog, AdminPasswordResetRequest, ResetPasswordDialogResult>(
        ResetPasswordDialog,
        { data: request, width: '38rem', maxWidth: '96vw', restoreFocus: true },
      )
      .afterClosed()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) return;
        this.refreshRequests.next();
        if (result.kind === 'resolved') {
          this.actionError.set(null);
          this.successMessage.set(
            `${result.userName}'s temporary password was set. They must replace it at next sign-in.`,
          );
        } else {
          this.successMessage.set(null);
          this.actionError.set(
            'This request was already resolved. The pending queue was refreshed.',
          );
        }
      });
  }

  protected errorTitle(error: AppError): string {
    if (error.kind === 'forbidden') return 'Administration access is required';
    if (error.kind === 'network') return 'PulseDesk could not be reached';
    if (error.kind === 'unavailable') return 'Password reset requests are temporarily unavailable';
    return 'Password reset requests could not be loaded';
  }

  private beginLoad(): void {
    const current = this.state();
    this.state.set(
      current.kind === 'loaded' || current.kind === 'refreshing'
        ? { ...current, kind: 'refreshing' }
        : { kind: 'loading' },
    );
  }

  private currentPageSize(): number {
    const current = this.state();
    return current.kind === 'loaded' || current.kind === 'refreshing' ? current.page.pageSize : 20;
  }
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageSize(value: string | null): number {
  const parsed = Number(value);
  return PAGE_SIZES.includes(parsed as (typeof PAGE_SIZES)[number]) ? parsed : 20;
}
