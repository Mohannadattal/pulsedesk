import { Routes } from '@angular/router';

export const TICKET_ROUTES: Routes = [
  {
    path: '',
    title: 'Tickets | PulseDesk',
    loadComponent: () => import('./list/ticket-list.page').then((page) => page.TicketListPage),
  },
  {
    path: ':id',
    title: 'Ticket details | PulseDesk',
    loadComponent: () =>
      import('./detail/ticket-detail.page').then((page) => page.TicketDetailPage),
  },
];
