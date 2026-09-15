import { Routes } from '@angular/router';

import { employeeCreateTicketGuard } from './create/employee-create-ticket.guard';
import { pendingTicketChangesGuard } from './create/pending-ticket-changes.guard';

export const TICKET_ROUTES: Routes = [
  {
    path: 'new',
    title: 'Create ticket | PulseDesk',
    canActivate: [employeeCreateTicketGuard],
    canDeactivate: [pendingTicketChangesGuard],
    loadComponent: () =>
      import('./create/create-ticket.page').then((page) => page.CreateTicketPage),
  },
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
