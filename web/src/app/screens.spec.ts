import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { Dashboard } from './dashboard';
import { Departments } from './departments';
import { API_BASE } from './directory.service';
import { EmployeeForm } from './employee-form';
import { EmployeeList } from './employee-list';
import { Department, Employee, Paged, Summary } from './models';

const api = 'http://api.test/api';

const employee = (id: number, over: Partial<Employee> = {}): Employee => ({
  id, firstName: `First${id}`, lastName: `Last${id}`, email: `person${id}@example.com`, jobTitle: 'Engineer',
  departmentId: 1, departmentName: 'Engineering', hireDate: '2022-05-09', isActive: true, createdAt: '2026-01-01T00:00:00Z', ...over,
});
const page = (items: Employee[], total = items.length, no = 1): Paged<Employee> => ({ items, page: no, pageSize: 8, totalCount: total });
const departments: Department[] = [
  { id: 1, name: 'Engineering', employeeCount: 4 },
  { id: 2, name: 'Sales', employeeCount: 0 },
];

const text = (f: ComponentFixture<unknown>) => (f.nativeElement as HTMLElement).textContent ?? '';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: API_BASE, useValue: api }],
  });
  return TestBed.inject(HttpTestingController);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('App shell', () => {
  it('renders the brand and the three sections', async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.brand')?.textContent).toContain('Employee Directory');
    expect(Array.from(el.querySelectorAll('nav a')).map((a) => a.textContent?.trim())).toEqual(['Overview', 'Employees', 'Departments']);
  });
});

describe('Dashboard', () => {
  let http: HttpTestingController;
  const summary: Summary = {
    totalEmployees: 10,
    activeEmployees: 8,
    departments: [
      { id: 1, name: 'Engineering', active: 4, total: 4 },
      { id: 2, name: 'Sales', active: 2, total: 3 },
      { id: 3, name: 'Empty', active: 0, total: 0 },
    ],
  };

  beforeEach(() => (http = setup()));
  afterEach(() => http.verify());

  it('shows totals and scales each bar relative to the largest department', () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    http.expectOne(`${api}/summary`).flush(summary);
    fixture.detectChanges();

    const tiles = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.tile b')).map((b) => b.textContent);
    expect(tiles).toEqual(['8', '2', '3']); // active, inactive (10 - 8), departments

    const widths = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.bar-fill')).map((b) => b.style.width);
    expect(widths).toEqual(['100%', '50%', '0%']);
  });

  it('links each department to the filtered employee list', () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    http.expectOne(`${api}/summary`).flush(summary);
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector('.bar-label') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('departmentId=1');
  });

  it('shows an error when the API is down', () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    http.expectOne(`${api}/summary`).error(new ProgressEvent('error'));
    fixture.detectChanges();

    expect(text(fixture)).toContain('Cannot reach the server');
  });
});

describe('EmployeeList', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<EmployeeList>;
  let component: EmployeeList;

  const requests = () => http.match((r) => r.url === `${api}/employees` && r.method === 'GET');
  const last = (reqs: TestRequest[]) => reqs[reqs.length - 1];

  function start(first: Paged<Employee> = page([employee(1), employee(2)]), departmentId?: string) {
    http = setup();
    fixture = TestBed.createComponent(EmployeeList);
    component = fixture.componentInstance;
    if (departmentId) fixture.componentRef.setInput('departmentId', departmentId);
    fixture.detectChanges();
    http.expectOne(`${api}/departments`).flush(departments);
    http.expectOne((r) => r.url === `${api}/employees`).flush(first);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('renders a row per employee with their email', () => {
    start();

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
    expect(text(fixture)).toContain('First1 Last1');
    expect(text(fixture)).toContain('person2@example.com');
    expect(text(fixture)).toContain('1-2 of 2');
  });

  it('starts filtered when opened from the dashboard with a department', () => {
    http = setup();
    fixture = TestBed.createComponent(EmployeeList);
    fixture.componentRef.setInput('departmentId', '2');
    fixture.detectChanges();
    http.expectOne(`${api}/departments`).flush(departments);

    const req = http.expectOne((r) => r.url === `${api}/employees`);
    expect(req.request.params.get('departmentId')).toBe('2');
    req.flush(page([]));
  });

  it('hides inactive people by default and can include them', () => {
    start();
    expect(requests().length).toBe(0);

    component.setIncludeInactive(true);

    const req = last(requests());
    expect(req.request.params.get('includeInactive')).toBe('true');
    req.flush(page([employee(1, { isActive: false })]));
    fixture.detectChanges();
    expect(text(fixture)).toContain('Inactive');
  });

  it('debounces the search box and returns to page 1', () => {
    vi.useFakeTimers();
    start(page([employee(1)], 20));

    component.onSearch('a');
    component.onSearch('ad');
    expect(requests().length).toBe(0);
    vi.advanceTimersByTime(300);

    const reqs = requests();
    expect(reqs.length).toBe(1);
    expect(reqs[0].request.params.get('search')).toBe('ad');
    expect(reqs[0].request.params.get('page')).toBe('1');
    reqs[0].flush(page([]));
  });

  it('sorts ascending first and flips direction on the same column', () => {
    start();

    component.sortBy('hired');
    let req = last(requests());
    expect([req.request.params.get('sort'), req.request.params.get('dir')]).toEqual(['hired', 'asc']);
    req.flush(page([]));

    component.sortBy('hired');
    req = last(requests());
    expect(req.request.params.get('dir')).toBe('desc');
    req.flush(page([]));
    expect(component.arrow('hired')).toBe('▼');
  });

  it('pages within bounds', () => {
    start(page([employee(1)], 20));
    expect(component.totalPages()).toBe(3);

    component.goTo(0);
    component.goTo(4);
    expect(requests().length).toBe(0);

    component.goTo(2);
    const req = last(requests());
    expect(req.request.params.get('page')).toBe('2');
    req.flush(page([employee(9)], 20, 2));
  });

  it('deactivates an employee and reloads (the default list hides inactive people)', () => {
    start();

    component.toggleActive(employee(1));
    http.expectOne(`${api}/employees/1/deactivate`).flush(employee(1, { isActive: false }));

    last(requests()).flush(page([employee(2)]));
  });

  it('reactivates an inactive employee', () => {
    start(page([employee(1, { isActive: false })]));

    component.toggleActive(employee(1, { isActive: false }));

    http.expectOne(`${api}/employees/1/reactivate`).flush(employee(1));
    last(requests()).flush(page([employee(1)]));
  });

  it('only deletes after confirmation, then reloads', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    start();

    component.remove(employee(1));
    http.expectNone((r) => r.method === 'DELETE');

    confirm.mockReturnValue(true);
    component.remove(employee(1));
    http.expectOne((r) => r.method === 'DELETE' && r.url === `${api}/employees/1`).flush(null);
    last(requests()).flush(page([employee(2)]));
  });

  it('steps back a page when the last row on a later page is deleted', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    start(page([employee(1)], 9));
    component.goTo(2);
    last(requests()).flush(page([employee(9)], 9, 2));

    component.remove(employee(9));
    http.expectOne((r) => r.method === 'DELETE').flush(null);

    const req = last(requests());
    expect(req.request.params.get('page')).toBe('1');
    req.flush(page([employee(1)], 8));
  });

  it('shows an empty state', () => {
    start(page([], 0));

    expect(text(fixture)).toContain('No employees match your filters.');
  });
});

describe('EmployeeForm', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<EmployeeForm>;
  let component: EmployeeForm;
  let navigate: ReturnType<typeof vi.spyOn>;

  const fill = (over: Record<string, unknown> = {}) =>
    component.form.setValue({
      firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', jobTitle: 'Engineer',
      departmentId: 1, hireDate: '2022-05-09', isActive: true, ...over,
    } as never);

  /** Fills the form, waits out the email debounce and answers the availability check. */
  async function settleEmail(available = true) {
    await vi.advanceTimersByTimeAsync(400);
    http.expectOne((r) => r.url === `${api}/employees/email-available`).flush({ available });
    fixture.detectChanges();
  }

  function start(id?: string) {
    vi.useFakeTimers();
    http = setup();
    fixture = TestBed.createComponent(EmployeeForm);
    component = fixture.componentInstance;
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    if (id) fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    http.expectOne(`${api}/departments`).flush(departments);
  }

  afterEach(() => http.verify());

  it('starts invalid in create mode', () => {
    start();

    expect(component.isEdit()).toBe(false);
    expect(component.form.valid).toBe(false);
  });

  it('shows what is missing when submitted empty and sends nothing', () => {
    start();

    component.save();
    fixture.detectChanges();

    http.expectNone((r) => r.method === 'POST');
    for (const m of ['First name is required.', 'Last name is required.', 'Email is required.', 'Job title is required.', 'Choose a department.', 'Hire date is required.'])
      expect(text(fixture)).toContain(m);
  });

  it('validates the email format before ever calling the API', () => {
    start();

    fill({ email: 'not-an-email' });
    component.form.controls.email.markAsTouched();
    fixture.detectChanges();

    expect(component.form.controls.email.errors?.['email']).toBeTruthy();
    http.expectNone((r) => r.url.endsWith('/email-available'));
    expect(text(fixture)).toContain('Enter a valid email address.');
  });

  it('rejects a hire date in the future', () => {
    start();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    component.form.controls.hireDate.setValue(tomorrow);

    expect(component.form.controls.hireDate.errors?.['future']).toBe(true);
  });

  it('shows "Checking..." while the availability request is in flight, then confirms', async () => {
    start();
    fill();
    component.form.controls.email.markAsDirty();
    fixture.detectChanges();

    expect(component.form.controls.email.pending).toBe(true);
    expect(text(fixture)).toContain('Checking availability');

    await settleEmail(true);

    expect(component.form.controls.email.valid).toBe(true);
    expect(text(fixture)).toContain('Email is available.');
  });

  it('flags a taken email and blocks saving', async () => {
    start();
    fill({ email: 'taken@example.com' });
    component.form.controls.email.markAsDirty();
    await settleEmail(false);

    expect(component.form.controls.email.errors?.['taken']).toBe(true);
    expect(text(fixture)).toContain('That email is already in use.');

    component.save();
    http.expectNone((r) => r.method === 'POST');
  });

  it('does not submit while the email check is still pending', () => {
    start();
    fill();

    component.save();

    http.expectNone((r) => r.method === 'POST');
  });

  it('creates the employee and returns to the list', async () => {
    start();
    fill();
    await settleEmail(true);

    component.save();

    const req = http.expectOne((r) => r.method === 'POST' && r.url === `${api}/employees`);
    expect(req.request.body).toEqual({
      firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', jobTitle: 'Engineer',
      departmentId: 1, hireDate: '2022-05-09', isActive: true,
    });
    req.flush(employee(5));
    expect(navigate).toHaveBeenCalledWith(['/employees']);
  });

  it('shows the server message if the email was taken in the meantime', async () => {
    start();
    fill();
    await settleEmail(true);

    component.save();
    http.expectOne((r) => r.method === 'POST').flush({ title: 'Conflict', detail: 'Email ada@example.com is already in use.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(text(fixture)).toContain('already in use');
    expect(component.saving()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('edits an existing employee: loads them, keeps their own email valid, and saves with PUT', async () => {
    start('5');
    http.expectOne(`${api}/employees/5`).flush(employee(5, { email: 'me@example.com' }));
    fixture.detectChanges();
    expect(component.isEdit()).toBe(true);
    expect(component.form.controls.firstName.value).toBe('First5');

    // Changing the email asks the API to ignore employee 5 when checking for duplicates.
    component.form.controls.email.setValue('me@example.com');
    await vi.advanceTimersByTimeAsync(400);
    const check = http.expectOne((r) => r.url === `${api}/employees/email-available`);
    expect(check.request.params.get('excludeId')).toBe('5');
    check.flush({ available: true });

    component.save();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${api}/employees/5`);
    put.flush(employee(5));
    expect(navigate).toHaveBeenCalledWith(['/employees']);
  });
});

describe('Departments', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<Departments>;
  let component: Departments;

  function start(list: Department[] = departments) {
    http = setup();
    fixture = TestBed.createComponent(Departments);
    component = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(`${api}/departments`).flush(list);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('lists departments with employee counts', () => {
    start();

    expect(text(fixture)).toContain('Engineering');
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('adds a department, trims and clears the input, then reloads', () => {
    start();
    component.newName = '  Legal  ';

    component.add();
    const post = http.expectOne((r) => r.method === 'POST');
    expect(post.request.body).toEqual({ name: 'Legal' });
    post.flush({ id: 3, name: 'Legal', employeeCount: 0 });

    expect(component.newName).toBe('');
    http.expectOne(`${api}/departments`).flush([...departments, { id: 3, name: 'Legal', employeeCount: 0 }]);
  });

  it('ignores blank names', () => {
    start();
    component.newName = '   ';

    component.add();

    http.expectNone((r) => r.method === 'POST');
  });

  it('renames a department', () => {
    start();

    component.startEdit(departments[1]);
    component.editName = 'Revenue';
    component.saveEdit(departments[1]);

    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${api}/departments/2`);
    expect(put.request.body).toEqual({ name: 'Revenue' });
    put.flush(null);
    http.expectOne(`${api}/departments`).flush(departments);
    expect(component.editingId()).toBeNull();
  });

  it('only allows deleting a department with no employees, and confirms first', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    start();
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button.danger')) as HTMLButtonElement[];
    expect(buttons[0].disabled).toBe(true);  // Engineering has 4 people
    expect(buttons[1].disabled).toBe(false); // Sales is empty

    component.remove(departments[1]);
    http.expectNone((r) => r.method === 'DELETE');

    confirm.mockReturnValue(true);
    component.remove(departments[1]);
    http.expectOne((r) => r.method === 'DELETE' && r.url === `${api}/departments/2`).flush(null);
    http.expectOne(`${api}/departments`).flush([departments[0]]);
  });

  it('shows server errors such as a duplicate name', () => {
    start();
    component.newName = 'Sales';

    component.add();
    http.expectOne((r) => r.method === 'POST').flush({ title: 'Conflict', detail: 'A department with that name already exists.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(text(fixture)).toContain('A department with that name already exists.');
  });
});
