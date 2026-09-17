import { convertToParamMap } from '@angular/router';

import { UserRole } from '../../../api/generated/model/userRole';
import {
  ADMIN_PAGE_SIZE,
  adminUserFiltersToQueryParams,
  parseAdminUserFilters,
} from './admin-user-filters';

describe('admin user filters', () => {
  it('parses supported role, inactive state, and pagination', () => {
    expect(
      parseAdminUserFilters(
        convertToParamMap({ role: 'AGENT', isActive: 'false', page: '3', pageSize: '50' }),
      ),
    ).toEqual({ role: UserRole.AGENT, isActive: false, page: 3, pageSize: 50 });
  });

  it('canonicalizes invalid and explicit default values', () => {
    const filters = parseAdminUserFilters(
      convertToParamMap({ role: 'OWNER', isActive: 'yes', page: '-2', pageSize: '500' }),
    );
    expect(filters).toEqual({
      role: undefined,
      isActive: true,
      page: 1,
      pageSize: ADMIN_PAGE_SIZE,
    });
    expect(adminUserFiltersToQueryParams(filters)).toEqual({
      role: null,
      isActive: null,
      page: null,
      pageSize: null,
    });
  });

  it('preserves only server-supported URL filter state', () => {
    expect(
      adminUserFiltersToQueryParams({
        role: UserRole.ADMIN,
        isActive: false,
        page: 2,
        pageSize: 100,
      }),
    ).toEqual({ role: UserRole.ADMIN, isActive: 'false', page: 2, pageSize: 100 });
  });
});
