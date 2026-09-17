import { ParamMap, Params } from '@angular/router';

import { UserRole } from '../../../api/generated/model/userRole';

export interface AdminUserFilters {
  readonly role?: UserRole;
  readonly isActive: boolean;
  readonly page: number;
  readonly pageSize: number;
}

export const ADMIN_PAGE_SIZE = 20;
export const ADMIN_PAGE_SIZES: readonly number[] = [10, 20, 50, 100];
export const USER_ROLES: readonly UserRole[] = Object.values(UserRole);

export function parseAdminUserFilters(params: ParamMap): AdminUserFilters {
  const roleValue = params.get('role');
  const pageSize = positiveInteger(params.get('pageSize'));
  return {
    role: USER_ROLES.includes(roleValue as UserRole) ? (roleValue as UserRole) : undefined,
    isActive: params.get('isActive') !== 'false',
    page: positiveInteger(params.get('page')) ?? 1,
    pageSize: pageSize && ADMIN_PAGE_SIZES.includes(pageSize) ? pageSize : ADMIN_PAGE_SIZE,
  };
}

export function adminUserFiltersToQueryParams(filters: AdminUserFilters): Params {
  return {
    role: filters.role ?? null,
    isActive: filters.isActive ? null : 'false',
    page: filters.page > 1 ? filters.page : null,
    pageSize: filters.pageSize !== ADMIN_PAGE_SIZE ? filters.pageSize : null,
  };
}

export function sameAdminUserFilters(left: AdminUserFilters, right: AdminUserFilters): boolean {
  return (
    left.role === right.role &&
    left.isActive === right.isActive &&
    left.page === right.page &&
    left.pageSize === right.pageSize
  );
}

function positiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
