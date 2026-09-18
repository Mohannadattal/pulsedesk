import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, ParamMap, Params, Router, RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketSearchKind } from '../../../api/generated/model/ticketSearchKind';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import {
  assignmentFilterState,
  assignmentFilterValue,
  hasActiveTicketFilters,
  PAGE_SIZE_OPTIONS,
  parseTicketFilters,
  sameTicketFilters,
  TicketFilters,
  TicketAssignmentFilter,
  ticketFiltersToQueryParams,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  withFilterChange,
} from '../domain/ticket-filters';
import { TicketPage } from '../domain/ticket';

type TicketListState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'refreshing'; readonly page: TicketPage; readonly filters: TicketFilters }
  | { readonly kind: 'loaded'; readonly page: TicketPage; readonly filters: TicketFilters }
  | { readonly kind: 'error'; readonly error: AppError; readonly filters: TicketFilters };

interface TicketSearchCriteria {
  readonly kind: TicketSearchKind;
  readonly value: string;
  readonly page: number;
  readonly pageSize: number;
}

type TicketSearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly criteria: TicketSearchCriteria }
  | { readonly kind: 'loaded'; readonly page: TicketPage; readonly criteria: TicketSearchCriteria }
  | { readonly kind: 'error'; readonly error: AppError; readonly criteria: TicketSearchCriteria };

interface CanonicalFilterState {
  readonly filters: TicketFilters;
  readonly urlIsCanonical: boolean;
}

@Component({
  selector: 'app-ticket-list-page',
  imports: [
    LocalDateTimePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    NgTemplateOutlet,
    PageMessageComponent,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './ticket-list.page.html',
  styleUrl: './ticket-list.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketListPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tickets = inject(TicketsDataAccess);
  private readonly retryRequests = new Subject<void>();
  private readonly searchRequests = new Subject<TicketSearchCriteria | null>();

  protected readonly session = inject(AuthSessionStore);
  protected readonly statuses = TICKET_STATUSES;
  protected readonly priorities = TICKET_PRIORITIES;
  protected readonly pageSizes = PAGE_SIZE_OPTIONS;
  protected readonly searchKinds = [TicketSearchKind.TICKET_NUMBER, TicketSearchKind.TITLE];
  protected readonly isSupport = [UserRole.AGENT, UserRole.ADMIN].includes(
    this.session.currentUser()?.role as UserRole,
  );
  protected readonly hasOperationalQueue = !this.isSupport;

  private readonly initialFilters = this.scopeFilters(
    parseTicketFilters(this.route.snapshot.queryParamMap),
  );
  private currentFilters = this.initialFilters;
  protected readonly filterForm = new FormGroup({
    status: new FormControl<TicketStatus | ''>(this.initialFilters.status ?? '', {
      nonNullable: true,
    }),
    priority: new FormControl<TicketPriority | ''>(this.initialFilters.priority ?? '', {
      nonNullable: true,
    }),
    categoryId: new FormControl<number | ''>(this.initialFilters.categoryId ?? '', {
      nonNullable: true,
    }),
    assignment: new FormControl<TicketAssignmentFilter>(
      assignmentFilterValue(this.initialFilters, this.session.currentUser()?.id),
      { nonNullable: true },
    ),
  });
  protected readonly searchForm = new FormGroup({
    kind: new FormControl<TicketSearchKind>(TicketSearchKind.TICKET_NUMBER, {
      nonNullable: true,
    }),
    value: new FormControl('', { nonNullable: true }),
  });
  protected readonly searchState = signal<TicketSearchState>({ kind: 'idle' });
  protected readonly searchValidationError = signal<string | null>(null);
  private executedSearch: Omit<TicketSearchCriteria, 'page'> | null = null;

  private readonly filters = this.route.queryParamMap.pipe(
    map((params): CanonicalFilterState => {
      const parsed = this.scopeFilters(parseTicketFilters(params));
      return {
        filters: parsed,
        urlIsCanonical: this.hasCanonicalQuery(params, ticketFiltersToQueryParams(parsed)),
      };
    }),
    distinctUntilChanged(
      (left, right) =>
        sameTicketFilters(left.filters, right.filters) &&
        left.urlIsCanonical === right.urlIsCanonical,
    ),
    tap(({ filters, urlIsCanonical }) => {
      if (!urlIsCanonical) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: ticketFiltersToQueryParams(filters),
          replaceUrl: true,
        });
      }
    }),
    map(({ filters }) => filters),
    distinctUntilChanged(sameTicketFilters),
    tap((filters) => {
      this.currentFilters = filters;
      this.syncFilterForm(filters);
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private readonly requestEvents = (this.hasOperationalQueue
    ? combineLatest([this.filters, this.retryRequests.pipe(startWith(undefined))]).pipe(
        map(([filters]) => filters),
        switchMap((filters) =>
          this.tickets.list(filters).pipe(
            map((page): TicketListState => ({ kind: 'loaded', page, filters })),
            startWith<TicketListState>({ kind: 'loading' }),
            catchError((error: unknown) =>
              of<TicketListState>({
                kind: 'error',
                error: normalizeHttpError(error),
                filters,
              }),
            ),
          ),
        ),
        scan<TicketListState, TicketListState>((previous, current) => {
          if (current.kind !== 'loading') {
            return current;
          }
          if (previous.kind === 'loaded' || previous.kind === 'refreshing') {
            return { kind: 'refreshing', page: previous.page, filters: previous.filters };
          }
          return current;
        }),
      )
    : of<TicketListState>({ kind: 'idle' })
  ).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  protected readonly state = toSignal(this.requestEvents, {
    initialValue: { kind: 'loading' } as TicketListState,
  });

  constructor() {
    this.searchRequests
      .pipe(
        switchMap((criteria) => {
          if (criteria === null) return of<TicketSearchState>({ kind: 'idle' });
          return this.tickets
            .search(criteria.kind, criteria.value, criteria.page, criteria.pageSize)
            .pipe(
              map((page): TicketSearchState => ({ kind: 'loaded', page, criteria })),
              startWith<TicketSearchState>({ kind: 'loading', criteria }),
              catchError((error: unknown) =>
                of<TicketSearchState>({
                  kind: 'error',
                  error: normalizeHttpError(error),
                  criteria,
                }),
              ),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => {
        if (state.kind === 'loaded') {
          this.executedSearch = {
            kind: state.criteria.kind,
            value: state.criteria.value,
            pageSize: state.criteria.pageSize,
          };
          const draft = this.searchForm.getRawValue();
          const normalizedDraft =
            draft.kind === TicketSearchKind.TICKET_NUMBER
              ? draft.value.trim().toUpperCase()
              : draft.value.trim();
          if (draft.kind === state.criteria.kind && normalizedDraft === state.criteria.value) {
            this.searchForm.controls.value.setValue('');
          }
          if (
            state.criteria.kind === TicketSearchKind.TICKET_NUMBER &&
            state.page.items.length === 1
          ) {
            void this.router.navigate(['/tickets', state.page.items[0].id]);
          }
        }
        this.searchState.set(state);
      });
  }

  protected executeSearch(): void {
    const draft = this.searchForm.getRawValue();
    const value = draft.value.trim();
    if (!value) {
      this.searchValidationError.set('Enter a search value.');
      return;
    }
    if (draft.kind === TicketSearchKind.TICKET_NUMBER && !/^TKT-[A-Z2-7]{16}$/i.test(value)) {
      this.searchValidationError.set('Enter a valid ticket number in the format TKT-…');
      return;
    }
    this.searchValidationError.set(null);
    this.searchRequests.next({
      kind: draft.kind,
      value: draft.kind === TicketSearchKind.TICKET_NUMBER ? value.toUpperCase() : value,
      page: 1,
      pageSize: 20,
    });
  }

  protected clearSearch(): void {
    this.executedSearch = null;
    this.searchValidationError.set(null);
    this.searchForm.reset({ kind: TicketSearchKind.TICKET_NUMBER, value: '' });
    this.searchRequests.next(null);
  }

  protected changeSearchPage(event: PageEvent): void {
    if (!this.executedSearch) return;
    this.searchRequests.next({
      ...this.executedSearch,
      page: event.pageSize === this.executedSearch.pageSize ? event.pageIndex + 1 : 1,
      pageSize: event.pageSize,
    });
  }

  protected searchKindLabel(kind: TicketSearchKind): string {
    return kind === TicketSearchKind.TICKET_NUMBER ? 'Ticket number' : 'Title';
  }

  protected applyFilters(): void {
    const controls = this.filterForm.getRawValue();
    const current = this.currentFilters;
    const assignment = controls.assignment;
    const assignmentState = assignmentFilterState(assignment, this.session.currentUser()?.id);
    const filters = withFilterChange(current, {
      status: controls.status || undefined,
      priority: controls.priority || undefined,
      categoryId: this.isSupport ? controls.categoryId || undefined : undefined,
      ...(this.isSupport ? assignmentState : { assignedToId: undefined, unassigned: undefined }),
    });
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: ticketFiltersToQueryParams(filters),
    });
  }

  protected clearFilters(): void {
    const current = this.currentFilters;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: ticketFiltersToQueryParams({ page: 1, pageSize: current.pageSize }),
    });
  }

  protected changePage(event: PageEvent): void {
    const current = this.currentFilters;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: ticketFiltersToQueryParams({
        ...current,
        page: event.pageSize === current.pageSize ? event.pageIndex + 1 : 1,
        pageSize: event.pageSize,
      }),
    });
  }

  protected retry(): void {
    this.retryRequests.next();
  }

  protected hasFilters(filters: TicketFilters): boolean {
    return hasActiveTicketFilters(filters);
  }

  protected enumLabel(value: TicketStatus | TicketPriority): string {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  protected errorTitle(error: AppError): string {
    switch (error.kind) {
      case 'forbidden':
        return 'You do not have access to these tickets';
      case 'network':
        return 'PulseDesk could not be reached';
      case 'unavailable':
        return 'Ticket service is temporarily unavailable';
      default:
        return 'Tickets could not be loaded';
    }
  }

  protected errorDetail(error: AppError): string {
    return error.kind === 'forbidden'
      ? 'Your account is signed in, but it does not have permission to view this queue.'
      : 'Your current filters are preserved. Try loading the tickets again.';
  }

  private syncFilterForm(filters: TicketFilters): void {
    this.filterForm.setValue(
      {
        status: filters.status ?? '',
        priority: filters.priority ?? '',
        categoryId: filters.categoryId ?? '',
        assignment: assignmentFilterValue(filters, this.session.currentUser()?.id),
      },
      { emitEvent: false },
    );
  }

  private scopeFilters(filters: TicketFilters): TicketFilters {
    return this.isSupport
      ? filters.assignedToId === undefined
        ? filters
        : { ...filters, unassigned: undefined }
      : {
          ...filters,
          categoryId: undefined,
          assignedToId: undefined,
          unassigned: undefined,
        };
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
