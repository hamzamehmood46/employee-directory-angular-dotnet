import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DirectoryService, errorMessage } from './directory.service';
import { Department } from './models';

@Component({
  selector: 'app-departments',
  imports: [FormsModule],
  template: `
    <div class="page-header">
      <h1>Departments</h1>
    </div>

    @if (error()) {
      <p class="alert" role="alert">{{ error() }}</p>
    }

    <form class="toolbar" (ngSubmit)="add()">
      <input name="newName" placeholder="New department name" aria-label="New department name" [(ngModel)]="newName" maxlength="80" />
      <button class="btn primary" type="submit" [disabled]="!newName.trim()">Add department</button>
    </form>

    <table>
      <thead>
        <tr><th>Name</th><th class="num">Employees</th><th></th></tr>
      </thead>
      <tbody>
        @for (d of departments(); track d.id) {
          <tr>
            <td>
              @if (editingId() === d.id) {
                <input
                  name="edit-{{ d.id }}"
                  aria-label="Department name"
                  [(ngModel)]="editName"
                  maxlength="80"
                  (keydown.enter)="saveEdit(d)"
                  (keydown.escape)="cancelEdit()"
                />
              } @else {
                {{ d.name }}
              }
            </td>
            <td class="num">{{ d.employeeCount }}</td>
            <td class="actions">
              @if (editingId() === d.id) {
                <button class="btn small primary" (click)="saveEdit(d)">Save</button>
                <button class="btn small" (click)="cancelEdit()">Cancel</button>
              } @else {
                <button class="btn small" (click)="startEdit(d)">Rename</button>
                <button
                  class="btn small danger"
                  (click)="remove(d)"
                  [disabled]="d.employeeCount > 0"
                  [title]="d.employeeCount > 0 ? 'Move or remove its employees first' : ''"
                >
                  Delete
                </button>
              }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="3" class="empty">No departments yet.</td></tr>
        }
      </tbody>
    </table>
  `,
})
export class Departments implements OnInit {
  private readonly api = inject(DirectoryService);

  readonly departments = signal<Department[]>([]);
  readonly error = signal('');
  readonly editingId = signal<number | null>(null);
  newName = '';
  editName = '';

  ngOnInit(): void {
    this.reload();
  }

  add(): void {
    const name = this.newName.trim();
    if (!name) return;
    this.api.createDepartment(name).subscribe({
      next: () => {
        this.newName = '';
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  startEdit(department: Department): void {
    this.editingId.set(department.id);
    this.editName = department.name;
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(department: Department): void {
    const name = this.editName.trim();
    if (!name) return;
    this.api.renameDepartment(department.id, name).subscribe({
      next: () => {
        this.editingId.set(null);
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  remove(department: Department): void {
    if (!window.confirm(`Delete department "${department.name}"?`)) return;
    this.api.deleteDepartment(department.id).subscribe({
      next: () => this.reload(),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private reload(): void {
    this.error.set('');
    this.api.listDepartments().subscribe({
      next: (d) => this.departments.set(d),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
