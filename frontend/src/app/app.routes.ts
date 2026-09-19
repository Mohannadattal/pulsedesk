import { Routes } from '@angular/router';

import { anonymousOnlyGuard, authGuard, passwordChangeGuard } from './platform/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'sign-in',
    title: 'Sign in | PulseDesk',
    canActivate: [anonymousOnlyGuard],
    loadComponent: () => import('./features/sign-in/sign-in.page').then((page) => page.SignInPage),
  },
  {
    path: 'forgot-password',
    title: 'Forgot password | PulseDesk',
    canActivate: [anonymousOnlyGuard],
    loadComponent: () =>
      import('./features/forgot-password/forgot-password.page').then(
        (page) => page.ForgotPasswordPage,
      ),
  },
  {
    path: 'set-password',
    title: 'Set password | PulseDesk',
    canActivate: [passwordChangeGuard],
    loadComponent: () =>
      import('./features/set-password/set-password.page').then((page) => page.SetPasswordPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shell/app-shell/app-shell.component').then((shell) => shell.AppShellComponent),
    children: [
      {
        path: 'notifications',
        loadChildren: () =>
          import('./features/notifications/notifications.routes').then(
            (routes) => routes.NOTIFICATION_ROUTES,
          ),
      },
      {
        path: 'tickets',
        loadChildren: () =>
          import('./features/tickets/tickets.routes').then((routes) => routes.TICKET_ROUTES),
      },
      {
        path: 'customers',
        loadChildren: () =>
          import('./features/customers/customers.routes').then((routes) => routes.CUSTOMER_ROUTES),
      },
      {
        path: 'administration',
        loadChildren: () =>
          import('./features/administration/administration.routes').then(
            (routes) => routes.ADMINISTRATION_ROUTES,
          ),
      },
      { path: '', pathMatch: 'full', redirectTo: 'tickets' },
      { path: '**', redirectTo: 'tickets' },
    ],
  },
];
