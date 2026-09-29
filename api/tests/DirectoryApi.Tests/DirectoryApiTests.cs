using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DirectoryApi;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace DirectoryApi.Tests;

public sealed class DirectoryFactory : WebApplicationFactory<Program>
{
    private readonly string _db = Path.Combine(Path.GetTempPath(), $"directory-tests-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Directory", $"Data Source={_db}");
        builder.UseSetting("Seed", "false");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { File.Delete(_db); } catch (IOException) { /* best effort */ }
    }
}

public class DirectoryApiTests(DirectoryFactory factory) : IClassFixture<DirectoryFactory>
{
    private readonly HttpClient _client = factory.CreateClient();
    private static readonly DateOnly Hired = new(2022, 5, 9);

    private async Task<DepartmentDto> NewDepartmentAsync(string? name = null)
    {
        var response = await _client.PostAsJsonAsync("/api/departments", new DepartmentRequest(name ?? "Dept-" + Guid.NewGuid().ToString("N")[..8]));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<DepartmentDto>())!;
    }

    private static EmployeeRequest Request(int departmentId, string? email = null, string first = "Ada", string last = "Lovelace", DateOnly? hired = null, bool active = true) =>
        new(first, last, email ?? $"{Guid.NewGuid():N}@example.com", "Engineer", departmentId, hired ?? Hired, active);

    private async Task<EmployeeDto> NewEmployeeAsync(int departmentId, string? email = null, string first = "Ada", string last = "Lovelace", bool active = true)
    {
        var response = await _client.PostAsJsonAsync("/api/employees", Request(departmentId, email, first, last, active: active));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<EmployeeDto>())!;
    }

    private async Task<PagedResult<EmployeeDto>> ListAsync(string query) =>
        (await _client.GetFromJsonAsync<PagedResult<EmployeeDto>>("/api/employees" + query))!;

    // ---------- Departments ----------

    [Fact]
    public async Task Department_crud_round_trip()
    {
        var created = await NewDepartmentAsync("Legal " + Guid.NewGuid().ToString("N")[..5]);

        var rename = await _client.PutAsJsonAsync($"/api/departments/{created.Id}", new DepartmentRequest("Legal Affairs " + created.Id));
        Assert.Equal(HttpStatusCode.NoContent, rename.StatusCode);

        var list = await _client.GetFromJsonAsync<List<DepartmentDto>>("/api/departments");
        Assert.Contains(list!, d => d.Id == created.Id && d.Name == "Legal Affairs " + created.Id);

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/departments/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/departments/{created.Id}")).StatusCode);
    }

    [Fact]
    public async Task Duplicate_department_names_conflict_on_create_and_rename()
    {
        var name = "Ops " + Guid.NewGuid().ToString("N")[..5];
        await NewDepartmentAsync(name);
        var other = await NewDepartmentAsync();

        Assert.Equal(HttpStatusCode.Conflict, (await _client.PostAsJsonAsync("/api/departments", new DepartmentRequest(name))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await _client.PutAsJsonAsync($"/api/departments/{other.Id}", new DepartmentRequest(name))).StatusCode);
    }

    [Fact]
    public async Task Blank_department_name_is_a_validation_error()
    {
        var response = await _client.PostAsJsonAsync("/api/departments", new DepartmentRequest(""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_department_with_employees_cannot_be_deleted()
    {
        var department = await NewDepartmentAsync();
        await NewEmployeeAsync(department.Id);

        Assert.Equal(HttpStatusCode.Conflict, (await _client.DeleteAsync($"/api/departments/{department.Id}")).StatusCode);
    }

    // ---------- Employees ----------

    [Fact]
    public async Task Employee_crud_round_trip_with_normalised_email()
    {
        var department = await NewDepartmentAsync();
        var created = await NewEmployeeAsync(department.Id, email: "  Ada.Lovelace@Example.COM ");
        Assert.Equal("ada.lovelace@example.com", created.Email);
        Assert.Equal(department.Name, created.DepartmentName);

        var update = await _client.PutAsJsonAsync($"/api/employees/{created.Id}",
            new EmployeeRequest("Ada", "Byron", "ada.lovelace@example.com", "Principal Engineer", department.Id, Hired, true));
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var updated = (await update.Content.ReadFromJsonAsync<EmployeeDto>())!;
        Assert.Equal(("Byron", "Principal Engineer"), (updated.LastName, updated.JobTitle));

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/employees/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/employees/{created.Id}")).StatusCode);
    }

    [Fact]
    public async Task Email_must_be_unique_regardless_of_case_on_create_and_update()
    {
        var department = await NewDepartmentAsync();
        var email = $"{Guid.NewGuid():N}@example.com";
        await NewEmployeeAsync(department.Id, email);
        var other = await NewEmployeeAsync(department.Id);

        var create = await _client.PostAsJsonAsync("/api/employees", Request(department.Id, email.ToUpperInvariant()));
        var update = await _client.PutAsJsonAsync($"/api/employees/{other.Id}", Request(department.Id, email));

        Assert.Equal(HttpStatusCode.Conflict, create.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, update.StatusCode);
    }

    [Fact]
    public async Task Updating_an_employee_without_changing_their_email_is_not_a_conflict()
    {
        var department = await NewDepartmentAsync();
        var employee = await NewEmployeeAsync(department.Id);

        var response = await _client.PutAsJsonAsync($"/api/employees/{employee.Id}", Request(department.Id, employee.Email, last: "Renamed"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("", "Lovelace", "a@example.com")]      // missing first name
    [InlineData("Ada", "", "a@example.com")]           // missing last name
    [InlineData("Ada", "Lovelace", "not-an-email")]    // bad email
    [InlineData("Ada", "Lovelace", "")]                // missing email
    public async Task Invalid_employees_are_rejected_with_validation_errors(string first, string last, string email)
    {
        var department = await NewDepartmentAsync();

        var response = await _client.PostAsJsonAsync("/api/employees",
            new EmployeeRequest(first, last, email, "Engineer", department.Id, Hired, true));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Hire_date_in_the_future_is_rejected()
    {
        var department = await NewDepartmentAsync();
        var tomorrow = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(2));

        var response = await _client.PostAsJsonAsync("/api/employees", Request(department.Id, hired: tomorrow));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("HireDate", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Unknown_department_is_rejected()
    {
        var response = await _client.PostAsJsonAsync("/api/employees", Request(999_999));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("DepartmentId", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Deactivating_hides_an_employee_from_the_default_list_and_reactivating_brings_them_back()
    {
        var department = await NewDepartmentAsync();
        var employee = await NewEmployeeAsync(department.Id, first: "Zed", last: "Quokka" + Guid.NewGuid().ToString("N")[..4]);

        var off = await (await _client.PostAsync($"/api/employees/{employee.Id}/deactivate", null)).Content.ReadFromJsonAsync<EmployeeDto>();
        Assert.False(off!.IsActive);
        Assert.DoesNotContain((await ListAsync($"?departmentId={department.Id}")).Items, e => e.Id == employee.Id);
        Assert.Contains((await ListAsync($"?departmentId={department.Id}&includeInactive=true")).Items, e => e.Id == employee.Id);

        var on = await (await _client.PostAsync($"/api/employees/{employee.Id}/reactivate", null)).Content.ReadFromJsonAsync<EmployeeDto>();
        Assert.True(on!.IsActive);
        Assert.Contains((await ListAsync($"?departmentId={department.Id}")).Items, e => e.Id == employee.Id);
    }

    [Fact]
    public async Task Listing_supports_search_department_filter_sort_and_paging()
    {
        var a = await NewDepartmentAsync();
        var b = await NewDepartmentAsync();
        var tag = "Zq" + Guid.NewGuid().ToString("N")[..5];
        await NewEmployeeAsync(a.Id, first: "Carla", last: tag + "C");
        await NewEmployeeAsync(a.Id, first: "Ana", last: tag + "A");
        await NewEmployeeAsync(a.Id, first: "Bruno", last: tag + "B");
        await NewEmployeeAsync(b.Id, first: "Dora", last: tag + "D");

        var byName = await ListAsync($"?search={tag}&departmentId={a.Id}&sort=name&dir=asc");
        var byNameDesc = await ListAsync($"?search={tag}&departmentId={a.Id}&sort=name&dir=desc");
        var page2 = await ListAsync($"?search={tag}&departmentId={a.Id}&sort=name&page=2&pageSize=2");
        var allDepartments = await ListAsync($"?search={tag}");

        Assert.Equal([tag + "A", tag + "B", tag + "C"], byName.Items.Select(e => e.LastName));
        Assert.Equal([tag + "C", tag + "B", tag + "A"], byNameDesc.Items.Select(e => e.LastName));
        Assert.Single(page2.Items);
        Assert.Equal(4, allDepartments.TotalCount);
    }

    [Fact]
    public async Task Search_matches_email_and_title_and_ignores_case()
    {
        var department = await NewDepartmentAsync();
        var employee = await NewEmployeeAsync(department.Id, email: $"needle{Guid.NewGuid():N}@example.com");

        var byEmail = await ListAsync($"?search={employee.Email[..12].ToUpperInvariant()}");

        Assert.Contains(byEmail.Items, e => e.Id == employee.Id);
    }

    [Fact]
    public async Task Page_size_is_capped_and_unknown_sort_falls_back_safely()
    {
        var result = await ListAsync("?pageSize=100000&sort=nonsense");

        Assert.Equal(100, result.PageSize);
    }

    [Fact]
    public async Task Email_availability_check_supports_editing_an_existing_employee()
    {
        var department = await NewDepartmentAsync();
        var employee = await NewEmployeeAsync(department.Id);

        var taken = await _client.GetFromJsonAsync<EmailAvailability>($"/api/employees/email-available?email={Uri.EscapeDataString(employee.Email.ToUpperInvariant())}");
        var ownEmail = await _client.GetFromJsonAsync<EmailAvailability>($"/api/employees/email-available?email={Uri.EscapeDataString(employee.Email)}&excludeId={employee.Id}");
        var free = await _client.GetFromJsonAsync<EmailAvailability>("/api/employees/email-available?email=nobody-here@example.com");

        Assert.False(taken!.Available);
        Assert.True(ownEmail!.Available);
        Assert.True(free!.Available);
    }

    [Fact]
    public async Task Summary_counts_active_and_total_headcount_per_department()
    {
        var department = await NewDepartmentAsync("Summary " + Guid.NewGuid().ToString("N")[..5]);
        await NewEmployeeAsync(department.Id);
        await NewEmployeeAsync(department.Id);
        await NewEmployeeAsync(department.Id, active: false);

        var summary = await _client.GetFromJsonAsync<Summary>("/api/summary");

        var row = summary!.Departments.Single(d => d.Id == department.Id);
        Assert.Equal((2, 3), (row.Active, row.Total));
        Assert.True(summary.TotalEmployees >= 3);
    }

    [Fact]
    public async Task CreatedAt_is_returned_as_UTC_with_a_Z_so_browsers_do_not_read_it_as_local_time()
    {
        var employee = await NewEmployeeAsync((await NewDepartmentAsync()).Id);

        var json = await _client.GetStringAsync($"/api/employees/{employee.Id}");
        using var doc = JsonDocument.Parse(json);

        Assert.EndsWith("Z", doc.RootElement.GetProperty("createdAt").GetString());
    }

    [Fact]
    public async Task Cors_allows_the_angular_dev_server()
    {
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/employees");
        request.Headers.Add("Origin", "http://localhost:4200");
        request.Headers.Add("Access-Control-Request-Method", "POST");

        var response = await _client.SendAsync(request);

        Assert.Contains("http://localhost:4200", response.Headers.GetValues("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Unknown_ids_return_not_found()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/employees/999999")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync("/api/employees/999999")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsync("/api/employees/999999/deactivate", null)).StatusCode);
    }
}
