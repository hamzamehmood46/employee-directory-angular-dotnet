using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace DirectoryApi;

public class Department
{
    public int Id { get; set; }

    [Required, StringLength(80)]
    public string Name { get; set; } = string.Empty;
}

public class Employee
{
    public int Id { get; set; }

    [Required, StringLength(60)]
    public string FirstName { get; set; } = string.Empty;

    [Required, StringLength(60)]
    public string LastName { get; set; } = string.Empty;

    /// <summary>Stored lower-cased so uniqueness is case-insensitive.</summary>
    [Required, StringLength(160)]
    public string Email { get; set; } = string.Empty;

    [Required, StringLength(100)]
    public string JobTitle { get; set; } = string.Empty;

    public int DepartmentId { get; set; }
    public Department? Department { get; set; }

    public DateOnly HireDate { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}

public class DirectoryDbContext(DbContextOptions<DirectoryDbContext> options) : DbContext(options)
{
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Employee> Employees => Set<Employee>();

    /// <summary>
    /// SQLite stores DateTime without a time zone, so values come back with Kind = Unspecified and are
    /// serialised without a "Z". Browsers then read them as LOCAL time. Everything here is UTC, so say so.
    /// </summary>
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Department>().HasIndex(d => d.Name).IsUnique();

        b.Entity<Employee>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.HasIndex(x => x.LastName);
            e.HasOne(x => x.Department).WithMany().HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}

public class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
    v => v.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : v.ToUniversalTime(),
    v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

public static class SeedData
{
    public static void Apply(DirectoryDbContext db)
    {
        if (db.Departments.Any()) return;

        var eng = new Department { Name = "Engineering" };
        var hr = new Department { Name = "People & Culture" };
        var sales = new Department { Name = "Sales" };
        var fin = new Department { Name = "Finance" };
        db.Departments.AddRange(eng, hr, sales, fin);

        var now = DateTime.UtcNow;
        Employee E(string first, string last, string title, Department d, string hired, bool active = true) => new()
        {
            FirstName = first, LastName = last, JobTitle = title, Department = d,
            Email = $"{first}.{last}@example.com".ToLowerInvariant(),
            HireDate = DateOnly.Parse(hired), IsActive = active, CreatedAt = now
        };

        db.Employees.AddRange(
            E("Amara", "Okoye", "Staff Software Engineer", eng, "2019-03-11"),
            E("Diego", "Ramirez", "Backend Engineer", eng, "2021-08-02"),
            E("Sofia", "Lindqvist", "Frontend Engineer", eng, "2022-01-17"),
            E("Kenji", "Watanabe", "Engineering Manager", eng, "2018-06-25"),
            E("Hannah", "Cohen", "HR Business Partner", hr, "2020-09-14"),
            E("Marcus", "Bell", "Recruiter", hr, "2023-02-06"),
            E("Leila", "Haddad", "Account Executive", sales, "2021-04-19"),
            E("Tomas", "Novak", "Sales Development Rep", sales, "2024-05-13"),
            E("Grace", "Adeyemi", "Financial Analyst", fin, "2022-10-03"),
            E("Peter", "Kowalski", "Controller", fin, "2017-11-27", active: false));

        db.SaveChanges();
    }
}
