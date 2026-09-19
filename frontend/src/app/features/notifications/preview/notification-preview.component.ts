import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { catchError, finalize, map, of, Subject, switchMap } from 'rxjs';

import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError } from '../../../platform/http/app-error';
import { NotificationIndicatorService } from '../data-access/notification-indicator.service';
import { NotificationsDataAccess } from '../data-access/notifications-data-access';
import { Notification, NotificationPage } from '../domain/notification';
import { NotificationItemComponent } from '../notification-item/notification-item.component';

type PreviewState =
  | { readonly kind: 'idle' | 'loading' }
  | { readonly kind: 'loaded'; readonly page: NotificationPage }
  | { readonly kind: 'error'; readonly error: AppError };

const PREVIEW_SIZE = 5;

@Component({
  selector: 'app-notification-preview',
  imports: [MatButtonModule, NotificationItemComponent, RouterLink],
  templateUrl: './notification-preview.component.html',
  styleUrl: './notification-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationPreviewComponent {
  private readonly dataAccess = inject(NotificationsDataAccess);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly indicator = inject(NotificationIndicatorService);
  private readonly loadRequests = new Subject<void>();
  private readonly confirmedReadIds = new Set<number>();
  private readonly pendingReadIds = new Set<number>();
  private loadSequence = 0;
  private clearedThroughLoad = 0;

  protected readonly session = inject(AuthSessionStore);
  protected readonly state = signal<PreviewState>({ kind: 'idle' });
  protected readonly actionPending = signal(false);
  protected readonly actionError = signal<string | null>(null);
  readonly navigate = output<Notification>();
  readonly dismiss = output<void>();

  constructor() {
    this.loadRequests
      .pipe(
        switchMap(() => {
          const loadSequence = ++this.loadSequence;
          this.state.set({ kind: 'loading' });
          return this.dataAccess.list(true, 1, PREVIEW_SIZE).pipe(
            map((page) => ({ page, loadSequence }) as const),
            catchError((error: AppError) => of({ error } as const)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if ('error' in result) this.state.set({ kind: 'error', error: result.error });
        else {
          const items =
            result.loadSequence <= this.clearedThroughLoad
              ? []
              : result.page.items.filter(
                  (item) => !item.isRead && !this.confirmedReadIds.has(item.id),
                );
          this.state.set({
            kind: 'loaded',
            page: {
              ...result.page,
              items,
              total: result.loadSequence <= this.clearedThroughLoad ? 0 : result.page.total,
              totalPages:
                result.loadSequence <= this.clearedThroughLoad ? 0 : result.page.totalPages,
            },
          });
        }
      });
  }

  load(): void {
    this.actionError.set(null);
    this.loadRequests.next();
  }

  protected activate(notification: Notification): void {
    if (!notification.isRead && !this.pendingReadIds.has(notification.id)) {
      this.pendingReadIds.add(notification.id);
      this.actionError.set(null);
      this.dataAccess
        .markRead(notification.id)
        .pipe(
          finalize(() => this.pendingReadIds.delete(notification.id)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: (updated) => {
            this.confirmedReadIds.add(updated.id);
            this.remove(updated.id);
            this.indicator.noteOneRead();
            this.indicator.refresh();
          },
          error: () => {
            this.actionError.set('The notification could not be marked read.');
          },
        });
    }
    this.navigate.emit(notification);
  }

  protected markAllRead(): void {
    if (this.actionPending()) return;
    this.actionPending.set(true);
    this.actionError.set(null);
    this.dataAccess
      .markAllRead()
      .pipe(finalize(() => this.actionPending.set(false)))
      .subscribe({
        next: () => {
          this.clearedThroughLoad = this.loadSequence;
          const current = this.state();
          if (current.kind === 'loaded') {
            this.state.set({
              kind: 'loaded',
              page: {
                ...current.page,
                items: [],
                total: 0,
                totalPages: 0,
              },
            });
          }
          this.indicator.noteAllRead();
          this.indicator.refresh();
        },
        error: () => this.actionError.set('Notifications could not be marked read.'),
      });
  }

  private remove(notificationId: number): void {
    const current = this.state();
    if (current.kind !== 'loaded') return;
    this.state.set({
      kind: 'loaded',
      page: {
        ...current.page,
        items: current.page.items.filter((item) => item.id !== notificationId),
        total: Math.max(0, current.page.total - 1),
      },
    });
  }
}
