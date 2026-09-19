import { Routes } from '@angular/router';

export const NOTIFICATION_ROUTES: Routes = [
  {
    path: '',
    title: 'Notifications | PulseDesk',
    loadComponent: () =>
      import('./list/notification-list.page').then((page) => page.NotificationListPage),
  },
];
