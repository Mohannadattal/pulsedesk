import { Routes } from '@angular/router';

import { customersGuard } from './customers.guard';

export const CUSTOMER_ROUTES: Routes = [
  {
    path: '',
    canActivate: [customersGuard],
    children: [
      {
        path: 'new',
        title: 'Create customer | PulseDesk',
        loadComponent: () =>
          import('./create/customer-create.page').then((page) => page.CustomerCreatePage),
      },
      {
        path: '',
        title: 'Customers | PulseDesk',
        loadComponent: () =>
          import('./list/customer-list.page').then((page) => page.CustomerListPage),
      },
      {
        path: ':customerId',
        title: 'Customer profile | PulseDesk',
        loadComponent: () =>
          import('./detail/customer-detail.page').then((page) => page.CustomerDetailPage),
      },
    ],
  },
];
