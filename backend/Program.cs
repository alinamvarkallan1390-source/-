using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<Db>(o => o.UseSqlite(builder.Configuration.GetConnectionString("Nexora") ?? "Data Source=nexora.db"));
builder.Services.AddRateLimiter(o => {
 o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
 o.AddPolicy("api", context => RateLimitPartition.GetFixedWindowLimiter(
  context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions {
   PermitLimit = 300, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true
  }));
 o.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
  context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions {
   PermitLimit = 12, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true
  }));
});
var app = builder.Build();
app.UseRateLimiter();
using (var scope = app.Services.CreateScope()) scope.ServiceProvider.GetRequiredService<Db>().Database.EnsureCreated();
var api = app.MapGroup("/api").RequireRateLimiting("api");
var hasher = new PasswordHasher<User>();
static string Token() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
static string Bearer(HttpRequest r) { var h = r.Headers.Authorization.ToString(); return h.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? h[7..].Trim() : ""; }
static async Task<User?> UserFor(HttpRequest r, Db db) { var token = Bearer(r); if (token.Length == 0) return null; var session = await db.Sessions.FirstOrDefaultAsync(s => s.TokenHash == Hash(token) && s.ExpiresAt > DateTime.UtcNow); return session == null ? null : await db.Users.FindAsync(session.UserId); }
static async Task<Bot?> BotFor(HttpRequest r, Db db) { var token = Bearer(r); return token.Length == 0 ? null : await db.Bots.FirstOrDefaultAsync(b => b.TokenHash == Hash(token)); }
static bool ValidName(string? s) => s is { Length: >= 3 and <= 32 } && s.All(c => char.IsAsciiLetterOrDigit(c) || c == '_');
api.MapGet("/health", () => Results.Ok(new { status = "ok" }));
api.MapPost("/auth/register", async (Register body, Db db) => {
 var username = body.Username?.Trim().ToLowerInvariant() ?? ""; var display = body.DisplayName?.Trim() ?? "";
 if (!ValidName(username) || display.Length is < 1 or > 80 || body.Password is not { Length: >= 10 and <= 128 }) return Results.BadRequest(new { error = "Invalid username, display name or password (minimum 10 characters)." });
 if (await db.Users.AnyAsync(u => u.Username == username) || await db.Bots.AnyAsync(b => b.Username == username)) return Results.Conflict(new { error = "Username already exists." });
 var u = new User { Username = username, DisplayName = display }; u.PasswordHash = hasher.HashPassword(u, body.Password); db.Users.Add(u);
 try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Results.Conflict(new { error = "Username already exists." }); }
 return Results.Ok(new { u.Id, u.Username, u.DisplayName });
}).RequireRateLimiting("auth");
api.MapPost("/auth/login", async (Login body, Db db) => {
 var u = await db.Users.FirstOrDefaultAsync(x => x.Username == (body.Username ?? "").Trim().ToLowerInvariant());
 if (u == null || hasher.VerifyHashedPassword(u, u.PasswordHash, body.Password ?? "") == PasswordVerificationResult.Failed) return Results.Unauthorized();
 var token = Token(); db.Sessions.Add(new Session { UserId = u.Id, TokenHash = Hash(token), ExpiresAt = DateTime.UtcNow.AddDays(7) }); await db.SaveChangesAsync();
 return Results.Ok(new { token, expiresAt = DateTime.UtcNow.AddDays(7), user = new { u.Id, u.Username, u.DisplayName } });
}).RequireRateLimiting("auth");
api.MapPost("/auth/logout", async (HttpRequest req, Db db) => { var h = Hash(Bearer(req)); var s = await db.Sessions.FirstOrDefaultAsync(x => x.TokenHash == h); if (s != null) { db.Sessions.Remove(s); await db.SaveChangesAsync(); } return Results.NoContent(); });
api.MapPost("/chats", async (CreateChat body, HttpRequest req, Db db) => {
 var user = await UserFor(req, db); if (user == null) return Results.Unauthorized();
 var name = (body.Username ?? "").Trim().TrimStart('@').ToLowerInvariant(); var peer = await db.Users.FirstOrDefaultAsync(x => x.Username == name); var bot = await db.Bots.FirstOrDefaultAsync(x => x.Username == name);
 if (peer == null && bot == null) return Results.NotFound(new { error = "User or bot not found." }); if (peer?.Id == user.Id) return Results.BadRequest(new { error = "Cannot create a chat with yourself." });
 var existing = bot != null ? await db.Chats.FirstOrDefaultAsync(c => c.User1Id == user.Id && c.BotId == bot.Id) : await db.Chats.FirstOrDefaultAsync(c => c.BotId == null && ((c.User1Id == user.Id && c.User2Id == peer!.Id) || (c.User2Id == user.Id && c.User1Id == peer!.Id)));
 if (existing != null) return Results.Ok(new { existing.Id });
 var chat = new Chat { User1Id = user.Id, User2Id = peer?.Id, BotId = bot?.Id }; db.Chats.Add(chat); await db.SaveChangesAsync(); return Results.Ok(new { chat.Id });
});
api.MapGet("/chats", async (HttpRequest req, Db db) => {
 var user = await UserFor(req, db); if (user == null) return Results.Unauthorized();
 var chats = await db.Chats.Where(c => c.User1Id == user.Id || c.User2Id == user.Id).ToListAsync();
 var result = new List<object>(); foreach (var c in chats) { var bot = c.BotId == null ? null : await db.Bots.FindAsync(c.BotId); var peer = bot == null ? await db.Users.FindAsync(c.User1Id == user.Id ? c.User2Id : c.User1Id) : null; result.Add(new { c.Id, username = bot?.Username ?? peer?.Username, displayName = bot?.DisplayName ?? peer?.DisplayName, isBot = bot != null }); } return Results.Ok(result);
});
api.MapGet("/chats/{id:long}/messages", async (long id, HttpRequest req, Db db) => {
 var user = await UserFor(req, db); if (user == null) return Results.Unauthorized(); if (!await db.Chats.AnyAsync(c => c.Id == id && (c.User1Id == user.Id || c.User2Id == user.Id))) return Results.NotFound();
 var messages = await db.Messages.Where(m => m.ChatId == id).OrderByDescending(m => m.Id).Take(100).OrderBy(m => m.Id).Select(m => new { m.Id, m.ChatId, m.SenderUserId, m.SenderBotId, m.Text, m.CreatedAt }).ToListAsync(); return Results.Ok(messages);
});
api.MapPost("/chats/{id:long}/messages", async (long id, SendMessage body, HttpRequest req, Db db) => {
 var user = await UserFor(req, db); if (user == null) return Results.Unauthorized(); var chat = await db.Chats.FirstOrDefaultAsync(c => c.Id == id && (c.User1Id == user.Id || c.User2Id == user.Id)); if (chat == null) return Results.NotFound();
 var text = body.Text?.Trim() ?? ""; if (text.Length is < 1 or > 4000) return Results.BadRequest(new { error = "Text must be 1–4000 characters." });
 var m = new Message { ChatId = id, SenderUserId = user.Id, Text = text, CreatedAt = DateTime.UtcNow }; db.Messages.Add(m); await db.SaveChangesAsync(); return Results.Ok(new { m.Id, m.ChatId, m.Text, m.CreatedAt });
});
api.MapPut("/chats/{chatId:long}/messages/{messageId:long}", async (long chatId, long messageId, SendMessage body, HttpRequest req, Db db) => {
 var user = await UserFor(req, db); if (user == null) return Results.Unauthorized();
 var m = await db.Messages.FirstOrDefaultAsync(x => x.Id == messageId && x.ChatId == chatId && x.SenderUserId == user.Id);
 if (m == null) return Results.NotFound();
 var text = body.Text?.Trim() ?? ""; if (text.Length is < 1 or > 4000) return Results.BadRequest(new { error = "Text must be 1–4000 characters." });
 m.Text = text; await db.SaveChangesAsync(); return Results.Ok(new { m.Id, m.ChatId, m.Text, m.CreatedAt });
});
api.MapDelete("/chats/{chatId:long}/messages/{messageId:long}", async (long chatId, long messageId, HttpRequest req, Db db) => {
 var user = await UserFor(req, db); if (user == null) return Results.Unauthorized();
 var m = await db.Messages.FirstOrDefaultAsync(x => x.Id == messageId && x.ChatId == chatId && x.SenderUserId == user.Id);
 if (m == null) return Results.NotFound(); db.Messages.Remove(m); await db.SaveChangesAsync(); return Results.NoContent();
});
api.MapPost("/bots", async (CreateBot body, HttpRequest req, Db db) => {
 var user = await UserFor(req, db); if (user == null) return Results.Unauthorized(); var name = (body.Username ?? "").Trim().ToLowerInvariant(); var display = body.DisplayName?.Trim() ?? "";
 if (!ValidName(name) || !name.EndsWith("_bot") || display.Length is < 1 or > 80) return Results.BadRequest(new { error = "Bot username must end in _bot; display name must be 1–80 characters." });
 if (await db.Bots.AnyAsync(b => b.Username == name) || await db.Users.AnyAsync(u => u.Username == name)) return Results.Conflict(new { error = "Username already exists." });
 var token = Token(); var bot = new Bot { OwnerId = user.Id, Username = name, DisplayName = display, TokenHash = Hash(token) }; db.Bots.Add(bot); try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Results.Conflict(new { error = "Username already exists." }); } return Results.Ok(new { bot.Id, bot.Username, token });
});
api.MapGet("/bot/updates", async (long? offset, HttpRequest req, Db db) => {
 var bot = await BotFor(req, db); if (bot == null) return Results.Unauthorized(); var updates = await (from m in db.Messages join c in db.Chats on m.ChatId equals c.Id where c.BotId == bot.Id && m.SenderUserId != null && m.Id > (offset ?? 0) orderby m.Id select new { updateId = m.Id, chatId = m.ChatId, fromUserId = m.SenderUserId, m.Text, m.CreatedAt }).Take(100).ToListAsync(); return Results.Ok(updates);
});
api.MapPost("/bot/messages", async (BotMessage body, HttpRequest req, Db db) => {
 var bot = await BotFor(req, db); if (bot == null) return Results.Unauthorized(); if (!await db.Chats.AnyAsync(c => c.Id == body.ChatId && c.BotId == bot.Id)) return Results.NotFound(); var text = body.Text?.Trim() ?? ""; if (text.Length is < 1 or > 4000) return Results.BadRequest(new { error = "Text must be 1–4000 characters." });
 var m = new Message { ChatId = body.ChatId, SenderBotId = bot.Id, Text = text, CreatedAt = DateTime.UtcNow }; db.Messages.Add(m); await db.SaveChangesAsync(); return Results.Ok(new { m.Id, m.ChatId, m.Text, m.CreatedAt });
});
// Serve only the explicitly listed client assets; never expose source or database files.
var root = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, ".."));
foreach (var asset in new[] { "real.html", "style.css", "backend-client.js", "docs/bots.html" }) {
 var path = Path.Combine(root, asset.Replace('/', Path.DirectorySeparatorChar));
 var contentType = asset.EndsWith(".css") ? "text/css; charset=utf-8" : asset.EndsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
 app.MapGet("/" + asset, () => Results.File(path, contentType));
}
app.MapGet("/", () => Results.Redirect("/real.html"));
app.Run();
record Register(string? Username, string? DisplayName, string? Password); record Login(string? Username, string? Password); record CreateChat(string? Username); record SendMessage(string? Text); record CreateBot(string? Username, string? DisplayName); record BotMessage(long ChatId, string? Text);
class User { public long Id { get; set; } public string Username { get; set; } = ""; public string DisplayName { get; set; } = ""; public string PasswordHash { get; set; } = ""; }
class Session { public long Id { get; set; } public long UserId { get; set; } public string TokenHash { get; set; } = ""; public DateTime ExpiresAt { get; set; } }
class Bot { public long Id { get; set; } public long OwnerId { get; set; } public string Username { get; set; } = ""; public string DisplayName { get; set; } = ""; public string TokenHash { get; set; } = ""; }
class Chat { public long Id { get; set; } public long User1Id { get; set; } public long? User2Id { get; set; } public long? BotId { get; set; } }
class Message { public long Id { get; set; } public long ChatId { get; set; } public long? SenderUserId { get; set; } public long? SenderBotId { get; set; } public string Text { get; set; } = ""; public DateTime CreatedAt { get; set; } }
class Db(DbContextOptions<Db> options) : DbContext(options) { public DbSet<User> Users => Set<User>(); public DbSet<Session> Sessions => Set<Session>(); public DbSet<Bot> Bots => Set<Bot>(); public DbSet<Chat> Chats => Set<Chat>(); public DbSet<Message> Messages => Set<Message>(); protected override void OnModelCreating(ModelBuilder b) { b.Entity<User>().HasIndex(x => x.Username).IsUnique(); b.Entity<Bot>().HasIndex(x => x.Username).IsUnique(); b.Entity<Session>().HasIndex(x => x.TokenHash).IsUnique(); b.Entity<Bot>().HasIndex(x => x.TokenHash).IsUnique(); b.Entity<Message>().HasIndex(x => new { x.ChatId, x.Id }); } }
