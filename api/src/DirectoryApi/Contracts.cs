using System.ComponentModel.DataAnnotations;

namespace DirectoryApi;

// Attributes use the "property:" target on purpose. Minimal APIs validate through System.ComponentModel
// DataAnnotations, which reads PROPERTIES; on a positional record, an attribute written without a target
// lands on the constructor parameter and would silently never run.
public record DepartmentRequest([property: Required, StringLength(80)] string Name);
public record DepartmentDto(int Id, string Name, int EmployeeCount);

public record EmployeeRequest(
    [property: Required, StringLength(60)] string FirstName,
    [property: Required, StringLength(60)] string LastName,
    [property: Required, EmailAddress, StringLength(160)] string Email,
    [property: Required, StringLength(100)] string JobTitle,
    [property: Range(1, int.MaxValue)] int DepartmentId,
    DateOnly HireDate,
    bool IsActive = true);

public record EmployeeDto(
    int Id, string FirstName, string LastName, string Email, string JobTitle,
    int DepartmentId, string DepartmentName, DateOnly HireDate, bool IsActive, DateTime CreatedAt)
{
    public static EmployeeDto From(Employee e) => new(
        e.Id, e.FirstName, e.LastName, e.Email, e.JobTitle,
        e.DepartmentId, e.Department?.Name ?? string.Empty, e.HireDate, e.IsActive, e.CreatedAt);
}

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public record EmailAvailability(bool Available);

public record DepartmentHeadcount(int Id, string Name, int Active, int Total);
public record Summary(int TotalEmployees, int ActiveEmployees, IReadOnlyList<DepartmentHeadcount> Departments);
