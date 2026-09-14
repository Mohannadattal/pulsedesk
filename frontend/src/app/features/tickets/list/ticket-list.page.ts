import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import {
  hasActiveTicketFilters,
  PAGE_SIZE_OPTIONS,
  parseTicketFilters,
  sameTicketFilters,
  TicketFilters,
  ticketFiltersToQueryParams,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from '../domain/ticket-filters';
import { TicketPage } from '../domain/ticket';

type TicketListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'refreshing'; readonly page: TicketPage; readonly filters: TicketFilters }
  | { readonly kind: 'loaded'; readonly page: TicketPage; readonly filters: TicketFilters }
  | { readonly kind: 'error'; readonly error: AppError; readonly filters: TicketFilters };

type AssignmentFilter = '' | 'assigned' | 'unassigned';

@Component({
  selector: 'app-ticket-list-page',
  imports: [
    LocalDateTimePipe,
    MatButtonModule,
    MatFormFieldModule,
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

  protected readonly session = inject(AuthSessionStore);
  protected readonly statuses = TICKET_STATUSES;
  protected readonly priorities = TICKET_PRIORITIES;
  protected readonly pageSizes = PAGE_SIZE_OPTIONS;

  private readonly initialFilters = parseTicketFilters(this.route.snapshot.queryParamMap);
  protected readonly filterForm = new FormGroup({
    status: new FormControl<TicketStatus | ''>(this.initialFilters.status ?? '', {
      nonNullable: true,
    }),
    priority: new FormControl<TicketPriority | ''>(this.initialFilters.priority ?? '', {
      nonNullable: true,
    }),
    assignment: new FormControl<AssignmentFilter>(
      this.assignmentValue(this.initialFilters.unassigned),
      { nonNullable: true },
    ),
  });

  private readonly filters = this.route.queryParamMap.pipe(
    map(parseTicketFilters),
    distinctUntilChanged(sameTicketFilters),
    tap((filters) => this.syncFilterForm(filters)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private readonly requestEvents = combineLatest([
    this.filters,
    this.retryRequests.pipe(startWith(undefined)),
  ]).pipe(
    map(([filters]) => filters),
    switchMap((filters) =>
      this.tickets.list(filters).pipe(
        map((page): TicketListState => ({ kind: 'loaded', page, filters })),
        startWith<TicketListState>({ kind: 'loading' }),
        catchError((error: unknown) =>
          of<TicketListState>({ kind: 'error', error: normalizeHttpError(error), filters }),
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
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  protected readonly state = toSignal(this.requestEvents, {
    initialValue: { kind: 'loading' } as TicketListState,
  });

  protected applyFilters(): void {
    const controls = this.filterForm.getRawValue();
    const current = parseTicketFilters(this.route.snapshot.queryParamMap);
    const assignment = controls.assignment;
    const filters: TicketFilters = {
      status: controls.status || undefined,
      priority: controls.priority || undefined,
      unassigned: assignment === '' ? undefined : assignment === 'unassigned',
      page: 1,
      pageSize: current.pageSize,
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: ticketFiltersToQueryParams(filters),
    });
  }

  protected clearFilters(): void {
    const current = parseTicketFilters(this.route.snapshot.queryParamMap);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: ticketFiltersToQueryParams({ page: 1, pageSize: current.pageSize }),
    });
  }

  protected changePage(event: PageEvent): void {
    const current = parseTicketFilters(this.route.snapshot.queryParamMap);
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
        assignment: this.assignmentValue(filters.unassigned),
      },
      { emitEvent: false },
    );
  }

  private assignmentValue(unassigned: boolean | undefined): AssignmentFilter {
    if (unassigned === true) {
      return 'unassigned';
    }
    if (unassigned === false) {
      return 'assigned';
    }
    return '';
  }
}
