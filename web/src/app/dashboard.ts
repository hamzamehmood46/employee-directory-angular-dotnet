import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DirectoryService, errorMessage } from './directory.service';
import { Summary } from './models';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  template: `
    <div class="page-header">
      <h1>Overview</h1>
      <a class="btn primary" routerLink="/employees/new">Add employee</a>
    </div>

    @if (error()) {
      <p class="alert" role="alert">{{ error() }}</p>
    }

    @if (summary(); as s) {
      <div class="tiles">
        <div class="tile"><b>{{ s.activeEmployees }}</b><span>Active employees</span></div>
        <div class="tile"><b>{{ s.totalEmployees - s.activeEmployees }}</b><span>Inactive</span></div>
        <div class="tile"><b>{{ s.departments.length }}</b><span>Departments</span></div>
      </div>

      <h2>Headcount by department</h2>
      <ul class="bars" aria-label="Active headcount by department">
        @for (d of s.departments; track d.id) {
          <li>
            <a [routerLink]="['/employees']" [queryParams]="{ departmentId: d.id }" class="bar-label">{{ d.name }}</a>
            <div class="bar-track" role="img" [attr.aria-label]="d.name + ': ' + d.active + ' active'">
              <div class="bar-fill" [style.width.%]="width(d.active)"></div>
            </div>
            <span class="bar-value">{{ d.active }}</span>
          </li>
        } @empty {
          <li class="muted">No departments yet.</li>
        }
      </ul>
    }
  `,
})
export class Dashboard implements OnInit {
  private readonly api = inject(DirectoryService);

  readonly summary = signal<Summary | null>(null);
  readonly error = signal('');
  private readonly max = computed(() => Math.max(1, ...(this.summary()?.departments.map((d) => d.active) ?? [1])));

  ngOnInit(): void {
    this.api.summary().subscribe({
      next: (s) => this.summary.set(s),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  /** Bar width as a percentage of the largest department, so the biggest bar always fills the track. */
  width(active: number): number {
    return (active / this.max()) * 100;
  }
}
