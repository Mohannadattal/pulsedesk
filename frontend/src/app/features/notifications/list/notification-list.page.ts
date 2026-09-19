import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router } from '@angular/router';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  finalize,
  map,
  of,
  startWith,
  Subject,
  switchMap,
} from 'rxjs';

import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError } from '../../../platform/http/app-error';
import { PageMessageComponent } from '../../../shared/ui/page-message/page-message.component';
import { NotificationIndicatorService } from '../data-access/notification-indicator.service';
import { NotificationsDataAccess } from '../data-access/notifications-data-access';
import {
  Notification,
  NotificationPage,
  notificationTarget,
  withReadState,
} from '../domain/notification';
import { NotificationItemComponent } from '../notification-item/notification-item.component';

type NotificationFilter = 'all' | 'unread';

interface NotificationCriteria {
  readonly filter: NotificationFilter;
  readonly page: number;
  readonly pageSize: number;
}

type NotificationListState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'loaded' | 'refreshing';
      readonly page: NotificationPage;
      readonly criteria: NotificationCriteria;
    }
  | { readonly kind: 'error'; readonly error: AppError; readonly criteria: NotificationCriteria };

const PAGE_SIZES = [10, 20, 50] as const;

@Component({
  selector: 'app-notification-list-page',
  imports: [
    MatButtonModule,
    MatPaginatorModule,
    MatProgressBarModule,
    NotificationItemComponent,
    PageMessageComponent,
  ],
  templateUrl: './notification-list.page.html',
  styleUrl: './notification-list.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationListPage {
  private readonly dataAccess = inject(NotificationsDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly indicator = inject(NotificationIndicatorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reloadRequests = new Subject<void>();

  protected readonly session = inject(AuthSessionStore);
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly state = signal<NotificationListState>({ kind: 'loading' });
  protected readonly actionPending = signal(false);
  protected readonly actionError = signal<string | null>(null);

  constructor() {
    combineLatest([
      this.route.queryParamMap.pipe(
        map(
          (params): NotificationCriteria => ({
            filter: params.get('filter') === 'unread' ? 'unread' : 'all',
            page: positiveInteger(params.get('page'), 1),
            pageSize: pageSize(params.get('pageSize')),
          }),
        ),
        distinctUntilChanged(
          (left, right) =>
            left.filter === right.filter &&
            left.page === right.page &&
            left.pageSize === right.pageSize,
        ),
      ),
      this.reloadRequests.pipe(startWith(undefined)),
    ])
      .pipe(
        map(([criteria]) => criteria),
        switchMap((criteria) => {
          this.beginLoad(criteria);
          return this.dataAccess
            .list(criteria.filter === 'unread', criteria.page, criteria.pageSize)
            .pipe(
              map((page) => ({ page, criteria }) as const),
              catchError((error: AppError) => of({ error, criteria } as const)),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if ('error' in result) {
          this.state.set({ kind: 'error', error: result.error, criteria: result.criteria });
        } else {
          this.state.set({ kind: 'loaded', page: result.page, criteria: result.criteria });
        }
      });
  }

  protected currentFilter(): NotificationFilter {
    const current = this.state();
    return current.kind === 'loading' ? 'all' : current.criteria.filter;
  }

  protected setFilter(filter: NotificationFilter): void {
    if (filter === this.currentFilter()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { filter: filter === 'unread' ? 'unread' : null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  protected changePage(event: PageEvent): void {
    const current = this.state();
    if (current.kind !== 'loaded' && current.kind !== 'refreshing') return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        page: event.pageSize === current.page.pageSize ? event.pageIndex + 1 : 1,
        pageSize: event.pageSize,
      },
      queryParamsHandling: 'merge',
    });
  }

  protected retry(): void {
    this.reloadRequests.next();
  }

  protected activate(notification: Notification): void {
    const role = this.session.currentUser()?.role;
    const target = notificationTarget(notification, role);

    if (!notification.isRead) {
      this.replace(notification.id, withReadState(notification, true));
      this.indicator.noteOneRead();
      this.dataAccess.markRead(notification.id).subscribe({
        next: (updated) => {
          this.replace(notification.id, updated);
          this.indicator.refresh();
          if (this.currentFilter() === 'unread') this.reloadRequests.next();
        },
        error: () => {
          this.replace(notification.id, notification);
          this.actionError.set('The notification could not be marked read.');
          this.indicator.refresh();
        },
      });
    }

    if (target) void this.router.navigate([...target]);
  }

  protected markAllRead(): void {
    if (this.actionPending()) return;
    this.actionPending.set(true);
    this.actionError.set(null);
    this.dataAccess
      .markAllRead()
      .pipe(
        finalize(() => this.actionPending.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.indicator.noteAllRead();
          this.indicator.refresh();
          if (this.currentFilter() === 'unread') {
            this.reloadRequests.next();
          } else {
            this.markVisibleRead();
          }
        },
        error: () => this.actionError.set('Notifications could not be marked read.'),
      });
  }

  protected errorTitle(error: AppError): string {
    if (error.kind === 'network') return 'PulseDesk could not be reached';
    if (error.kind === 'unavailable') return 'Notifications are temporarily unavailable';
    return 'Notifications could not be loaded';
  }

  private beginLoad(criteria: NotificationCriteria): void {
    const current = this.state();
    this.state.set(
      current.kind === 'loaded' || current.kind === 'refreshing'
        ? { ...current, kind: 'refreshing', criteria }
        : { kind: 'loading' },
    );
  }

  private replace(notificationId: number, replacement: Notification): void {
    const current = this.state();
    if (current.kind !== 'loaded' && current.kind !== 'refreshing') return;
    this.state.set({
      ...current,
      page: {
        ...current.page,
        items: current.page.items.map((item) => (item.id === notificationId ? replacement : item)),
      },
    });
  }

  private markVisibleRead(): void {
    const current = this.state();
    if (current.kind !== 'loaded' && current.kind !== 'refreshing') return;
    this.state.set({
      ...current,
      page: {
        ...current.page,
        items: current.page.items.map((item) => withReadState(item, true)),
      },
    });
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
