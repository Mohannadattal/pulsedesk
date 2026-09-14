import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

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
    currentUser: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    storage = new MemoryStorage();
    authApi = {
      login: vi.fn(),
      currentUser: vi.fn(),
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
    expect(authApi.currentUser).not.toHaveBeenCalled();
  });

  it('restores identity from /auth/me without decoding the stored token', async () => {
    storage.setItem('pulsedesk.access-token', 'opaque-token');
    authApi.currentUser.mockReturnValue(of(USER));
    const store = TestBed.inject(AuthSessionStore);

    await store.restore();

    expect(store.currentUser()).toEqual(USER);
    expect(store.status()).toBe('authenticated');
  });

  it('clears an invalid token after /auth/me returns 401', async () => {
    storage.setItem('pulsedesk.access-token', 'expired-token');
    authApi.currentUser.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
    const store = TestBed.inject(AuthSessionStore);

    await store.restore();

    expect(store.status()).toBe('anonymous');
    expect(storage.getItem('pulsedesk.access-token')).toBeNull();
  });

  it('persists the login token and then establishes identity through /auth/me', async () => {
    authApi.login.mockReturnValue(of({ access_token: 'new-token', token_type: 'bearer' }));
    authApi.currentUser.mockReturnValue(of(USER));
    const store = TestBed.inject(AuthSessionStore);

    await firstValueFrom(store.signIn({ email: 'alex@example.com', password: 'secret' }));

    expect(storage.getItem('pulsedesk.access-token')).toBe('new-token');
    expect(store.currentUser()).toEqual(USER);
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
