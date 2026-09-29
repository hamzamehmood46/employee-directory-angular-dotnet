export interface Department {
  id: number;
  name: string;
  employeeCount: number;
}

export interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  departmentId: number;
  departmentName: string;
  hireDate: string; // yyyy-MM-dd
  isActive: boolean;
  createdAt: string;
}

export interface EmployeeInput {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  departmentId: number;
  hireDate: string;
  isActive: boolean;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export type SortDirection = 'asc' | 'desc';

export interface EmployeeQuery {
  search: string;
  departmentId: number | null;
  includeInactive: boolean;
  sort: string;
  dir: SortDirection;
  page: number;
  pageSize: number;
}

export interface DepartmentHeadcount {
  id: number;
  name: string;
  active: number;
  total: number;
}

export interface Summary {
  totalEmployees: number;
  activeEmployees: number;
  departments: DepartmentHeadcount[];
}
