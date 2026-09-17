import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, ParamMap, Params, Router } from '@angular/router';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  of,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
} from 'rxjs';

import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from '../confirmation-dialog.component';
import {
  AdministrationDataAccess,
  AdminUser,
  AdminUserPage,
} from '../data-access/administration-data-access';
import {
  ADMIN_PAGE_SIZES,
  adminUserFiltersToQueryParams,
  AdminUserFilters,
  parseAdminUserFilters,
  sameAdminUserFilters,
  USER_ROLES,
} from '../domain/admin-user-filters';
import { ProvisionUserDialog } from './provision-user-dialog';

type UserListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: AppError }
  | {
      readonly kind: 'loaded' | 'refreshing';
      readonly page: AdminUserPage;
      readonly filters: AdminUserFilters;
      readonly refreshError?: AppError;
    };

@Component({
  selector: 'app-user-list-page',
  imports: [
    LocalDateTimePipe,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    NgTemplateOutlet,
    PageMessageComponent,
    ReactiveFormsModule,
  ],
  templateUrl: './user-list.page.html',
  styleUrl: './user-list.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserListPage {
  private readonly administration = inject(AdministrationDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refreshRequests = new Subject<void>();
  private currentFilters = parseAdminUserFilters(this.route.snapshot.queryParamMap);
  private queryGeneration = 0;

  protected readonly session = inject(AuthSessionStore);
  protected readonly roles = USER_ROLES;
  protected readonly pageSizes = ADMIN_PAGE_SIZES;
  protected readonly state = signal<UserListState>({ kind: 'loading' });
  protected readonly mutatingUserId = signal<number | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly filterForm = new FormGroup({
    role: new FormControl<UserRole | ''>(this.currentFilters.role ?? '', { nonNullable: true }),
    active: new FormControl<'true' | 'false'>(this.currentFilters.isActive ? 'true' : 'false', {
      nonNullable: true,
    }),
  });

  constructor() {
    const filters = this.route.queryParamMap.pipe(
      map((params) => ({ parsed: parseAdminUserFilters(params), params })),
      tap(({ parsed, params }) => {
        const expected = adminUserFiltersToQueryParams(parsed);
        if (!this.hasCanonicalQuery(params, expected)) {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: expected,
            replaceUrl: true,
          });
        }
      }),
      map(({ parsed }) => parsed),
      distinctUntilChanged(sameAdminUserFilters),
      tap((value) => {
        this.queryGeneration += 1;
        this.currentFilters = value;
        this.filterForm.setValue(
          { role: value.role ?? '', active: value.isActive ? 'true' : 'false' },
          { emitEvent: false },
        );
      }),
    );

    combineLatest([filters, this.refreshRequests.pipe(startWith(undefined))])
      .pipe(
        map(([value]) => value),
        tap(() => this.beginLoad()),
        switchMap((value) =>
          this.administration.listUsers(value).pipe(
            map((page) => ({ ok: true as const, page, filters: value })),
            catchError((error: unknown) =>
              of({ ok: false as const, error: normalizeHttpError(error), filters: value }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (!result.ok) {
          const current = this.state();
          this.state.set(
            current.kind === 'loaded' || current.kind === 'refreshing'
              ? { ...current, kind: 'loaded', refreshError: result.error }
              : { kind: 'error', error: result.error },
          );
          return;
        }
        const maximumPage = Math.max(1, result.page.totalPages);
        if (result.filters.page > maximumPage) {
          this.navigate({ ...result.filters, page: maximumPage }, true);
          return;
        }
        this.state.set({ kind: 'loaded', page: result.page, filters: result.filters });
      });
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      ...this.currentFilters,
      role: value.role || undefined,
      isActive: value.active === 'true',
      page: 1,
    });
  }

  protected changePage(event: PageEvent): void {
    this.navigate({
      ...this.currentFilters,
      page: event.pageSize === this.currentFilters.pageSize ? event.pageIndex + 1 : 1,
      pageSize: event.pageSize,
    });
  }

  protected retry(): void {
    this.refreshRequests.next();
  }

  protected openProvisionDialog(): void {
    this.dialog
      .open(ProvisionUserDialog, { width: '42rem', maxWidth: '96vw', restoreFocus: true })
      .afterClosed()
      .pipe(
        filter((user): user is AdminUser => Boolean(user)),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((user) => {
        this.successMessage.set(`${user.firstName} ${user.lastName} was provisioned.`);
        this.actionError.set(null);
        this.refreshRequests.next();
      });
  }

  protected requestActivationChange(user: AdminUser): void {
    if (this.mutatingUserId() !== null || user.id === this.session.currentUser()?.id) return;
    if (user.isActive) {
      const message =
        user.role === UserRole.AGENT
          ? 'Existing assigned tickets remain assigned to this Agent and should be reassigned manually where necessary. The Agent will no longer appear in assignment selectors.'
          : `This prevents ${user.firstName} ${user.lastName} from signing in or using an existing session.`;
      const data: ConfirmationDialogData = {
        title: `Deactivate ${user.firstName} ${user.lastName}?`,
        message,
        confirmLabel: 'Deactivate',
      };
      this.dialog
        .open(ConfirmationDialogComponent, { data, width: '30rem', restoreFocus: true })
        .afterClosed()
        .pipe(filter(Boolean), take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.changeActivation(user, false));
      return;
    }
    this.changeActivation(user, true);
  }

  protected isSelf(user: AdminUser): boolean {
    return user.id === this.session.currentUser()?.id;
  }

  protected errorTitle(error: AppError): string {
    if (error.kind === 'forbidden') return 'Administration access is required';
    if (error.kind === 'network') return 'PulseDesk could not be reached';
    if (error.kind === 'unavailable') return 'User directory is temporarily unavailable';
    return 'Users could not be loaded';
  }

  private changeActivation(user: AdminUser, isActive: boolean): void {
    if (this.mutatingUserId() !== null) return;
    const origin = {
      generation: this.queryGeneration,
      filters: { ...this.currentFilters },
    } as const;
    this.mutatingUserId.set(user.id);
    this.actionError.set(null);
    this.successMessage.set(null);
    this.administration
      .updateUserActivation(user.id, isActive)
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.mutatingUserId.set(null)),
      )
      .subscribe({
        next: (updated) => {
          const originIsCurrent =
            origin.generation === this.queryGeneration &&
            sameAdminUserFilters(origin.filters, this.currentFilters);
          if (originIsCurrent) this.applyAuthoritativeUser(updated, origin.filters);
          this.successMessage.set(
            `${updated.firstName} ${updated.lastName} was ${isActive ? 'reactivated' : 'deactivated'}.`,
          );
          if (originIsCurrent) this.refreshRequests.next();
        },
        error: (error: unknown) => {
          const normalized = normalizeHttpError(error);
          if (normalized.kind === 'not-found') this.refreshRequests.next();
          this.actionError.set(this.activationError(normalized));
        },
      });
  }

  private applyAuthoritativeUser(updated: AdminUser, originFilters: AdminUserFilters): void {
    const current = this.state();
    if (current.kind !== 'loaded' && current.kind !== 'refreshing') return;
    if (!sameAdminUserFilters(current.filters, originFilters)) return;
    const remainsVisible =
      updated.isActive === originFilters.isActive &&
      (originFilters.role === undefined || updated.role === originFilters.role);
    const items = current.page.items
      .map((user) => (user.id === updated.id ? updated : user))
      .filter((user) => user.id !== updated.id || remainsVisible);
    this.state.set({
      ...current,
      kind: 'loaded',
      page: {
        ...current.page,
        items,
        total: remainsVisible ? current.page.total : Math.max(0, current.page.total - 1),
      },
    });
  }

  private activationError(error: AppError): string {
    if (error.code === 'LAST_ACTIVE_ADMIN_REQUIRED') {
      return 'This account cannot be deactivated because at least one active administrator is required.';
    }
    if (error.code === 'USER_SELF_DEACTIVATION_FORBIDDEN') {
      return 'You cannot deactivate your own administrator account.';
    }
    if (error.kind === 'not-found')
      return 'This user no longer exists. The directory is being refreshed.';
    if (error.kind === 'network')
      return 'The activation change could not reach PulseDesk. Try again.';
    if (error.kind === 'unavailable') return 'Account management is temporarily unavailable.';
    return 'The activation change could not be completed. Try again.';
  }

  private beginLoad(): void {
    const current = this.state();
    this.state.set(
      current.kind === 'loaded' || current.kind === 'refreshing'
        ? { ...current, kind: 'refreshing', refreshError: undefined }
        : { kind: 'loading' },
    );
  }

  private navigate(filters: AdminUserFilters, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: adminUserFiltersToQueryParams(filters),
      replaceUrl,
    });
  }

  private hasCanonicalQuery(params: ParamMap, expected: Params): boolean {
    const entries = Object.entries(expected).filter((entry) => entry[1] !== null);
    return (
      params.keys.length === entries.length &&
      entries.every(
        ([key, value]) => params.getAll(key).length === 1 && params.get(key) === String(value),
      )
    );
  }
}
