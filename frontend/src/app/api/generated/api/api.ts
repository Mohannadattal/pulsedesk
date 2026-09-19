export * from './administration.service';
import { AdministrationApi } from './administration.service';
export * from './administration.serviceInterface';
export * from './authentication.service';
import { AuthenticationApi } from './authentication.service';
export * from './authentication.serviceInterface';
export * from './categories.service';
import { CategoriesApi } from './categories.service';
export * from './categories.serviceInterface';
export * from './customers.service';
import { CustomersApi } from './customers.service';
export * from './customers.serviceInterface';
export * from './health.service';
import { HealthApi } from './health.service';
export * from './health.serviceInterface';
export * from './notifications.service';
import { NotificationsApi } from './notifications.service';
export * from './notifications.serviceInterface';
export * from './tickets.service';
import { TicketsApi } from './tickets.service';
export * from './tickets.serviceInterface';
export * from './users.service';
import { UsersApi } from './users.service';
export * from './users.serviceInterface';
export const APIS = [
  AdministrationApi,
  AuthenticationApi,
  CategoriesApi,
  CustomersApi,
  HealthApi,
  NotificationsApi,
  TicketsApi,
  UsersApi,
];
