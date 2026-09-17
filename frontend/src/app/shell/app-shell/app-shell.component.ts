import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';

import { UserRole } from '../../api/generated/model/userRole';
import { AuthSessionStore } from '../../platform/auth/auth-session.store';

interface NavigationItem {
  readonly label: string;
  readonly path: string;
  readonly roles: readonly UserRole[];
}

const NAVIGATION_ITEMS: readonly NavigationItem[] = Object.freeze([
  { label: 'My tickets', path: '/tickets', roles: [UserRole.EMPLOYEE] },
  { label: 'Tickets', path: '/tickets', roles: [UserRole.AGENT, UserRole.ADMIN] },
  { label: 'Administration', path: '/administration', roles: [UserRole.ADMIN] },
]);

@Component({
  selector: 'app-shell',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatMenuModule,
    MatSidenavModule,
    MatToolbarModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly router = inject(Router);

  protected readonly session = inject(AuthSessionStore);
  protected readonly compact = toSignal(
    this.breakpointObserver.observe('(max-width: 52.5rem)').pipe(map((state) => state.matches)),
    { initialValue: false },
  );
  protected readonly navigationItems = computed(() => {
    const role = this.session.currentUser()?.role;
    return role ? NAVIGATION_ITEMS.filter((item) => item.roles.includes(role)) : [];
  });
  protected readonly initials = computed(() => {
    const user = this.session.currentUser();
    return user ? `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase() : '';
  });

  protected logout(): void {
    this.session.endSession();
    void this.router.navigate(['/sign-in']);
  }
}
