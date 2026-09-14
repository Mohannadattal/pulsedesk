import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { AuthenticationApi } from '../../api/generated/api/authentication.service';
import { AccessTokenResponse } from '../../api/generated/model/accessTokenResponse';
import { LoginRequest } from '../../api/generated/model/loginRequest';
import { UserResponse } from '../../api/generated/model/userResponse';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(AuthenticationApi);

  login(credentials: LoginRequest): Observable<AccessTokenResponse> {
    return this.api.login(credentials, 'body', false, { transferCache: false });
  }

  currentUser(): Observable<UserResponse> {
    return this.api.getCurrentUser('body', false, { transferCache: false });
  }
}
