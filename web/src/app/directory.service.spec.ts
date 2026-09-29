import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FormControl, ValidationErrors, Validators } from '@angular/forms';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, DirectoryService, errorMessage, uniqueEmail } from './directory.service';
import { EmployeeQuery } from './models';

const api = 'http://api.test/api';

const baseQuery: EmployeeQuery = {
  search: '', departmentId: null, includeInactive: false, sort: 'name', dir: 'asc', page: 1, pageSize: 8,
};

describe('DirectoryService', () => {
  let service: DirectoryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: api }],
    });
    service = TestBed.inject(DirectoryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('always sends sort, direction and paging, and only the filters that are set', () => {
    service.listEmployees(baseQuery).subscribe();

    const plain = http.expectOne((r) => r.url === `${api}/employees`);
    expect(plain.request.params.get('sort')).toBe('name');
    expect(plain.request.params.get('pageSize')).toBe('8');
    expect(['search', 'departmentId', 'includeInactive'].some((p) => plain.request.params.has(p))).toBe(false);
    plain.flush({ items: [], page: 1, pageSize: 8, totalCount: 0 });

    service.listEmployees({ ...baseQuery, search: '  ada ', departmentId: 3, includeInactive: true }).subscribe();
    const filtered = http.expectOne((r) => r.url === `${api}/employees`);
    expect(filtered.request.params.get('search')).toBe('ada');
    expect(filtered.request.params.get('departmentId')).toBe('3');
    expect(filtered.request.params.get('includeInactive')).toBe('true');
    filtered.flush({ items: [], page: 1, pageSize: 8, totalCount: 0 });
  });

  it('maps employee operations to the right verbs and URLs', () => {
    const input = { firstName: 'A', lastName: 'B', email: 'a@b.co', jobTitle: 'T', departmentId: 1, hireDate: '2022-01-01', isActive: true };

    service.getEmployee(4).subscribe();
    expect(http.expectOne(`${api}/employees/4`).request.method).toBe('GET');

    service.createEmployee(input).subscribe();
    expect(http.expectOne(`${api}/employees`).request.body).toEqual(input);

    service.updateEmployee(4, input).subscribe();
    expect(http.expectOne(`${api}/employees/4`).request.method).toBe('PUT');

    service.deleteEmployee(4).subscribe();
    expect(http.expectOne(`${api}/employees/4`).request.method).toBe('DELETE');

    service.setActive(4, false).subscribe();
    expect(http.expectOne(`${api}/employees/4/deactivate`).request.method).toBe('POST');

    service.setActive(4, true).subscribe();
    expect(http.expectOne(`${api}/employees/4/reactivate`).request.method).toBe('POST');
  });

  it('maps department operations and the summary', () => {
    service.listDepartments().subscribe();
    expect(http.expectOne(`${api}/departments`).request.method).toBe('GET');
    service.createDepartment('Ops').subscribe();
    expect(http.expectOne(`${api}/departments`).request.body).toEqual({ name: 'Ops' });
    service.renameDepartment(2, 'Operations').subscribe();
    expect(http.expectOne(`${api}/departments/2`).request.body).toEqual({ name: 'Operations' });
    service.deleteDepartment(2).subscribe();
    expect(http.expectOne(`${api}/departments/2`).request.method).toBe('DELETE');
    service.summary().subscribe();
    expect(http.expectOne(`${api}/summary`).request.method).toBe('GET');
  });

  it('asks whether an email is available, optionally excluding the employee being edited', () => {
    let result: boolean | undefined;
    service.emailAvailable('a@b.co', 7).subscribe((v) => (result = v));

    const req = http.expectOne((r) => r.url === `${api}/employees/email-available`);
    expect(req.request.params.get('email')).toBe('a@b.co');
    expect(req.request.params.get('excludeId')).toBe('7');
    req.flush({ available: false });
    expect(result).toBe(false);

    service.emailAvailable('x@y.co').subscribe();
    expect(http.expectOne((r) => r.url === `${api}/employees/email-available`).request.params.has('excludeId')).toBe(false);
  });
});

describe('uniqueEmail async validator', () => {
  let service: DirectoryService;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: api }],
    });
    service = TestBed.inject(DirectoryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  const validate = (value: string, excludeId?: number) => {
    const control = new FormControl(value, [Validators.required, Validators.email]);
    const result = uniqueEmail(service, () => excludeId)(control);
    expect(isObservable(result)).toBe(true);
    return { control, promise: firstValueFrom(result as Observable<ValidationErrors | null>) };
  };

  it('does not call the API for an empty or malformed email', async () => {
    for (const value of ['', '   ', 'not-an-email']) {
      const { promise } = validate(value);
      await vi.advanceTimersByTimeAsync(500);
      expect(await promise).toBeNull();
    }
    http.expectNone((r) => r.url.endsWith('/email-available'));
  });

  it('waits for the debounce before asking the API', async () => {
    const { promise } = validate('ada@example.com');

    await vi.advanceTimersByTimeAsync(399);
    http.expectNone((r) => r.url.endsWith('/email-available'));

    await vi.advanceTimersByTimeAsync(1);
    http.expectOne((r) => r.url.endsWith('/email-available')).flush({ available: true });
    expect(await promise).toBeNull();
  });

  it('reports a taken email', async () => {
    const { promise } = validate('taken@example.com');

    await vi.advanceTimersByTimeAsync(400);
    http.expectOne((r) => r.url.endsWith('/email-available')).flush({ available: false });

    expect(await promise).toEqual({ taken: true });
  });

  it('passes the employee being edited so their own email is not "taken"', async () => {
    const { promise } = validate('me@example.com', 12);

    await vi.advanceTimersByTimeAsync(400);
    const req = http.expectOne((r) => r.url.endsWith('/email-available'));
    expect(req.request.params.get('excludeId')).toBe('12');
    req.flush({ available: true });
    await promise;
  });

  it('treats a network failure as "unknown", never as "taken", so a flaky connection cannot block the form', async () => {
    const { promise } = validate('ada@example.com');

    await vi.advanceTimersByTimeAsync(400);
    http.expectOne((r) => r.url.endsWith('/email-available')).error(new ProgressEvent('error'));

    expect(await promise).toBeNull();
  });

  it('cancels a stale check when the value changes again (no request for the superseded value)', async () => {
    const control = new FormControl('', [Validators.required, Validators.email]);
    control.setAsyncValidators(uniqueEmail(service, () => undefined));

    control.setValue('first@example.com');
    await vi.advanceTimersByTimeAsync(200);
    control.setValue('second@example.com');
    await vi.advanceTimersByTimeAsync(400);

    const requests = http.match((r) => r.url.endsWith('/email-available'));
    expect(requests.length).toBe(1);
    expect(requests[0].request.params.get('email')).toBe('second@example.com');
    requests[0].flush({ available: true });
  });
});

describe('errorMessage', () => {
  const failure = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

  it('prefers problem-details detail, then title, then the status', () => {
    expect(errorMessage(failure(409, { title: 'Conflict', detail: 'Email x is already in use.' }))).toBe('Email x is already in use.');
    expect(errorMessage(failure(409, { title: 'Conflict' }))).toBe('Conflict');
    expect(errorMessage(failure(500, null))).toBe('Request failed (500).');
  });

  it('joins ASP.NET validation errors and explains network failures', () => {
    expect(errorMessage(failure(400, { errors: { HireDate: ['Hire date cannot be in the future.'], Email: ['Bad.'] } }))).toBe('Hire date cannot be in the future. Bad.');
    expect(errorMessage(failure(0, null))).toContain('Cannot reach the server');
    expect(errorMessage(new Error('x'))).toBe('Something went wrong.');
  });
});
