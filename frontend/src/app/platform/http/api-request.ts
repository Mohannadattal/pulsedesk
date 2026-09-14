import { PulseDeskConfig } from '../config/app-config';

export function isPulseDeskApiRequest(requestUrl: string, config: PulseDeskConfig): boolean {
  try {
    const apiUrl = new URL(config.apiBaseUrl);
    const request = new URL(requestUrl, globalThis.location?.origin ?? apiUrl.origin);
    const apiPath = apiUrl.pathname.replace(/\/$/, '');

    return (
      request.origin === apiUrl.origin &&
      (request.pathname === apiPath || request.pathname.startsWith(`${apiPath}/`))
    );
  } catch {
    return false;
  }
}
