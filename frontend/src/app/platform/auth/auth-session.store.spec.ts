import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { SessionType } from '../../api/generated/model/sessionType';
import { UserResponse } from '../../api/generated/model/userResponse';
import { UserRole } from '../../api/generated/model/userRole';
import { AuthApi } from './auth-api';
import { AuthSessionStore } from './auth-session.store';
import { SESSION_STORAGE, TokenStorage } from './token-storage';

const USER: UserResponse = {
  id: 7,
  email: 'alex@example.com',
  first_name: 'Alex',
  last_name: 'Morgan',
  role: UserRole.AGENT,
  is_active: true,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

describe('AuthSessionStore', () => {
  let storage: MemoryStorage;
  let authApi: {
    login: ReturnType<typeof vi.fn>;
    currentSession: ReturnType<typeof vi.fn>;
    completePasswordChange: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    storage = new MemoryStorage();
    authApi = {
      login: vi.fn(),
      currentSession: vi.fn(),
      completePasswordChange: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        AuthSessionStore,
        TokenStorage,
        { provide: SESSION_STORAGE, useValue: storage },
        { provide: AuthApi, useValue: authApi },
      ],
    });
  });

  it('becomes anonymous without contacting /auth/me when no token exists', async () => {
    const store = TestBed.inject(AuthSessionStore);

    await store.restore();

    expect(store.status()).toBe('anonymous');
    expect(authApi.currentSession).not.toHaveBeenCalled();
  });

  it('restores a normal session from /auth/me without decoding the stored token', async () => {
    storage.setItem('pulsedesk.access-token', 'opaque-token');
    authApi.currentSession.mockReturnValue(of({ session_type: SessionType.NORMAL, user: USER }));
    const store = TestBed.inject(AuthSessionStore);

    await store.restore();

    expect(store.currentUser()).toEqual(USER);
    expect(store.status()).toBe('authenticated');
    expect(store.hasNormalSession()).toBe(true);
  });

  it('restores a password-change-required session from /auth/me', async () => {
    storage.setItem('pulsedesk.access-token', 'restricted-token');
    authApi.currentSession.mockReturnValue(
      of({ session_type: SessionType.PASSWORD_CHANGE_REQUIRED, user: USER }),
    );
    const store = TestBed.inject(AuthSessionStore);

    await store.restore();

    expect(store.status()).toBe('password-change-required');
    expect(store.requiresPasswordChange()).toBe(true);
    expect(store.currentUser()).toEqual(USER);
  });

  it('clears an invalid token after /auth/me returns 401', async () => {
    storage.setItem('pulsedesk.access-token', 'expired-token');
    authApi.currentSession.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );
    const store = TestBed.inject(AuthSessionStore);

    await store.restore();

    expect(store.status()).toBe('anonymous');
    expect(storage.getItem('pulsedesk.access-token')).toBeNull();
  });

  it('establishes a normal session directly from the login contract', async () => {
    authApi.login.mockReturnValue(
      of({
        access_token: 'new-token',
        token_type: 'bearer',
        session_type: SessionType.NORMAL,
        user: USER,
      }),
    );
    const store = TestBed.inject(AuthSessionStore);

    await firstValueFrom(store.signIn({ email: 'alex@example.com', password: 'secret' }));

    expect(storage.getItem('pulsedesk.access-token')).toBe('new-token');
    expect(store.currentUser()).toEqual(USER);
    expect(store.hasNormalSession()).toBe(true);
    expect(authApi.currentSession).not.toHaveBeenCalled();
  });

  it('establishes a restricted session directly from login', async () => {
    authApi.login.mockReturnValue(
      of({
        access_token: 'restricted-token',
        token_type: 'bearer',
        session_type: SessionType.PASSWORD_CHANGE_REQUIRED,
        user: USER,
      }),
    );
    const store = TestBed.inject(AuthSessionStore);

    await firstValueFrom(store.signIn({ email: 'alex@example.com', password: 'temporary' }));

    expect(storage.getItem('pulsedesk.access-token')).toBe('restricted-token');
    expect(store.requiresPasswordChange()).toBe(true);
  });

  it('rotates the restricted token and session after password completion', async () => {
    authApi.login.mockReturnValue(
      of({
        access_token: 'restricted-token',
        session_type: SessionType.PASSWORD_CHANGE_REQUIRED,
        user: USER,
      }),
    );
    authApi.completePasswordChange.mockReturnValue(
      of({ access_token: 'access-token', session_type: SessionType.NORMAL, user: USER }),
    );
    const store = TestBed.inject(AuthSessionStore);
    await firstValueFrom(store.signIn({ email: 'alex@example.com', password: 'temporary' }));

    await firstValueFrom(
      store.completePasswordChange({
        new_password: 'new-password',
        confirm_new_password: 'new-password',
      }),
    );

    expect(storage.getItem('pulsedesk.access-token')).toBe('access-token');
    expect(store.hasNormalSession()).toBe(true);
    expect(store.requiresPasswordChange()).toBe(false);
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
