import { CustomerDirectoryResponse } from '../../../api/generated/model/customerDirectoryResponse';
import { CustomerProfileResponse } from '../../../api/generated/model/customerProfileResponse';
import { CustomerVerificationResponse } from '../../../api/generated/model/customerVerificationResponse';
import { VerificationFactor } from '../../../api/generated/model/verificationFactor';
import { parseUtcTimestamp } from '../../tickets/domain/ticket';

export interface CustomerSummary {
  readonly id: number;
  readonly customerNumber: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly isActive: boolean;
}

export interface Customer extends CustomerSummary {
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string | null;
  readonly street: string | null;
  readonly houseNumber: string | null;
  readonly postalCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CustomerPage {
  readonly items: readonly CustomerSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface CustomerVerification {
  readonly id: number;
  readonly customerId: number;
  readonly verifiedByUserId: number;
  readonly factors: readonly VerificationFactor[];
  readonly verifiedAt: Date;
  readonly expiresAt: Date;
}

export function mapCustomerSummary(dto: CustomerDirectoryResponse): CustomerSummary {
  return {
    id: dto.id,
    customerNumber: dto.customer_number,
    name: `${dto.first_name} ${dto.last_name}`.trim(),
    email: dto.email,
    phone: dto.phone,
    city: dto.city,
    country: dto.country,
    isActive: dto.is_active,
  };
}

export function mapCustomer(dto: CustomerProfileResponse): Customer {
  return {
    ...mapCustomerSummary(dto),
    firstName: dto.first_name,
    lastName: dto.last_name,
    dateOfBirth: dto.date_of_birth,
    street: dto.street,
    houseNumber: dto.house_number,
    postalCode: dto.postal_code,
    createdAt: parseUtcTimestamp(dto.created_at),
    updatedAt: parseUtcTimestamp(dto.updated_at),
  };
}

export function mapVerification(dto: CustomerVerificationResponse): CustomerVerification {
  return {
    id: dto.id,
    customerId: dto.customer_id,
    verifiedByUserId: dto.verified_by_user_id,
    factors: dto.factors,
    verifiedAt: parseUtcTimestamp(dto.verified_at),
    expiresAt: parseUtcTimestamp(dto.expires_at),
  };
}
