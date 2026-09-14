import { Routes } from '@angular/router';

import { anonymousOnlyGuard, authGuard } from './platform/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'sign-in',
    title: 'Sign in | PulseDesk',
    canActivate: [anonymousOnlyGuard],
    loadComponent: () => import('./features/sign-in/sign-in.page').then((page) => page.SignInPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shell/app-shell/app-shell.component').then((shell) => shell.AppShellComponent),
    children: [
      {
        path: 'tickets',
        loadChildren: () =>
          import('./features/tickets/tickets.routes').then((routes) => routes.TICKET_ROUTES),
      },
      { path: '', pathMatch: 'full', redirectTo: 'tickets' },
      { path: '**', redirectTo: 'tickets' },
    ],
  },
];
