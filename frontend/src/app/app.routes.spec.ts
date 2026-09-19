import { routes } from './app.routes';
import { authGuard } from './platform/auth/auth.guards';

describe('application routes', () => {
  it('keeps notifications inside the authenticated shell for every authenticated role', () => {
    const shell = routes.find((route) => route.path === '');

    expect(shell?.canActivate).toContain(authGuard);
    expect(shell?.children?.some((route) => route.path === 'notifications')).toBe(true);
  });
});
