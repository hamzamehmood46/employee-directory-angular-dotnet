using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace DirectoryApi;

public static class Endpoints
{
    private static readonly Dictionary<string, Func<IQueryable<Employee>, bool, IOrderedQueryable<Employee>>> Sorts = new(StringComparer.OrdinalIgnoreCase)
    {
        ["name"] = (q, desc) => desc ? q.OrderByDescending(e => e.LastName).ThenByDescending(e => e.FirstName) : q.OrderBy(e => e.LastName).ThenBy(e => e.FirstName),
        ["title"] = (q, desc) => desc ? q.OrderByDescending(e => e.JobTitle) : q.OrderBy(e => e.JobTitle),
        ["department"] = (q, desc) => desc ? q.OrderByDescending(e => e.Department!.Name) : q.OrderBy(e => e.Department!.Name),
        ["hired"] = (q, desc) => desc ? q.OrderByDescending(e => e.HireDate) : q.OrderBy(e => e.HireDate),
    };

    public static void MapDirectoryApi(this IEndpointRouteBuilder app)
    {
        var departments = app.MapGroup("/api/departments").WithTags("Departments");
        var employees = app.MapGroup("/api/employees").WithTags("Employees");

        // ---------- Departments ----------

        departments.MapGet("/", async (DirectoryDbContext db, CancellationToken ct) =>
            await db.Departments.AsNoTracking().OrderBy(d => d.Name)
                .Select(d => new DepartmentDto(d.Id, d.Name, db.Employees.Count(e => e.DepartmentId == d.Id)))
                .ToListAsync(ct));

        departments.MapPost("/", async (DepartmentRequest request, DirectoryDbContext db, CancellationToken ct) =>
        {
            if (Invalid(request) is { } problem) return problem;

            var name = request.Name.Trim();
            if (await db.Departments.AnyAsync(d => d.Name == name, ct)) return Conflict("A department with that name already exists.");

            var department = new Department { Name = name };
            db.Departments.Add(department);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/departments/{department.Id}", new DepartmentDto(department.Id, department.Name, 0));
        });

        departments.MapPut("/{id:int}", async (int id, DepartmentRequest request, DirectoryDbContext db, CancellationToken ct) =>
        {
            if (Invalid(request) is { } problem) return problem;

            var department = await db.Departments.FindAsync([id], ct);
            if (department is null) return Results.NotFound();

            var name = request.Name.Trim();
            if (await db.Departments.AnyAsync(d => d.Name == name && d.Id != id, ct)) return Conflict("A department with that name already exists.");

            department.Name = name;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        departments.MapDelete("/{id:int}", async (int id, DirectoryDbContext db, CancellationToken ct) =>
        {
            var department = await db.Departments.FindAsync([id], ct);
            if (department is null) return Results.NotFound();
            if (await db.Employees.AnyAsync(e => e.DepartmentId == id, ct)) return Conflict("Cannot delete a department that still has employees.");

            db.Departments.Remove(department);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---------- Employees ----------

        employees.MapGet("/", async (
            DirectoryDbContext db, CancellationToken ct,
            string? search, int? departmentId, bool includeInactive = false,
            string sort = "name", string dir = "asc", int page = 1, int pageSize = 10) =>
        {
            page = Math.Max(page, 1);
            pageSize = Math.Clamp(pageSize, 1, 100);

            var query = db.Employees.AsNoTracking().Include(e => e.Department).AsQueryable();
            if (!includeInactive) query = query.Where(e => e.IsActive);
            if (departmentId is not null) query = query.Where(e => e.DepartmentId == departmentId);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                query = query.Where(e => e.FirstName.ToLower().Contains(s) || e.LastName.ToLower().Contains(s)
                    || e.Email.Contains(s) || e.JobTitle.ToLower().Contains(s));
            }

            var sorter = Sorts.GetValueOrDefault(sort) ?? Sorts["name"];
            var ordered = sorter(query, string.Equals(dir, "desc", StringComparison.OrdinalIgnoreCase)).ThenBy(e => e.Id);

            var total = await ordered.CountAsync(ct);
            var items = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            return Results.Ok(new PagedResult<EmployeeDto>(items.Select(EmployeeDto.From).ToList(), page, pageSize, total));
        });

        // Declared before "/{id:int}" for readability; the int constraint means the two never clash.
        employees.MapGet("/email-available", async (string email, int? excludeId, DirectoryDbContext db, CancellationToken ct) =>
        {
            var normalised = email.Trim().ToLowerInvariant();
            var taken = await db.Employees.AnyAsync(e => e.Email == normalised && e.Id != excludeId, ct);
            return Results.Ok(new EmailAvailability(!taken));
        });

        employees.MapGet("/{id:int}", async (int id, DirectoryDbContext db, CancellationToken ct) =>
        {
            var employee = await db.Employees.AsNoTracking().Include(e => e.Department).FirstOrDefaultAsync(e => e.Id == id, ct);
            return employee is null ? Results.NotFound() : Results.Ok(EmployeeDto.From(employee));
        });

        employees.MapPost("/", async (EmployeeRequest request, DirectoryDbContext db, CancellationToken ct) =>
        {
            if (await Check(request, null, db, ct) is { } problem) return problem;

            var employee = new Employee { CreatedAt = DateTime.UtcNow };
            Apply(employee, request);
            db.Employees.Add(employee);
            await db.SaveChangesAsync(ct);
            await db.Entry(employee).Reference(e => e.Department).LoadAsync(ct);
            return Results.Created($"/api/employees/{employee.Id}", EmployeeDto.From(employee));
        });

        employees.MapPut("/{id:int}", async (int id, EmployeeRequest request, DirectoryDbContext db, CancellationToken ct) =>
        {
            var employee = await db.Employees.Include(e => e.Department).FirstOrDefaultAsync(e => e.Id == id, ct);
            if (employee is null) return Results.NotFound();
            if (await Check(request, id, db, ct) is { } problem) return problem;

            Apply(employee, request);
            await db.SaveChangesAsync(ct);
            await db.Entry(employee).Reference(e => e.Department).LoadAsync(ct);
            return Results.Ok(EmployeeDto.From(employee));
        });

        employees.MapPost("/{id:int}/deactivate", (int id, DirectoryDbContext db, CancellationToken ct) => SetActive(id, false, db, ct));
        employees.MapPost("/{id:int}/reactivate", (int id, DirectoryDbContext db, CancellationToken ct) => SetActive(id, true, db, ct));

        employees.MapDelete("/{id:int}", async (int id, DirectoryDbContext db, CancellationToken ct) =>
        {
            var employee = await db.Employees.FindAsync([id], ct);
            if (employee is null) return Results.NotFound();

            db.Employees.Remove(employee);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---------- Dashboard ----------

        app.MapGet("/api/summary", async (DirectoryDbContext db, CancellationToken ct) =>
        {
            var departmentsWithCounts = await db.Departments.AsNoTracking().OrderBy(d => d.Name)
                .Select(d => new DepartmentHeadcount(
                    d.Id, d.Name,
                    db.Employees.Count(e => e.DepartmentId == d.Id && e.IsActive),
                    db.Employees.Count(e => e.DepartmentId == d.Id)))
                .ToListAsync(ct);

            return Results.Ok(new Summary(
                departmentsWithCounts.Sum(d => d.Total),
                departmentsWithCounts.Sum(d => d.Active),
                departmentsWithCounts));
        }).WithTags("Dashboard");
    }

    private static async Task<IResult> SetActive(int id, bool active, DirectoryDbContext db, CancellationToken ct)
    {
        var employee = await db.Employees.Include(e => e.Department).FirstOrDefaultAsync(e => e.Id == id, ct);
        if (employee is null) return Results.NotFound();

        employee.IsActive = active;
        await db.SaveChangesAsync(ct);
        return Results.Ok(EmployeeDto.From(employee));
    }

    private static void Apply(Employee employee, EmployeeRequest request)
    {
        employee.FirstName = request.FirstName.Trim();
        employee.LastName = request.LastName.Trim();
        employee.Email = request.Email.Trim().ToLowerInvariant();
        employee.JobTitle = request.JobTitle.Trim();
        employee.DepartmentId = request.DepartmentId;
        employee.HireDate = request.HireDate;
        employee.IsActive = request.IsActive;
    }

    /// <summary>Attribute validation plus the rules that need the database or the clock.</summary>
    private static async Task<IResult?> Check(EmployeeRequest request, int? id, DirectoryDbContext db, CancellationToken ct)
    {
        if (Invalid(request) is { } problem) return problem;

        if (request.HireDate > DateOnly.FromDateTime(DateTime.UtcNow))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["HireDate"] = ["Hire date cannot be in the future."] });

        if (!await db.Departments.AnyAsync(d => d.Id == request.DepartmentId, ct))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["DepartmentId"] = [$"Department {request.DepartmentId} does not exist."] });

        var email = request.Email.Trim().ToLowerInvariant();
        if (await db.Employees.AnyAsync(e => e.Email == email && e.Id != id, ct))
            return Conflict($"Email {email} is already in use.");

        return null;
    }

    /// <summary>Minimal APIs don't run DataAnnotations automatically, so validate explicitly.</summary>
    private static IResult? Invalid(object model)
    {
        var results = new List<ValidationResult>();
        if (Validator.TryValidateObject(model, new ValidationContext(model), results, validateAllProperties: true)) return null;

        // Records put attributes on constructor parameters; validate those too.
        return Results.ValidationProblem(results
            .SelectMany(r => (r.MemberNames.Any() ? r.MemberNames : [string.Empty]).Select(m => (Member: m, r.ErrorMessage)))
            .GroupBy(x => x.Member)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ErrorMessage ?? "Invalid value.").ToArray()));
    }

    private static IResult Conflict(string detail) =>
        Results.Problem(detail: detail, statusCode: StatusCodes.Status409Conflict, title: "Conflict");
}
