const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}
function validUsername(value) {
  return /^[a-z0-9_]{3,24}$/.test(value);
}
function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}
async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function passwordHash(password, salt = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 210000, hash: "SHA-256" }, key, 256);
  const hash = [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${salt}:${hash}`;
}
async function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = await passwordHash(password, salt);
  return actual.split(":")[1] === expected;
}
async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.role, u.status
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
  `).bind(tokenHash, now()).first();
  return row || null;
}
async function requireUser(request, env) {
  const user = await currentUser(request, env);
  return user ? { user } : { response: json({ error: "UNAUTHORIZED" }, 401) };
}
function requireStaff(user) {
  return user.role === "admin" || user.role === "pengawas";
}
async function logActivity(env, actorId, action, targetType = null, targetId = null, details = null) {
  await env.DB.prepare(`INSERT INTO activity_logs (id, actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id(), actorId, action, targetType, targetId, details ? JSON.stringify(details) : null).run();
}

async function syncGoogleSheets(env, reason = "data_updated") {
  if (!env.GOOGLE_SHEETS_WEBHOOK || !env.GOOGLE_SHEETS_SECRET) return { configured: false };
  try {
    const [members, divisions, tasks, progress, submissions, activity] = await Promise.all([
      env.DB.prepare(`SELECT u.id, u.username, u.role, u.status, u.created_at, d.name AS division FROM users u LEFT JOIN divisions d ON d.id = u.division_id ORDER BY u.created_at DESC`).all(),
      env.DB.prepare(`SELECT d.id, d.name, d.description, d.status, d.created_at, COUNT(u.id) AS member_count FROM divisions d LEFT JOIN users u ON u.division_id = d.id GROUP BY d.id ORDER BY d.name`).all(),
      env.DB.prepare(`SELECT id, title, description, target, deadline, priority, created_at FROM tasks ORDER BY created_at DESC`).all(),
      env.DB.prepare(`SELECT a.id AS assignment_id, t.title AS task, u.username AS member, d.name AS division, a.status, a.member_note, a.reviewer_note, a.submitted_at, a.reviewed_at, a.updated_at FROM task_assignments a JOIN tasks t ON t.id=a.task_id JOIN users u ON u.id=a.member_id LEFT JOIN divisions d ON d.id=u.division_id ORDER BY a.updated_at DESC`).all(),
      env.DB.prepare(`SELECT p.id, t.title AS task, u.username AS member, p.original_name, p.content_type, p.size_bytes, p.created_at FROM proof_files p JOIN task_assignments a ON a.id=p.assignment_id JOIN tasks t ON t.id=a.task_id JOIN users u ON u.id=a.member_id ORDER BY p.created_at DESC`).all(),
      env.DB.prepare(`SELECT l.id, u.username AS actor, l.action, l.target_type, l.target_id, l.details, l.created_at FROM activity_logs l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.created_at DESC LIMIT 5000`).all()
    ]);
    const payload = {
      secret: env.GOOGLE_SHEETS_SECRET,
      app: env.APP_NAME || "Ahoy's Workspace",
      reason,
      generatedAt: now(),
      sheets: {
        Overview: [{ metric: "Members", value: (members.results || []).length }, { metric: "Divisions", value: (divisions.results || []).length }, { metric: "Tasks", value: (tasks.results || []).length }, { metric: "Assignments", value: (progress.results || []).length }, { metric: "Completed", value: (progress.results || []).filter(x => x.status === "completed").length }, { metric: "Pending Review", value: (progress.results || []).filter(x => x.status === "submitted").length }],
        Members: members.results || [], Divisions: divisions.results || [], Tasks: tasks.results || [],
        Progress: progress.results || [], Submissions: submissions.results || [], Activity_Logs: activity.results || []
      }
    };
    const response = await fetch(env.GOOGLE_SHEETS_WEBHOOK, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return { configured: true, ok: false, status: response.status };
    const result = await response.json().catch(() => ({}));
    return { configured: true, ok: result.ok === true };
  } catch (error) {
    console.error("Google Sheets sync failed:", error);
    return { configured: true, ok: false };
  }
}

async function setupStatus(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first();
  return { setupRequired: Number(row?.total || 0) === 0 };
}
async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, app: env.APP_NAME || "Ahoy's Workspace" });
  }
  if (path === "/api/setup/status" && method === "GET") {
    return json(await setupStatus(env));
  }
  if (path === "/api/setup/first-pengawas" && method === "POST") {
    if (!env.SETUP_SECRET) return json({ error: "SETUP_SECRET_NOT_CONFIGURED" }, 503);
    const body = await request.json().catch(() => ({}));
    if (!body.setupSecret || body.setupSecret !== env.SETUP_SECRET) return json({ error: "INVALID_SETUP_SECRET" }, 403);
    if (!(await setupStatus(env)).setupRequired) return json({ error: "INITIAL_SETUP_ALREADY_COMPLETED" }, 409);
    const username = cleanUsername(body.username);
    const password = String(body.password || "");
    if (!validUsername(username)) return json({ error: "USERNAME_FORMAT_INVALID" }, 400);
    if (password.length < 8) return json({ error: "PASSWORD_TOO_SHORT" }, 400);
    const userId = id();
    try {
      await env.DB.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'pengawas')")
        .bind(userId, username, await passwordHash(password)).run();
    } catch {
      return json({ error: "ACCOUNT_CREATE_FAILED" }, 400);
    }
    await logActivity(env, userId, "first_pengawas_created", "user", userId);
    await syncGoogleSheets(env, "first_pengawas_created");
    return createSession(env, userId, { id: userId, username, role: "pengawas" });
  }
  if (path === "/api/auth/register" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const username = cleanUsername(body.username);
    const password = String(body.password || "");
    if (!validUsername(username)) return json({ error: "USERNAME_FORMAT_INVALID" }, 400);
    if (password.length < 8) return json({ error: "PASSWORD_TOO_SHORT" }, 400);
    const userId = id();
    try {
      await env.DB.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'member')")
        .bind(userId, username, await passwordHash(password)).run();
    } catch {
      return json({ error: "USERNAME_ALREADY_EXISTS" }, 409);
    }
    await logActivity(env, userId, "member_registered", "user", userId);
    const sheetsTest = await syncGoogleSheets(env, "member_registered");
console.log("GOOGLE SHEETS RESULT:", sheetsTest);
    return createSession(env, userId, { id: userId, username, role: "member" });
  }
  if (path === "/api/auth/login" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const username = cleanUsername(body.username);
    const row = await env.DB.prepare("SELECT id, username, password_hash, role, status FROM users WHERE username = ? COLLATE NOCASE")
      .bind(username).first();
    if (!row || row.status !== "active" || !(await verifyPassword(String(body.password || ""), row.password_hash))) {
      return json({ error: "INVALID_CREDENTIALS" }, 401);
    }
    return createSession(env, row.id, row);
  }

  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const user = auth.user;

  if (path === "/api/auth/logout" && method === "POST") {
    const token = bearer(request);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true });
  }
  if (path === "/api/me" && method === "GET") return json({ user });

  if (path === "/api/users" && method === "GET") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const { results } = await env.DB.prepare(`SELECT u.id, u.username, u.role, u.status, u.created_at, u.division_id, d.name AS division_name FROM users u LEFT JOIN divisions d ON d.id=u.division_id ORDER BY u.created_at DESC`).all();
    return json(results || []);
  }

  if (path === "/api/divisions" && method === "GET") {
    if (requireStaff(user)) {
      const { results } = await env.DB.prepare(`SELECT d.*, COUNT(u.id) AS member_count FROM divisions d LEFT JOIN users u ON u.division_id=d.id GROUP BY d.id ORDER BY d.name`).all();
      return json(results || []);
    }
    const { results } = await env.DB.prepare(`SELECT d.id, d.name, d.description, d.status FROM divisions d JOIN users u ON u.division_id=d.id WHERE u.id=?`).bind(user.id).all();
    return json(results || []);
  }

  if (path === "/api/divisions" && method === "POST") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 80);
    const description = String(body.description || "").trim().slice(0, 300);
    if (!name) return json({ error: "DIVISION_NAME_REQUIRED" }, 400);
    const divisionId = id();
    try { await env.DB.prepare("INSERT INTO divisions (id, name, description) VALUES (?, ?, ?)").bind(divisionId, name, description).run(); }
    catch { return json({ error: "DIVISION_NAME_ALREADY_EXISTS" }, 409); }
    await logActivity(env, user.id, "division_created", "division", divisionId, { name });
    await syncGoogleSheets(env, "division_created");
    return json({ ok: true, divisionId }, 201);
  }

  const divisionRoute = path.match(/^\/api\/divisions\/([^/]+)$/);
  if (divisionRoute && method === "PATCH") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const body = await request.json().catch(() => ({}));
    const division = await env.DB.prepare("SELECT id FROM divisions WHERE id=?").bind(divisionRoute[1]).first();
    if (!division) return json({ error: "DIVISION_NOT_FOUND" }, 404);
    const name = String(body.name || "").trim().slice(0, 80);
    const description = String(body.description || "").trim().slice(0, 300);
    const status = body.status === "disabled" ? "disabled" : "active";
    if (!name) return json({ error: "DIVISION_NAME_REQUIRED" }, 400);
    try { await env.DB.prepare("UPDATE divisions SET name=?, description=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name, description, status, division.id).run(); }
    catch { return json({ error: "DIVISION_NAME_ALREADY_EXISTS" }, 409); }
    await logActivity(env, user.id, "division_updated", "division", division.id, { name, status });
    await syncGoogleSheets(env, "division_updated");
    return json({ ok: true });
  }

  const memberDivisionRoute = path.match(/^\/api\/admin\/users\/([^/]+)\/division$/);
  if (memberDivisionRoute && method === "PATCH") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const body = await request.json().catch(() => ({}));
    const target = await env.DB.prepare("SELECT id, role FROM users WHERE id=?").bind(memberDivisionRoute[1]).first();
    if (!target || target.role === "pengawas") return json({ error: "USER_NOT_ASSIGNABLE" }, 404);
    const divisionId = body.divisionId ? String(body.divisionId) : null;
    if (divisionId) {
      const division = await env.DB.prepare("SELECT id FROM divisions WHERE id=? AND status='active'").bind(divisionId).first();
      if (!division) return json({ error: "ACTIVE_DIVISION_NOT_FOUND" }, 404);
    }
    await env.DB.prepare("UPDATE users SET division_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(divisionId, target.id).run();
    await logActivity(env, user.id, "member_division_changed", "user", target.id, { divisionId });
    await syncGoogleSheets(env, "member_division_changed");
    return json({ ok: true });
  }

  if (path === "/api/admin/assignments/reset" && method === "POST") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const body = await request.json().catch(() => ({}));
    const assignmentId = String(body.assignmentId || "");
    if (!assignmentId) return json({ error: "ASSIGNMENT_ID_REQUIRED" }, 400);
    const assignment = await env.DB.prepare("SELECT id, status FROM task_assignments WHERE id=?").bind(assignmentId).first();
    if (!assignment) return json({ error: "NOT_FOUND" }, 404);
    await env.DB.prepare(`UPDATE task_assignments SET status='not_started', member_note=NULL, reviewer_note=NULL, submitted_at=NULL, reviewed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(assignmentId).run();
    await logActivity(env, user.id, "assignment_progress_reset", "assignment", assignmentId, { previousStatus: assignment.status, proofsPreserved: true });
    await syncGoogleSheets(env, "assignment_progress_reset");
    return json({ ok: true, proofsPreserved: true });
  }

  if (path === "/api/admin/activity/reset" && method === "POST") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const body = await request.json().catch(() => ({}));
    if (body.confirmation !== "RESET HISTORY") return json({ error: "RESET_CONFIRMATION_REQUIRED" }, 400);
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM activity_logs").first();
    const deletedCount = Number(countRow?.total || 0);
    await env.DB.prepare("DELETE FROM activity_logs").run();
    // Keep one audit marker so staff can see who cleared the activity log and when.
    await logActivity(env, user.id, "activity_history_reset", "activity_logs", null, { deletedCount });
    await syncGoogleSheets(env, "activity_history_reset");
    return json({ ok: true, deletedCount, auditRecordKept: true });
  }

  if (path === "/api/admin/reports/sync" && method === "POST") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    if (!env.GOOGLE_SHEETS_WEBHOOK || !env.GOOGLE_SHEETS_SECRET) return json({ error: "GOOGLE_SHEETS_NOT_CONFIGURED" }, 503);
    await logActivity(env, user.id, "google_sheets_manual_sync", "report", null);
    const result = await syncGoogleSheets(env, "manual_sync");
    if (!result.ok) return json({ error: "GOOGLE_SHEETS_SYNC_FAILED" }, 502);
    return json({ ok: true });
  }

  if (path === "/api/tasks" && method === "GET") {
    let rows;
    if (requireStaff(user)) {
      const result = await env.DB.prepare(`
        SELECT a.id AS assignment_id, a.status AS assignment_status, a.member_note, a.reviewer_note,
          a.submitted_at, a.reviewed_at, t.id AS task_id, t.title, t.description, t.target, t.deadline,
          t.priority, t.created_at, u.username AS member_username
        FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users u ON u.id = a.member_id
        ORDER BY t.created_at DESC, u.username ASC
      `).all();
      rows = result.results || [];
    } else {
      const result = await env.DB.prepare(`
        SELECT a.id AS assignment_id, a.status AS assignment_status, a.member_note, a.reviewer_note,
          a.submitted_at, a.reviewed_at, t.id AS task_id, t.title, t.description, t.target, t.deadline,
          t.priority, t.created_at
        FROM task_assignments a JOIN tasks t ON t.id = a.task_id
        WHERE a.member_id = ? ORDER BY t.created_at DESC
      `).bind(user.id).all();
      rows = result.results || [];
    }
    return json(rows);
  }

  if (path === "/api/tasks" && method === "POST") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const body = await request.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    const target = String(body.target || "").trim();
    const description = String(body.description || "").trim();
    const deadline = body.deadline ? String(body.deadline) : null;
    const priority = ["low", "medium", "high"].includes(body.priority) ? body.priority : "medium";
    if (!title || !target) return json({ error: "TITLE_AND_TARGET_REQUIRED" }, 400);

    let members = [];
    if (target.toLowerCase() === "all") {
      const result = await env.DB.prepare("SELECT id FROM users WHERE role = 'member' AND status = 'active'").all();
      members = result.results || [];
    } else {
      const names = [...new Set(target.split(",").map(cleanUsername).filter(Boolean))];
      if (!names.length) return json({ error: "TARGET_REQUIRED" }, 400);
      for (const name of names) {
        const member = await env.DB.prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE AND status = 'active'")
          .bind(name).first();
        if (!member) return json({ error: "TARGET_USER_NOT_FOUND", username: name }, 404);
        if (member.role === "pengawas") return json({ error: "CANNOT_ASSIGN_TO_PENGAWAS" }, 400);
        members.push(member);
      }
    }
    if (!members.length) return json({ error: "NO_TARGET_MEMBERS" }, 400);
    const taskId = id();
    await env.DB.prepare("INSERT INTO tasks (id, title, description, target, deadline, priority, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(taskId, title, description, target, deadline, priority, user.id).run();
    for (const member of members) {
      await env.DB.prepare("INSERT INTO task_assignments (id, task_id, member_id) VALUES (?, ?, ?)")
        .bind(id(), taskId, member.id).run();
    }
    await logActivity(env, user.id, "task_created", "task", taskId, { title, target, assignments: members.length });
    await syncGoogleSheets(env, "task_created");
    return json({ ok: true, taskId, assigned: members.length }, 201);
  }

  const assignmentStatus = path.match(/^\/api\/assignments\/([^/]+)\/status$/);
  if (assignmentStatus && method === "PATCH") {
    if (user.role !== "member") return json({ error: "FORBIDDEN" }, 403);
    const assignmentId = assignmentStatus[1];
    const row = await env.DB.prepare("SELECT id, status FROM task_assignments WHERE id = ? AND member_id = ?")
      .bind(assignmentId, user.id).first();
    if (!row) return json({ error: "NOT_FOUND" }, 404);
    if (row.status === "completed" || row.status === "submitted") return json({ error: "TASK_NOT_EDITABLE" }, 409);
    await env.DB.prepare("UPDATE task_assignments SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(assignmentId).run();
    await logActivity(env, user.id, "task_started", "assignment", assignmentId);
    await syncGoogleSheets(env, "task_started");
    return json({ ok: true });
  }

  const proofUpload = path.match(/^\/api\/assignments\/([^/]+)\/proof$/);
  if (proofUpload && method === "POST") {
    if (user.role !== "member") return json({ error: "FORBIDDEN" }, 403);
    const assignmentId = proofUpload[1];
    const assignment = await env.DB.prepare("SELECT id, status FROM task_assignments WHERE id = ? AND member_id = ?")
      .bind(assignmentId, user.id).first();
    if (!assignment) return json({ error: "NOT_FOUND" }, 404);
    if (assignment.status === "completed") return json({ error: "TASK_ALREADY_COMPLETED" }, 409);
    const form = await request.formData();
    const file = form.get("file");
    const note = String(form.get("note") || "").trim();
    if (!(file instanceof File) || !file.size) return json({ error: "FILE_REQUIRED" }, 400);
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) return json({ error: "FILE_TYPE_NOT_ALLOWED" }, 415);
    if (file.size > 5 * 1024 * 1024) return json({ error: "FILE_TOO_LARGE_MAX_5MB" }, 413);
    const proofId = id();
    const objectKey = `${user.id}/${assignmentId}/${proofId}`;
    await env.PROOFS.put(objectKey, await file.arrayBuffer(), {
      metadata: { contentType: file.type, originalName: file.name.slice(0, 180) }
    });
    await env.DB.prepare(`INSERT INTO proof_files (id, assignment_id, object_key, original_name, content_type, size_bytes, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(proofId, assignmentId, objectKey, file.name.slice(0, 180), file.type, file.size, user.id).run();
    await env.DB.prepare(`UPDATE task_assignments SET status = 'submitted', member_note = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(note, assignmentId).run();
    await logActivity(env, user.id, "proof_submitted", "assignment", assignmentId, { proofId, filename: file.name });
    await syncGoogleSheets(env, "proof_submitted");
    return json({ ok: true, proofId }, 201);
  }

  const proofList = path.match(/^\/api\/assignments\/([^/]+)\/proofs$/);
  if (proofList && method === "GET") {
    const assignmentId = proofList[1];
    const assignment = await env.DB.prepare("SELECT id, member_id FROM task_assignments WHERE id = ?")
      .bind(assignmentId).first();
    if (!assignment) return json({ error: "NOT_FOUND" }, 404);
    if (assignment.member_id !== user.id && !requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const { results } = await env.DB.prepare(`
      SELECT id, original_name, content_type, size_bytes, created_at
      FROM proof_files WHERE assignment_id = ? ORDER BY created_at DESC
    `).bind(assignmentId).all();
    return json(results || []);
  }

  const proofGet = path.match(/^\/api\/proofs\/([^/]+)$/);
  if (proofGet && method === "GET") {
    const proof = await env.DB.prepare(`
      SELECT p.*, a.member_id FROM proof_files p
      JOIN task_assignments a ON a.id = p.assignment_id WHERE p.id = ?
    `).bind(proofGet[1]).first();
    if (!proof) return json({ error: "NOT_FOUND" }, 404);
    if (proof.member_id !== user.id && !requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const object = await env.PROOFS.get(proof.object_key, "arrayBuffer");
    if (!object) return json({ error: "PROOF_FILE_MISSING" }, 404);
    const filename = String(proof.original_name || "proof").replace(/["\r\n]/g, "_");
    return new Response(object, { headers: {
      "content-type": proof.content_type,
      "content-length": String(proof.size_bytes),
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }});
  }

  const review = path.match(/^\/api\/assignments\/([^/]+)\/review$/);
  if (review && method === "POST") {
    if (!requireStaff(user)) return json({ error: "FORBIDDEN" }, 403);
    const assignmentId = review[1];
    const body = await request.json().catch(() => ({}));
    const status = body.status;
    const note = String(body.note || "").trim();
    if (!["completed", "revision"].includes(status)) return json({ error: "INVALID_REVIEW_STATUS" }, 400);
    const assignment = await env.DB.prepare("SELECT id FROM task_assignments WHERE id = ?").bind(assignmentId).first();
    if (!assignment) return json({ error: "NOT_FOUND" }, 404);
    await env.DB.prepare(`UPDATE task_assignments SET status = ?, reviewer_note = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(status, note, assignmentId).run();
    await logActivity(env, user.id, status === "completed" ? "task_approved" : "revision_requested", "assignment", assignmentId, { note });
    await syncGoogleSheets(env, status === "completed" ? "task_approved" : "revision_requested");
    return json({ ok: true });
  }

  const roleRoute = path.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (roleRoute && method === "PATCH") {
    if (user.role !== "pengawas") return json({ error: "FORBIDDEN" }, 403);
    const body = await request.json().catch(() => ({}));
    const role = body.role;
    if (!["admin", "member"].includes(role)) return json({ error: "INVALID_ROLE" }, 400);
    const target = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(roleRoute[1]).first();
    if (!target) return json({ error: "NOT_FOUND" }, 404);
    if (target.role === "pengawas") return json({ error: "PENGAWAS_PROTECTED" }, 403);
    await env.DB.prepare("UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(role, target.id).run();
    await logActivity(env, user.id, "user_role_changed", "user", target.id, { role });
    await syncGoogleSheets(env, "user_role_changed");
    return json({ ok: true });
  }

  if (path === "/api/activity" && method === "GET") {
    if (requireStaff(user)) {
      const { results } = await env.DB.prepare(`
        SELECT l.*, u.username AS actor_username FROM activity_logs l
        LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.created_at DESC LIMIT 100
      `).all();
      return json(results || []);
    }
    const { results } = await env.DB.prepare(`
      SELECT action, target_type, target_id, details, created_at FROM activity_logs
      WHERE actor_id = ? ORDER BY created_at DESC LIMIT 100
    `).bind(user.id).all();
    return json(results || []);
  }

  return json({ error: "NOT_FOUND" }, 404);
}
async function createSession(env, userId, user) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id(), userId, await sha256(token), expiresAt).run();
  return json({ ok: true, token, user: { id: user.id, username: user.username, role: user.role }, expiresAt });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Workspace request failed:", error);
      return json({ error: "INTERNAL_ERROR" }, 500);
    }
  }
};
