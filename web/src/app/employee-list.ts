import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { DirectoryService, errorMessage } from './directory.service';
import { Department, Employee, EmployeeQuery, Paged } from './models';

@Component({
  selector: 'app-employee-list',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="page-header">
      <h1>Employees</h1>
      <a class="btn primary" routerLink="/employees/new">Add employee</a>
    </div>

    <div class="toolbar">
      <input
        type="search"
        placeholder="Search name, email or title"
        aria-label="Search employees"
        [ngModel]="query().search"
        (ngModelChange)="onSearch($event)"
      />
      <select aria-label="Filter by department" [ngModel]="query().departmentId" (ngModelChange)="setDepartment($event)">
        <option [ngValue]="null">All departments</option>
        @for (d of departments(); track d.id) {
          <option [ngValue]="d.id">{{ d.name }}</option>
        }
      </select>
      <label class="check">
        <input type="checkbox" [ngModel]="query().includeInactive" (ngModelChange)="setIncludeInactive($event)" />
        Show inactive
      </label>
    </div>

    @if (error()) {
      <p class="alert" role="alert">{{ error() }}</p>
    }

    <table>
      <thead>
        <tr>
          <th><button class="link" (click)="sortBy('name')">Name {{ arrow('name') }}</button></th>
          <th><button class="link" (click)="sortBy('title')">Title {{ arrow('title') }}</button></th>
          <th><button class="link" (click)="sortBy('department')">Department {{ arrow('department') }}</button></th>
          <th><button class="link" (click)="sortBy('hired')">Hired {{ arrow('hired') }}</button></th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        @for (e of employees(); track e.id) {
          <tr [class.inactive]="!e.isActive">
            <td>
              <strong>{{ e.firstName }} {{ e.lastName }}</strong>
              @if (!e.isActive) {
                <span class="badge">Inactive</span>
              }
              <div class="muted small-text">{{ e.email }}</div>
            </td>
            <td>{{ e.jobTitle }}</td>
            <td>{{ e.departmentName }}</td>
            <td>{{ e.hireDate | date: 'mediumDate' }}</td>
            <td class="actions">
              <a class="btn small" [routerLink]="['/employees', e.id, 'edit']">Edit</a>
              <button class="btn small" (click)="toggleActive(e)">{{ e.isActive ? 'Deactivate' : 'Reactivate' }}</button>
              <button class="btn small danger" (click)="remove(e)">Delete</button>
            </td>
          </tr>
        } @empty {
          <tr>
            <td colspan="5" class="empty">{{ loading() ? 'Loading...' : 'No employees match your filters.' }}</td>
          </tr>
        }
      </tbody>
    </table>

    <div class="pager">
      <span>{{ rangeLabel() }}</span>
      <div>
        <button class="btn small" (click)="goTo(query().page - 1)" [disabled]="query().page <= 1">Previous</button>
        <span class="page-num">Page {{ query().page }} of {{ totalPages() }}</span>
        <button class="btn small" (click)="goTo(query().page + 1)" [disabled]="query().page >= totalPages()">Next</button>
      </div>
    </div>
  `,
})
export class EmployeeList implements OnInit {
  private readonly api = inject(DirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly search$ = new Subject<string>();

  /** Query parameter, bound by withComponentInputBinding(); lets the dashboard link straight to a department. */
  readonly departmentId = input<string>();

  readonly query = signal<EmployeeQuery>({
    search: '',
    departmentId: null,
    includeInactive: false,
    sort: 'name',
    dir: 'asc',
    page: 1,
    pageSize: 8,
  });
  readonly result = signal<Paged<Employee> | null>(null);
  readonly departments = signal<Department[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly employees = computed(() => this.result()?.items ?? []);
  readonly totalPages = computed(() => {
    const r = this.result();
    return r ? Math.max(1, Math.ceil(r.totalCount / r.pageSize)) : 1;
  });
  readonly rangeLabel = computed(() => {
    const r = this.result();
    if (!r || r.totalCount === 0) return '0 employees';
    const from = (r.page - 1) * r.pageSize + 1;
    return `${from}-${from + r.items.length - 1} of ${r.totalCount}`;
  });

  ngOnInit(): void {
    const initial = Number(this.departmentId());
    if (initial) this.query.update((q) => ({ ...q, departmentId: initial }));

    this.api.listDepartments().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (d) => this.departments.set(d),
      error: (e) => this.error.set(errorMessage(e)),
    });

    // Wait for the user to stop typing before hitting the API.
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((term) => this.patch({ search: term, page: 1 }));

    this.load();
  }

  onSearch(term: string): void {
    this.query.update((q) => ({ ...q, search: term }));
    this.search$.next(term);
  }

  setDepartment(departmentId: number | null): void {
    this.patch({ departmentId, page: 1 });
  }

  setIncludeInactive(includeInactive: boolean): void {
    this.patch({ includeInactive, page: 1 });
  }

  sortBy(sort: string): void {
    const q = this.query();
    this.patch({ sort, dir: q.sort === sort && q.dir === 'asc' ? 'desc' : 'asc', page: 1 });
  }

  arrow(sort: string): string {
    const q = this.query();
    return q.sort === sort ? (q.dir === 'asc' ? '▲' : '▼') : '';
  }

  goTo(page: number): void {
    if (page >= 1 && page <= this.totalPages()) this.patch({ page });
  }

  toggleActive(employee: Employee): void {
    this.api.setActive(employee.id, !employee.isActive).subscribe({
      next: () => this.load(), // the default list hides inactive people, so reload rather than patch in place
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  remove(employee: Employee): void {
    if (!window.confirm(`Delete ${employee.firstName} ${employee.lastName}? This cannot be undone.`)) return;

    this.api.deleteEmployee(employee.id).subscribe({
      next: () => {
        const onlyRow = this.employees().length === 1 && this.query().page > 1;
        this.patch({ page: onlyRow ? this.query().page - 1 : this.query().page });
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private patch(changes: Partial<EmployeeQuery>): void {
    this.query.update((q) => ({ ...q, ...changes }));
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.listEmployees(this.query()).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }
}
