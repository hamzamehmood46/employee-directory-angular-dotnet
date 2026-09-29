import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { Observable, catchError, map, of, switchMap, timer } from 'rxjs';
import { Department, Employee, EmployeeInput, EmployeeQuery, Paged, Summary } from './models';

/** Base URL of the ASP.NET Core API. Override in app.config.ts for other environments. */
export const API_BASE = new InjectionToken<string>('API_BASE', {
  providedIn: 'root',
  factory: () => 'http://localhost:5070/api',
});

@Injectable({ providedIn: 'root' })
export class DirectoryService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE);

  summary(): Observable<Summary> {
    return this.http.get<Summary>(`${this.base}/summary`);
  }

  listEmployees(q: EmployeeQuery): Observable<Paged<Employee>> {
    let params = new HttpParams()
      .set('sort', q.sort)
      .set('dir', q.dir)
      .set('page', q.page)
      .set('pageSize', q.pageSize);
    if (q.search.trim()) params = params.set('search', q.search.trim());
    if (q.departmentId) params = params.set('departmentId', q.departmentId);
    if (q.includeInactive) params = params.set('includeInactive', true);
    return this.http.get<Paged<Employee>>(`${this.base}/employees`, { params });
  }

  getEmployee(id: number): Observable<Employee> {
    return this.http.get<Employee>(`${this.base}/employees/${id}`);
  }

  createEmployee(input: EmployeeInput): Observable<Employee> {
    return this.http.post<Employee>(`${this.base}/employees`, input);
  }

  updateEmployee(id: number, input: EmployeeInput): Observable<Employee> {
    return this.http.put<Employee>(`${this.base}/employees/${id}`, input);
  }

  deleteEmployee(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/employees/${id}`);
  }

  setActive(id: number, active: boolean): Observable<Employee> {
    return this.http.post<Employee>(`${this.base}/employees/${id}/${active ? 'reactivate' : 'deactivate'}`, {});
  }

  emailAvailable(email: string, excludeId?: number): Observable<boolean> {
    let params = new HttpParams().set('email', email);
    if (excludeId) params = params.set('excludeId', excludeId);
    return this.http
      .get<{ available: boolean }>(`${this.base}/employees/email-available`, { params })
      .pipe(map((r) => r.available));
  }

  listDepartments(): Observable<Department[]> {
    return this.http.get<Department[]>(`${this.base}/departments`);
  }

  createDepartment(name: string): Observable<Department> {
    return this.http.post<Department>(`${this.base}/departments`, { name });
  }

  renameDepartment(id: number, name: string): Observable<void> {
    return this.http.put<void>(`${this.base}/departments/${id}`, { name });
  }

  deleteDepartment(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/departments/${id}`);
  }
}

/**
 * Async validator that asks the API whether an email is free, without firing a request per keystroke.
 * Returning a timer first makes Angular cancel the previous pending check (switchMap) when the value
 * changes again within the debounce window. Network failures are treated as "unknown", not "taken",
 * so a flaky connection never blocks the form; the API still enforces uniqueness on save.
 */
export function uniqueEmail(service: DirectoryService, excludeId: () => number | undefined, debounceMs = 400): AsyncValidatorFn {
  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    const value = String(control.value ?? '').trim();
    if (!value || control.hasError('email') || control.hasError('required')) return of(null);

    return timer(debounceMs).pipe(
      switchMap(() => service.emailAvailable(value, excludeId())),
      map((available) => (available ? null : { taken: true })),
      catchError(() => of(null)),
    );
  };
}

/** Turns an API error (problem details, ASP.NET validation errors, network failure) into readable text. */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Cannot reach the server. Is the API running?';

    const body = error.error as { detail?: string; title?: string; errors?: Record<string, string[]> } | null;
    if (body?.errors) return Object.values(body.errors).flat().join(' ');
    if (body?.detail) return body.detail;
    if (body?.title) return body.title;
    return `Request failed (${error.status}).`;
  }
  return 'Something went wrong.';
}
