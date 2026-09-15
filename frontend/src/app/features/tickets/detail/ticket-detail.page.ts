import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap } from 'rxjs';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { TicketCommentsComponent } from '../comments/ticket-comments.component';
import { Ticket } from '../domain/ticket';

type TicketDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly ticket: Ticket }
  | { readonly kind: 'error'; readonly error: AppError };

@Component({
  selector: 'app-ticket-detail-page',
  imports: [
    LocalDateTimePipe,
    MatButtonModule,
    PageMessageComponent,
    RouterLink,
    TicketCommentsComponent,
  ],
  templateUrl: './ticket-detail.page.html',
  styleUrl: './ticket-detail.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly tickets = inject(TicketsDataAccess);
  private readonly retryRequests = new Subject<void>();

  private readonly requestState = combineLatest([
    this.route.paramMap.pipe(map((params) => this.parseTicketId(params.get('id')))),
    this.retryRequests.pipe(startWith(undefined)),
  ]).pipe(
    map(([ticketId]) => ticketId),
    switchMap((ticketId) => {
      if (ticketId === undefined) {
        return of<TicketDetailState>({
          kind: 'error',
          error: new AppError('not-found', 404),
        });
      }
      return this.tickets.get(ticketId).pipe(
        map((ticket): TicketDetailState => ({ kind: 'loaded', ticket })),
        startWith<TicketDetailState>({ kind: 'loading' }),
        catchError((error: unknown) =>
          of<TicketDetailState>({ kind: 'error', error: normalizeHttpError(error) }),
        ),
      );
    }),
  );

  protected readonly state = toSignal(this.requestState, {
    initialValue: { kind: 'loading' } as TicketDetailState,
  });

  protected retry(): void {
    this.retryRequests.next();
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
