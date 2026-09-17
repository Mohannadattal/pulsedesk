import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { AuthenticationApi } from '../../api/generated/api/authentication.service';
import { AuthSessionResponse } from '../../api/generated/model/authSessionResponse';
import { AuthSessionStateResponse } from '../../api/generated/model/authSessionStateResponse';
import { CompletePasswordChangeRequest } from '../../api/generated/model/completePasswordChangeRequest';
import { LoginRequest } from '../../api/generated/model/loginRequest';
import { PasswordResetRequestAcceptedResponse } from '../../api/generated/model/passwordResetRequestAcceptedResponse';
import { PasswordResetRequestCreate } from '../../api/generated/model/passwordResetRequestCreate';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(AuthenticationApi);

  login(credentials: LoginRequest): Observable<AuthSessionResponse> {
    return this.api.login(credentials, 'body', false, { transferCache: false });
  }

  currentSession(): Observable<AuthSessionStateResponse> {
    return this.api.getCurrentUser('body', false, { transferCache: false });
  }

  completePasswordChange(request: CompletePasswordChangeRequest): Observable<AuthSessionResponse> {
    return this.api.completePasswordChange(request, 'body', false, { transferCache: false });
  }

  requestPasswordReset(
    request: PasswordResetRequestCreate,
  ): Observable<PasswordResetRequestAcceptedResponse> {
    return this.api.requestPasswordReset(request, 'body', false, { transferCache: false });
  }
}
