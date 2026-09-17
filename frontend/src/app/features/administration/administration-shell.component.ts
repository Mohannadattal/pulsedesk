import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-administration-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav class="admin-nav" aria-label="Administration">
      <a routerLink="users" routerLinkActive="admin-nav__active">Users</a>
      <a routerLink="categories" routerLinkActive="admin-nav__active">Categories</a>
    </nav>
    <router-outlet />
  `,
  styles: `
    .admin-nav {
      display: flex;
      gap: var(--pd-space-1);
      margin-bottom: var(--pd-space-5);
      padding: var(--pd-space-1);
      border: 1px solid var(--pd-color-border);
      border-radius: var(--pd-radius-control);
      background: var(--pd-color-surface);
      width: fit-content;
    }
    .admin-nav a {
      padding: var(--pd-space-2) var(--pd-space-4);
      border-radius: 0.3rem;
      color: var(--pd-color-text-muted);
      font-size: 0.8125rem;
      font-weight: 650;
      text-decoration: none;
    }
    .admin-nav a:hover,
    .admin-nav .admin-nav__active {
      background: var(--pd-color-action-soft);
      color: var(--pd-color-action-strong);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdministrationShellComponent {}
