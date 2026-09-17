import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AuthApi } from '../../platform/auth/auth-api';
import { ForgotPasswordPage } from './forgot-password.page';

describe('ForgotPasswordPage', () => {
  let fixture: ComponentFixture<ForgotPasswordPage>;
  const authApi = { requestPasswordReset: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authApi.requestPasswordReset.mockReturnValue(of({}));
    await TestBed.configureTestingModule({
      imports: [ForgotPasswordPage],
      providers: [provideRouter([]), { provide: AuthApi, useValue: authApi }],
    }).compileComponents();
    fixture = TestBed.createComponent(ForgotPasswordPage);
    fixture.detectChanges();
  });

  it('validates email before submission', () => {
    fixture.componentInstance['form'].controls.email.setValue('not-an-email');
    fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Enter a valid email address.');
  });

  it('shows only the generic success semantics', () => {
    fixture.componentInstance['form'].controls.email.setValue('person@example.com');

    fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(authApi.requestPasswordReset).toHaveBeenCalledWith({ email: 'person@example.com' });
    expect(fixture.nativeElement.textContent).toContain(
      'If an account exists for this email, a password reset request has been submitted.',
    );
  });
});
