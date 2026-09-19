import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  catchError,
  EMPTY,
  fromEvent,
  map,
  merge,
  Subject,
  Subscription,
  switchMap,
  timer,
} from 'rxjs';

import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { NotificationsDataAccess } from './notifications-data-access';

export const NOTIFICATION_POLL_INTERVAL_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class NotificationIndicatorService {
  private readonly dataAccess = inject(NotificationsDataAccess);
  private readonly session = inject(AuthSessionStore);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly countState = signal<number | null>(null);
  private readonly refreshRequests = new Subject<void>();
  private readonly sessionStates = toObservable(this.session.state);
  private pollingSubscription: Subscription | null = null;

  readonly unreadCount = this.countState.asReadonly();
  readonly badgeText = computed(() => {
    const count = this.countState();
    return count === null || count <= 0 ? null : count > 99 ? '99+' : String(count);
  });

  start(): void {
    if (this.pollingSubscription) return;

    const window = this.document.defaultView;
    const focusRequests = window ? fromEvent(window, 'focus').pipe(map(() => undefined)) : EMPTY;
    this.pollingSubscription = this.sessionStates
      .pipe(
        switchMap((state) => {
          this.countState.set(null);
          if (state.status !== 'authenticated') return EMPTY;
          return merge(
            timer(0, NOTIFICATION_POLL_INTERVAL_MS),
            focusRequests,
            this.refreshRequests,
          ).pipe(switchMap(() => this.dataAccess.unreadCount().pipe(catchError(() => EMPTY))));
        }),
      )
      .subscribe((count) => this.countState.set(Math.max(0, count)));

    this.destroyRef.onDestroy(() => this.stop());
  }

  stop(): void {
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = null;
    this.countState.set(null);
  }

  refresh(): void {
    if (this.session.hasNormalSession()) this.refreshRequests.next();
  }

  noteOneRead(): void {
    this.countState.update((count) => (count === null ? null : Math.max(0, count - 1)));
  }

  noteAllRead(): void {
    this.countState.set(0);
  }
}
