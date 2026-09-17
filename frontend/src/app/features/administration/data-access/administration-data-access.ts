import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { AdministrationApi } from '../../../api/generated/api/administration.service';
import { CategoriesApi } from '../../../api/generated/api/categories.service';
import { UsersApi } from '../../../api/generated/api/users.service';
import { CategoryCreate } from '../../../api/generated/model/categoryCreate';
import { CategoryUpdate } from '../../../api/generated/model/categoryUpdate';
import { PasswordResetRequestResponse } from '../../../api/generated/model/passwordResetRequestResponse';
import { PasswordResetRequestStatus } from '../../../api/generated/model/passwordResetRequestStatus';
import { UserProvisionRequest } from '../../../api/generated/model/userProvisionRequest';
import { UserResponse } from '../../../api/generated/model/userResponse';
import { AdminUserFilters } from '../domain/admin-user-filters';

export interface AdminUser {
  readonly id: number;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: UserResponse['role'];
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminUserPage {
  readonly items: readonly AdminUser[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface AdminCategory {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminPasswordResetRequest {
  readonly id: number;
  readonly requestedAt: Date;
  readonly user: {
    readonly id: number;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly role: UserResponse['role'];
    readonly isActive: boolean;
  };
}

export interface AdminPasswordResetPage {
  readonly items: readonly AdminPasswordResetRequest[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

@Injectable({ providedIn: 'root' })
export class AdministrationDataAccess {
  private readonly administrationApi = inject(AdministrationApi);
  private readonly usersApi = inject(UsersApi);
  private readonly categoriesApi = inject(CategoriesApi);

  listUsers(filters: AdminUserFilters): Observable<AdminUserPage> {
    return this.administrationApi
      .listAdminUsers(
        filters.role,
        filters.isActive,
        filters.page,
        filters.pageSize,
        'body',
        false,
        {
          transferCache: false,
        },
      )
      .pipe(
        map((response) => ({
          items: response.items.map(mapUser),
          page: response.page,
          pageSize: response.page_size,
          total: response.total,
          totalPages: response.total_pages,
        })),
      );
  }

  provisionUser(request: UserProvisionRequest): Observable<AdminUser> {
    return this.usersApi
      .createUser(request, 'body', false, { transferCache: false })
      .pipe(map(mapUser));
  }

  updateUserActivation(userId: number, isActive: boolean): Observable<AdminUser> {
    return this.usersApi
      .updateUserActivation(userId, { is_active: isActive }, 'body', false, {
        transferCache: false,
      })
      .pipe(map(mapUser));
  }

  listPendingPasswordResets(page: number, pageSize: number): Observable<AdminPasswordResetPage> {
    return this.administrationApi
      .listPasswordResetRequests(
        PasswordResetRequestStatus.PENDING,
        page,
        pageSize,
        'body',
        false,
        { transferCache: false },
      )
      .pipe(
        map((response) => ({
          items: response.items.map(mapPasswordResetRequest),
          page: response.page,
          pageSize: response.page_size,
          total: response.total,
          totalPages: response.total_pages,
        })),
      );
  }

  resetUserPassword(
    requestId: number,
    temporaryPassword: string,
    confirmation: string,
  ): Observable<AdminPasswordResetRequest> {
    return this.administrationApi
      .resetUserPassword(
        requestId,
        {
          temporary_password: temporaryPassword,
          confirm_temporary_password: confirmation,
        },
        'body',
        false,
        { transferCache: false },
      )
      .pipe(map(mapPasswordResetRequest));
  }

  listCategories(includeInactive: boolean): Observable<readonly AdminCategory[]> {
    return this.categoriesApi
      .listCategories(includeInactive, 'body', false, { transferCache: false })
      .pipe(map((items) => items.map(mapCategory)));
  }

  createCategory(request: CategoryCreate): Observable<AdminCategory> {
    return this.categoriesApi
      .createCategory(request, 'body', false, { transferCache: false })
      .pipe(map(mapCategory));
  }

  updateCategory(categoryId: number, request: CategoryUpdate): Observable<AdminCategory> {
    return this.categoriesApi
      .updateCategory(categoryId, request, 'body', false, { transferCache: false })
      .pipe(map(mapCategory));
  }
}

function mapPasswordResetRequest(request: PasswordResetRequestResponse): AdminPasswordResetRequest {
  return {
    id: request.id,
    requestedAt: new Date(request.requested_at),
    user: {
      id: request.user.id,
      email: request.user.email,
      firstName: request.user.first_name,
      lastName: request.user.last_name,
      role: request.user.role,
      isActive: request.user.is_active,
    },
  };
}

function mapUser(user: UserResponse): AdminUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    isActive: user.is_active,
    createdAt: new Date(user.created_at),
    updatedAt: new Date(user.updated_at),
  };
}

function mapCategory(
  category: import('../../../api/generated/model/categoryResponse').CategoryResponse,
): AdminCategory {
  return {
    id: category.id,
    name: category.name,
    description: category.description ?? null,
    isActive: category.is_active,
    createdAt: new Date(category.created_at),
    updatedAt: new Date(category.updated_at),
  };
}
