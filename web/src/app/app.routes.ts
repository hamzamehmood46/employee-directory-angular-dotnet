import { Routes } from '@angular/router';
import { Dashboard } from './dashboard';
import { Departments } from './departments';
import { EmployeeForm } from './employee-form';
import { EmployeeList } from './employee-list';

export const routes: Routes = [
  { path: '', component: Dashboard, title: 'Overview | Employee Directory' },
  { path: 'employees', component: EmployeeList, title: 'Employees | Employee Directory' },
  { path: 'employees/new', component: EmployeeForm, title: 'New employee | Employee Directory' },
  { path: 'employees/:id/edit', component: EmployeeForm, title: 'Edit employee | Employee Directory' },
  { path: 'departments', component: Departments, title: 'Departments | Employee Directory' },
  { path: '**', redirectTo: '' },
];
