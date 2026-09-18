import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap } from 'rxjs';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { TicketActivityComponent } from '../activity/ticket-activity.component';
import { TicketCommentsComponent } from '../comments/ticket-comments.component';
import { Ticket } from '../domain/ticket';
import { canOperateTicket, TicketOperationsComponent } from './ticket-operations.component';

type TicketDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly ticket: Ticket }
  | { readonly kind: 'error'; readonly error: AppError };

interface TicketDetailEvent {
  readonly state: TicketDetailState;
  readonly authorityVersion: number;
}

@Component({
  selector: 'app-ticket-detail-page',
  imports: [
    LocalDateTimePipe,
    MatButtonModule,
    PageMessageComponent,
    RouterLink,
    TicketActivityComponent,
    TicketCommentsComponent,
    TicketOperationsComponent,
  ],
  templateUrl: './ticket-detail.page.html',
  styleUrl: './ticket-detail.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly tickets = inject(TicketsDataAccess);
  private readonly retryRequests = new Subject<void>();
  private readonly activity = viewChild(TicketActivityComponent);
  protected readonly session = inject(AuthSessionStore);
  protected readonly backLink = customerReturnLink(
    this.route.snapshot?.queryParamMap?.get('returnTo') ?? null,
  );
  protected readonly terminalError = signal<AppError | null>(null);
  protected readonly state = signal<TicketDetailState>({ kind: 'loading' });
  private authorityVersion = 0;

  private readonly requestState = combineLatest([
    this.route.paramMap.pipe(map((params) => this.parseTicketId(params.get('id')))),
    this.retryRequests.pipe(startWith(undefined)),
  ]).pipe(
    map(([ticketId]) => ticketId),
    switchMap((ticketId) => {
      const authorityVersion = this.authorityVersion;
      if (ticketId === undefined) {
        return of<TicketDetailEvent>({
          state: { kind: 'error', error: new AppError('not-found', 404) },
          authorityVersion,
        });
      }
      return this.tickets.get(ticketId).pipe(
        map(
          (ticket): TicketDetailEvent => ({
            state: { kind: 'loaded', ticket },
            authorityVersion,
          }),
        ),
        startWith<TicketDetailEvent>({ state: { kind: 'loading' }, authorityVersion }),
        catchError((error: unknown) =>
          of<TicketDetailEvent>({
            state: { kind: 'error', error: normalizeHttpError(error) },
            authorityVersion,
          }),
        ),
      );
    }),
  );

  constructor() {
    this.requestState.pipe(takeUntilDestroyed()).subscribe(({ state, authorityVersion }) => {
      if (authorityVersion !== this.authorityVersion) {
        return;
      }
      if (state.kind === 'loading' || state.kind === 'loaded') {
        this.terminalError.set(null);
      }
      this.state.set(state);
    });
  }

  protected retry(): void {
    this.terminalError.set(null);
    this.retryRequests.next();
  }

  protected isSupport(): boolean {
    return canOperateTicket(this.session.currentUser()?.role);
  }

  protected canOpenCustomerProfile(): boolean {
    const role = this.session.currentUser()?.role;
    return role === UserRole.EMPLOYEE || role === UserRole.ADMIN;
  }

  protected replaceTicket(ticket: Ticket): void {
    this.authorityVersion += 1;
    this.terminalError.set(null);
    this.state.set({ kind: 'loaded', ticket });
  }

  protected mutationSucceeded(ticket: Ticket): void {
    this.replaceTicket(ticket);
    this.activity()?.refresh();
  }

  protected refreshActivity(): void {
    this.activity()?.refresh();
  }

  protected ticketNotFound(): void {
    this.terminalError.set(new AppError('not-found', 404, 'TICKET_NOT_FOUND'));
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
      case 'not-found':
        return 'Ticket not found';
      case 'forbidden':
        return 'Access denied';
      case 'network':
        return 'PulseDesk could not be reached';
      case 'unavailable':
        return 'Ticket service is temporarily unavailable';
      default:
        return 'Ticket could not be loaded';
    }
  }

  protected errorDetail(error: AppError): string {
    switch (error.kind) {
      case 'not-found':
        return 'This ticket does not exist or is not visible to your account.';
      case 'forbidden':
        return 'Your account does not have permission to view this ticket.';
      default:
        return 'Try loading the ticket again.';
    }
  }

  protected canRetry(error: AppError): boolean {
    return !['not-found', 'forbidden'].includes(error.kind);
  }

  private parseTicketId(value: string | null): number | undefined {
    if (!value || !/^\d+$/.test(value)) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
}

function customerReturnLink(value: string | null): string {
  return value && /^\/customers\/\d+$/.test(value) ? value : '/tickets';
}
