import { Routes } from '@angular/router';

import { adminGuard } from '../../platform/auth/auth.guards';

export const ADMINISTRATION_ROUTES: Routes = [
  {
    path: '',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./administration-shell.component').then(
        (component) => component.AdministrationShellComponent,
      ),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'users' },
      {
        path: 'users',
        title: 'User administration | PulseDesk',
        loadComponent: () => import('./users/user-list.page').then((page) => page.UserListPage),
      },
      {
        path: 'categories',
        title: 'Category administration | PulseDesk',
        loadComponent: () =>
          import('./categories/category-list.page').then((page) => page.CategoryListPage),
      },
      { path: '**', redirectTo: 'users' },
    ],
  },
];
