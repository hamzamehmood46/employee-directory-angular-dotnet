using DirectoryApi;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<DirectoryDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Directory") ?? "Data Source=directory.db"));

builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// The Angular dev server runs on :4200. Allowed origins are configurable for real deployments.
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:4200"];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<DirectoryDbContext>();
    db.Database.EnsureCreated();
    if (app.Configuration.GetValue("Seed", true)) SeedData.Apply(db);
}

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseSwagger();
app.UseSwaggerUI();
app.UseCors();
app.MapDirectoryApi();

app.Run();

public partial class Program;
