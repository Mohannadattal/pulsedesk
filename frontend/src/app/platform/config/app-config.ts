import { InjectionToken } from '@angular/core';

export interface PulseDeskConfig {
  readonly apiBaseUrl: string;
}

export const PULSE_DESK_CONFIG = new InjectionToken<PulseDeskConfig>('PULSE_DESK_CONFIG');

export const pulseDeskConfig: PulseDeskConfig = Object.freeze({
  apiBaseUrl: 'http://localhost:8000/api/v1',
});

export function apiTransportBasePath(config: PulseDeskConfig): string {
  return new URL(config.apiBaseUrl).origin;
}
