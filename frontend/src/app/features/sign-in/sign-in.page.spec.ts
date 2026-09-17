import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SessionType } from '../../api/generated/model/sessionType';
import { UserRole } from '../../api/generated/model/userRole';
import { AuthSessionStore } from '../../platform/auth/auth-session.store';
import { SignInPage } from './sign-in.page';

const USER = {
  id: 1,
  email: 'user@example.com',
  first_name: 'Pulse',
  last_name: 'User',
  role: UserRole.EMPLOYEE,
  is_active: true,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

describe('SignInPage', () => {
  let fixture: ComponentFixture<SignInPage>;
  let router: Router;
  const session = { signIn: vi.fn(), requiresPasswordChange: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    session.requiresPasswordChange.mockReturnValue(false);
    session.signIn.mockReturnValue(
      of({ access_token: 'token', session_type: SessionType.NORMAL, user: USER }),
    );
    await TestBed.configureTestingModule({
      imports: [SignInPage],
      providers: [
        provideRouter([]),
        { provide: AuthSessionStore, useValue: session },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(SignInPage);
    fixture.detectChanges();
  });

  it('offers forgot-password navigation', () => {
    const link = fixture.nativeElement.querySelector('.forgot-link') as HTMLAnchorElement;
    expect(link.textContent).toContain('Forgot password?');
    expect(link.getAttribute('href')).toBe('/forgot-password');
  });

  it('routes a restricted login directly to set-password', () => {
    session.requiresPasswordChange.mockReturnValue(true);
    const form = fixture.componentInstance['form'];
    form.setValue({ email: 'user@example.com', password: 'temporary-password' });

    fixture.componentInstance['submit']();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/set-password');
  });

  it('retains normal login navigation', () => {
    const form = fixture.componentInstance['form'];
    form.setValue({ email: 'user@example.com', password: 'normal-password' });

    fixture.componentInstance['submit']();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/tickets');
  });
});
