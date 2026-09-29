import { Component, OnInit, inject, input, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DirectoryService, errorMessage, uniqueEmail } from './directory.service';
import { Department, EmployeeInput } from './models';

/** yyyy-MM-dd strings compare correctly as text, so no Date parsing (and no time-zone surprises). */
export function notInFuture(control: AbstractControl): ValidationErrors | null {
  const today = new Date().toISOString().slice(0, 10);
  return control.value && control.value > today ? { future: true } : null;
}

@Component({
  selector: 'app-employee-form',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="page-header">
      <h1>{{ isEdit() ? 'Edit employee' : 'New employee' }}</h1>
    </div>

    @if (error()) {
      <p class="alert" role="alert">{{ error() }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <div class="row">
        <div class="field">
          <label for="firstName">First name</label>
          <input id="firstName" formControlName="firstName" />
          @if (bad('firstName')) { <small class="err">First name is required.</small> }
        </div>
        <div class="field">
          <label for="lastName">Last name</label>
          <input id="lastName" formControlName="lastName" />
          @if (bad('lastName')) { <small class="err">Last name is required.</small> }
        </div>
      </div>

      <div class="field">
        <label for="email">Work email</label>
        <input id="email" type="email" formControlName="email" autocomplete="off" />
        @if (form.controls.email.pending) {
          <small class="muted">Checking availability...</small>
        } @else if (bad('email')) {
          <small class="err">
            @if (form.controls.email.errors?.['required']) { Email is required. }
            @else if (form.controls.email.errors?.['email']) { Enter a valid email address. }
            @else if (form.controls.email.errors?.['taken']) { That email is already in use. }
          </small>
        } @else if (form.controls.email.valid && form.controls.email.dirty) {
          <small class="ok">Email is available.</small>
        }
      </div>

      <div class="field">
        <label for="jobTitle">Job title</label>
        <input id="jobTitle" formControlName="jobTitle" />
        @if (bad('jobTitle')) { <small class="err">Job title is required.</small> }
      </div>

      <div class="row">
        <div class="field">
          <label for="departmentId">Department</label>
          <select id="departmentId" formControlName="departmentId">
            <option [ngValue]="0" disabled>Select a department</option>
            @for (d of departments(); track d.id) {
              <option [ngValue]="d.id">{{ d.name }}</option>
            }
          </select>
          @if (bad('departmentId')) { <small class="err">Choose a department.</small> }
        </div>
        <div class="field">
          <label for="hireDate">Hire date</label>
          <input id="hireDate" type="date" formControlName="hireDate" />
          @if (bad('hireDate')) {
            <small class="err">
              @if (form.controls.hireDate.errors?.['required']) { Hire date is required. }
              @else { Hire date cannot be in the future. }
            </small>
          }
        </div>
      </div>

      <label class="check">
        <input type="checkbox" formControlName="isActive" />
        Active employee
      </label>

      <div class="form-actions">
        <button class="btn primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
        <a class="btn" routerLink="/employees">Cancel</a>
      </div>
    </form>
  `,
})
export class EmployeeForm implements OnInit {
  private readonly api = inject(DirectoryService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** Route parameter, bound by withComponentInputBinding(). Present when editing. */
  readonly id = input<string>();

  readonly departments = signal<Department[]>([]);
  readonly error = signal('');
  readonly saving = signal(false);

  readonly form = this.fb.group({
    firstName: ['', [Validators.required, Validators.maxLength(60)]],
    lastName: ['', [Validators.required, Validators.maxLength(60)]],
    // The async check tells the API which employee is being edited, so keeping your own email is fine.
    email: ['', {
      validators: [Validators.required, Validators.email, Validators.maxLength(160)],
      asyncValidators: [uniqueEmail(this.api, () => (this.id() ? Number(this.id()) : undefined))],
    }],
    jobTitle: ['', [Validators.required, Validators.maxLength(100)]],
    departmentId: [0, [Validators.min(1)]],
    hireDate: ['', [Validators.required, notInFuture]],
    isActive: [true],
  });

  isEdit(): boolean {
    return !!this.id();
  }

  ngOnInit(): void {
    this.api.listDepartments().subscribe({
      next: (d) => this.departments.set(d),
      error: (e) => this.error.set(errorMessage(e)),
    });

    const id = this.id();
    if (id) {
      this.api.getEmployee(Number(id)).subscribe({
        next: (e) => this.form.patchValue(e),
        error: (e) => this.error.set(errorMessage(e)),
      });
    }
  }

  bad(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  save(): void {
    if (this.form.invalid || this.form.pending) {
      this.form.markAllAsTouched();
      return;
    }

    const input: EmployeeInput = this.form.getRawValue();
    const id = this.id();
    const request = id ? this.api.updateEmployee(Number(id), input) : this.api.createEmployee(input);

    this.saving.set(true);
    this.error.set('');
    request.subscribe({
      next: () => this.router.navigate(['/employees']),
      error: (e) => {
        this.error.set(errorMessage(e));
        this.saving.set(false);
      },
    });
  }
}
