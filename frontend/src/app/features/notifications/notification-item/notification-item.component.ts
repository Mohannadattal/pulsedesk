import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import { UserRole } from '../../../api/generated/model/userRole';
import { LocalDateTimePipe } from '../../../shared/util/local-date-time.pipe';
import { notificationActorLabel, Notification, notificationTarget } from '../domain/notification';

@Component({
  selector: 'app-notification-item',
  imports: [LocalDateTimePipe, MatButtonModule],
  templateUrl: './notification-item.component.html',
  styleUrl: './notification-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationItemComponent {
  readonly notification = input.required<Notification>();
  readonly role = input<UserRole>();
  readonly compact = input(false);
  readonly activate = output<Notification>();

  protected readonly actorLabel = computed(() => notificationActorLabel(this.notification()));
  protected readonly hasTarget = computed(
    () => notificationTarget(this.notification(), this.role()) !== null,
  );
  protected readonly actionLabel = computed(() => {
    const item = this.notification();
    if (this.hasTarget()) return `Open ${item.title}`;
    return item.isRead ? item.title : `Mark ${item.title} as read`;
  });
}
