import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Observable, of, Subscription, switchMap } from 'rxjs';

import { AppError, normalizeHttpError } from '../../../platform/http/app-error';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { TicketActivityItem, TicketActivityPage } from '../domain/ticket-activity';

type ActivityOperation = 'initial' | 'refresh' | 'older';

interface ActivityError {
  readonly error: AppError;
  readonly operation: ActivityOperation;
}

interface ActivityBatch {
  readonly items: readonly TicketActivityItem[];
  readonly lastRawPage: number;
  readonly rawTotalPages: number;
}

const ACTIVITY_PAGE_SIZE = 20;

@Component({
  selector: 'app-ticket-activity',
  imports: [LocalDateTimePipe, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './ticket-activity.component.html',
  styleUrl: './ticket-activity.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketActivityComponent {
  private readonly tickets = inject(TicketsDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  private request: Subscription | undefined;
  private requestVersion = 0;
  private nextRawPage = 1;

  readonly ticketId = input.required<number>();
  readonly ticketNotFound = output<void>();

  protected readonly items = signal<readonly TicketActivityItem[]>([]);
  protected readonly initialLoading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly loadingOlder = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly failure = signal<ActivityError | null>(null);
  protected readonly statusMessage = signal('');

  constructor() {
    effect(() => {
      const ticketId = this.ticketId();
      untracked(() => this.reset(ticketId));
    });
  }

  refresh(): void {
    this.startRequest('refresh', 1);
  }

  protected loadOlder(): void {
    this.startRequest('older', this.nextRawPage);
  }

  protected retry(): void {
    const operation = this.failure()?.operation ?? 'initial';
    if (operation === 'older') {
      this.loadOlder();
    } else if (operation === 'refresh') {
      this.refresh();
    } else {
      this.startRequest('initial', 1);
    }
  }

  protected isBusy(): boolean {
    return this.initialLoading() || this.refreshing() || this.loadingOlder();
  }

  protected canRetry(): boolean {
    const kind = this.failure()?.error.kind;
    return kind !== undefined && !['authentication', 'forbidden', 'not-found'].includes(kind);
  }

  protected errorMessage(): string {
    switch (this.failure()?.error.kind) {
      case 'forbidden':
        return 'You do not have access to ticket activity.';
      case 'not-found':
        return 'Ticket activity is no longer available.';
      case 'network':
        return 'Activity could not be reached. Check your connection and try again.';
      case 'unavailable':
        return 'Activity is temporarily unavailable. Try again shortly.';
      default:
        return 'Activity could not be loaded. Try again.';
    }
  }

  private reset(ticketId: number): void {
    this.request?.unsubscribe();
    this.requestVersion += 1;
    this.nextRawPage = 1;
    this.items.set([]);
    this.hasMore.set(false);
    this.failure.set(null);
    this.statusMessage.set('');
    this.setBusy('initial');
    this.startRequest('initial', 1, ticketId);
  }

  private startRequest(
    operation: ActivityOperation,
    rawPage: number,
    ticketId = this.ticketId(),
  ): void {
    if (operation === 'older' && (this.loadingOlder() || !this.hasMore())) {
      return;
    }
    this.request?.unsubscribe();
    const version = ++this.requestVersion;
    this.failure.set(null);
    this.statusMessage.set('');
    this.setBusy(operation);

    this.request = this.loadUntilVisible(ticketId, rawPage)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batch) => {
          if (version !== this.requestVersion || ticketId !== this.ticketId()) {
            return;
          }
          this.nextRawPage = batch.lastRawPage + 1;
          this.hasMore.set(batch.lastRawPage < batch.rawTotalPages);
          if (operation === 'older') {
            this.items.update((current) => this.deduplicate([...current, ...batch.items]));
            this.statusMessage.set(
              batch.items.length > 0 ? 'Older activity loaded.' : 'All activity is loaded.',
            );
          } else {
            this.items.set(this.deduplicate(batch.items));
            this.statusMessage.set(operation === 'refresh' ? 'Activity refreshed.' : '');
          }
          this.clearBusy();
        },
        error: (value: unknown) => {
          if (version !== this.requestVersion || ticketId !== this.ticketId()) {
            return;
          }
          const error = normalizeHttpError(value);
          this.clearBusy();
          this.failure.set({ error, operation });
          if (error.kind === 'not-found') {
            this.ticketNotFound.emit();
          }
        },
      });
  }

  private loadUntilVisible(ticketId: number, rawPage: number): Observable<ActivityBatch> {
    return this.tickets.listActivity(ticketId, rawPage, ACTIVITY_PAGE_SIZE).pipe(
      switchMap((page) => {
        if (page.items.length === 0 && page.rawPage < page.rawTotalPages) {
          return this.loadUntilVisible(ticketId, page.rawPage + 1);
        }
        return this.asBatch(page);
      }),
    );
  }

  private asBatch(page: TicketActivityPage): Observable<ActivityBatch> {
    return of({
      items: page.items,
      lastRawPage: page.rawPage,
      rawTotalPages: page.rawTotalPages,
    });
  }

  private deduplicate(items: readonly TicketActivityItem[]): readonly TicketActivityItem[] {
    const seen = new Set<number>();
    return items.filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  }

  private setBusy(operation: ActivityOperation): void {
    this.initialLoading.set(operation === 'initial');
    this.refreshing.set(operation === 'refresh');
    this.loadingOlder.set(operation === 'older');
  }

  private clearBusy(): void {
    this.initialLoading.set(false);
    this.refreshing.set(false);
    this.loadingOlder.set(false);
  }
}
