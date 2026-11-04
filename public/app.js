const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const API = "/api";
let mode = "login";
let currentUser = null;
let tasksCache = [];
let usersCache = [];
let activeView = "dashboard";

const tablet = $("#tablet"), visual = $(".hero-visual"), header = $("#siteHeader");
let lastScroll = 0;

if (visual && tablet && window.matchMedia("(pointer:fine)").matches) {
  visual.addEventListener("mousemove", e => {
    const r = visual.getBoundingClientRect(), x = (e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
    tablet.style.transform = `rotateX(${y*10}deg) rotateY(${-x*13}deg) translateY(-3px)`;
  });
  visual.addEventListener("mouseleave", () => tablet.style.transform = "rotateX(0deg) rotateY(0deg)");
}

window.addEventListener("scroll", () => {
  const y = window.scrollY;
  if (y > 150 && y > lastScroll + 4) header?.classList.add("hidden");
  else if (y < lastScroll - 4) header?.classList.remove("hidden");
  lastScroll = y;
}, {passive:true});

const nav = $("#mainNav");
$("#mobileMenu")?.addEventListener("click", () => nav?.classList.toggle("open"));
$$("nav a").forEach(a => a.addEventListener("click", () => nav?.classList.remove("open")));

const modal = $("#loginModal"), form = $("#authForm"), message = $("#formMessage");

function setMode(next) {
  mode = next;

  const titles = {
    login: ["Welcome back.", "Sign in to continue to your workspace.", "Login"],
    register: ["Create your account.", "Register as a workspace member.", "Create Account"],
    setup: ["Set up your workspace.", "Create the first Pengawas account. This setup is available only while no account exists.", "Create Pengawas"]
  };

  $("#loginTitle").textContent = titles[mode][0];
  $("#loginSubtitle").textContent = titles[mode][1];
  $("#authSubmit").innerHTML = `${titles[mode][2]} <span>↗</span>`;
  $("#setupSecretLabel").classList.toggle("hidden", mode !== "setup");

  // Registration has its own confirmation field; login and first-time setup do not.
  let confirmLabel = $("#confirmPasswordLabel", form);

  if (!confirmLabel) {
    confirmLabel = document.createElement("label");
    confirmLabel.id = "confirmPasswordLabel";
    confirmLabel.innerHTML = 'Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" placeholder="Re-enter your password" minlength="8">';
    $("#authSubmit").before(confirmLabel);
  }

  confirmLabel.classList.toggle("hidden", mode !== "register");

  const passwordInput = $('input[name="password"]', form);
  if (passwordInput) passwordInput.autocomplete = mode === "login" ? "current-password" : "new-password";

  const confirmInput = $('input[name="confirmPassword"]', form);
  if (confirmInput) confirmInput.required = mode === "register";

  $("#modalNote").classList.toggle("hidden", mode === "setup");

  $("#modalNote").innerHTML = mode === "register"
    ? 'Already have an account? <button type="button" id="showLogin">Login</button>'
    : 'New to the workspace? <button type="button" id="showRegister">Create an account</button>';

  message.textContent = "";
  form.reset();
}

function openModal(next="login") {
  setMode(next);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden","false");
}

function closeModal(){
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden","true");
}

$$("[data-open-login]").forEach(b => b.addEventListener("click", () => openModal("login")));
$$("[data-open-register]").forEach(b => b.addEventListener("click", () => openModal("register")));

// Event delegation keeps the Login / Create Account switch working after modal text is replaced.
$("#modalNote").addEventListener("click", e => {
  const switchButton = e.target.closest("#showLogin, #showRegister");
  if (!switchButton) return;
  e.preventDefault();
  setMode(switchButton.id === "showRegister" ? "register" : "login");
});

$("#closeModal").addEventListener("click", closeModal);
modal.addEventListener("click", e => {
  if(e.target===modal) closeModal();
});
document.addEventListener("keydown", e => {
  if(e.key==="Escape") closeModal();
});

async function api(path, options={}) {
  const token = localStorage.getItem("ahoyWorkspaceToken");
  const headers = {...(options.headers||{})};

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"]="application/json";
  }

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(API+path,{
    ...options,
    headers,
    cache:"no-store"
  });

  const type = response.headers.get("content-type")||"";
  const data = type.includes("application/json") ? await response.json() : response;

  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

  return data;
}

function humanError(error) {
  const map = {
    INVALID_CREDENTIALS:"Username atau password salah.",
    USERNAME_ALREADY_EXISTS:"Username sudah digunakan.",
    USERNAME_FORMAT_INVALID:"Username 3–24 karakter, hanya huruf kecil, angka, dan underscore.",
    PASSWORD_TOO_SHORT:"Password minimal 8 karakter.",
    INVALID_SETUP_SECRET:"Setup secret salah.",
    SETUP_SECRET_NOT_CONFIGURED:"SETUP_SECRET belum dipasang di Cloudflare Worker.",
    INITIAL_SETUP_ALREADY_COMPLETED:"Setup Pengawas sudah pernah dilakukan.",
    TARGET_USER_NOT_FOUND:"Username target tidak ditemukan.",
    FILE_TOO_LARGE_MAX_5MB:"Ukuran file maksimal 5 MB.",
    FILE_TYPE_NOT_ALLOWED:"Format file harus JPG, PNG, WEBP, atau PDF.",
    UNAUTHORIZED:"Sesi berakhir. Silakan login kembali."
  };

  return map[error.message] || error.message || "Terjadi kesalahan.";
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  message.textContent = "Please wait...";

  const fd = new FormData(form);
  const body = {
    username:fd.get("username"),
    password:fd.get("password")
  };

  if (mode === "register" && body.password !== fd.get("confirmPassword")) {
    message.textContent = "Konfirmasi password tidak sama.";
    return;
  }

  let endpoint = "/auth/login";

  if (mode==="register") endpoint="/auth/register";

  if (mode==="setup") {
    endpoint="/setup/first-pengawas";
    body.setupSecret=fd.get("setupSecret");
  }

  try {
    const result = await api(endpoint,{
      method:"POST",
      body:JSON.stringify(body)
    });

    localStorage.setItem("ahoyWorkspaceToken",result.token);
    currentUser=result.user;
    closeModal();
    await enterWorkspace();

  } catch(err) {
    message.textContent=humanError(err);
  }
});

async function checkInitialSetup() {
  try {
    const s=await fetch(API+"/setup/status").then(r=>r.json());

    if(s.setupRequired) {
      openModal("setup");
      message.textContent="First-time setup: create the Pengawas account.";
    }
  } catch {}
}

function escapeHtml(s) {
  return String(s??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[c]));
}

function labelStatus(s) {
  return ({
    not_started:"Not started",
    in_progress:"In progress",
    submitted:"Submitted",
    revision:"Revision requested",
    completed:"Completed"
  })[s]||s;
}

function pill(s) {
  const cls=s==="completed"?"green":s==="submitted"?"blue":s==="revision"?"red":s==="in_progress"?"warn":"";
  return `<span class="ws-pill ${cls}">${escapeHtml(labelStatus(s))}</span>`;
}

function dateText(s) {
  if(!s) return "No deadline";
  const d=new Date(s);
  return Number.isNaN(d.getTime())?escapeHtml(s):d.toLocaleString();
}

function shell() {
  $("#landingMain").classList.add("hidden");
  $("#siteFooter").classList.add("hidden");
  $("#mainNav").classList.add("hidden");
  $("#mobileMenu").classList.add("hidden");

  const root=$("#workspaceRoot");
  root.classList.remove("hidden");

  root.innerHTML=`<div class="ws-layout">
    <aside class="ws-sidebar">
      <div class="ws-user">
        <strong>${escapeHtml(currentUser.username)}</strong>
        <small>${escapeHtml(currentUser.role)}</small>
      </div>
      <div class="ws-nav">
        <button data-view="dashboard" class="active">Overview</button>
        <button data-view="tasks">Tasks</button>
        <button data-view="history">History</button>
        ${currentUser.role!=="member"?'<button data-view="manage">Manage</button>':''}
      </div>
      <button class="ws-logout" id="logoutBtn">Sign out</button>
    </aside>
    <section class="ws-main">
      <div class="ws-top">
        <div>
          <h1 id="viewTitle">Workspace overview</h1>
          <p id="viewSubtitle">Your work, progress, and updates in one place.</p>
        </div>
        <span class="ws-pill">${escapeHtml(currentUser.role.toUpperCase())}</span>
      </div>
      <div id="viewContent"></div>
    </section>
  </div>`;

  $$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  $("#logoutBtn").addEventListener("click",logout);
}

async function enterWorkspace() {
  try {
    if(!currentUser) {
      const data=await api("/me");
      currentUser=data.user;
    }

    shell();
    await refreshData();
    await showView("dashboard");

  } catch(e) {
    localStorage.removeItem("ahoyWorkspaceToken");
    currentUser=null;
    $("#landingMain").classList.remove("hidden");
    $("#siteFooter").classList.remove("hidden");
    $("#mainNav").classList.remove("hidden");
  }
}

async function refreshData() {
  tasksCache=await api("/tasks");

  if(currentUser.role!=="member") {
    usersCache=await api("/users");
  }
}

function stats() {
  const total=tasksCache.length;
  const active=tasksCache.filter(t=>["in_progress","not_started","revision"].includes(t.assignment_status)).length;
  const review=tasksCache.filter(t=>t.assignment_status==="submitted").length;
  const done=tasksCache.filter(t=>t.assignment_status==="completed").length;

  return `<div class="ws-stats">
    <div class="ws-stat"><small>Total assignments</small><b>${total}</b></div>
    <div class="ws-stat"><small>In progress</small><b>${active}</b></div>
    <div class="ws-stat"><small>Pending review</small><b>${review}</b></div>
    <div class="ws-stat"><small>Completed</small><b>${done}</b></div>
  </div>`;
}

function taskCard(t, admin=false) {
  const status=t.assignment_status;

  const actions = currentUser.role==="member" ? `
    ${status==="not_started"||status==="revision"?`<button class="ws-btn secondary" data-start="${t.assignment_id}">Start task</button>`:""}
    ${status!=="completed"?`<form class="ws-proof-form" data-proof="${t.assignment_id}">
      <div class="ws-proof">
        <input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required>
        <input name="note" placeholder="Add a note (optional)">
        <button class="ws-btn" type="submit">Submit proof</button>
      </div>
      <small class="ws-note">JPG, PNG, WEBP, PDF · max 5 MB</small>
    </form>`:""}`
    : `
    <div class="ws-actions">
      ${status==="submitted"?`
        <button class="ws-btn" data-review="${t.assignment_id}" data-status="completed">Approve</button>
        <button class="ws-btn danger" data-review="${t.assignment_id}" data-status="revision">Request revision</button>
      `:""}
    </div>`;

  return `<article class="ws-task">
    <div class="ws-task-head">
      <div>
        <h3>${escapeHtml(t.title)}</h3>
        <p>${escapeHtml(t.description||"No description")}</p>
      </div>
      ${pill(status)}
    </div>
    <div class="ws-meta">
      <span class="ws-pill">${escapeHtml(t.priority)} priority</span>
      <span class="ws-pill">Deadline: ${dateText(t.deadline)}</span>
      ${admin?`<span class="ws-pill blue">Member: ${escapeHtml(t.member_username)}</span>`:""}
    </div>
    ${t.member_note?`<p><b>Member note:</b> ${escapeHtml(t.member_note)}</p>`:""}
    ${t.reviewer_note?`<p><b>Review note:</b> ${escapeHtml(t.reviewer_note)}</p>`:""}
    <div class="ws-proof-list" data-proofs="${t.assignment_id}">
      <span class="ws-note">Loading submitted files...</span>
    </div>
    <div class="ws-actions">${actions}</div>
  </article>`;
}

async function showView(view) {
  activeView=view;

  $$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));

  const titles={
    dashboard:["Workspace overview","Your work, progress, and updates in one place."],
    tasks:["Tasks","Assignments and current work status."],
    history:["History","Completed work and recent activity."],
    manage:["Workspace management","Create tasks and manage workspace members."]
  };

  $("#viewTitle").textContent=titles[view][0];
  $("#viewSubtitle").textContent=titles[view][1];

  const box=$("#viewContent");
  await refreshData();

  if(view==="dashboard") {
    box.innerHTML=stats()+`<section class="ws-panel">
      <h2>${currentUser.role==="member"?"Your assigned tasks":"Recent assignments"}</h2>
      <div class="ws-task-list">
        ${tasksCache.slice(0,5).map(t=>taskCard(t,currentUser.role!=="member")).join("")||'<div class="ws-empty">No tasks yet.</div>'}
      </div>
    </section>`;

  } else if(view==="tasks") {
    box.innerHTML=`<section class="ws-panel">
      <h2>All tasks</h2>
      <div class="ws-task-list">
        ${tasksCache.map(t=>taskCard(t,currentUser.role!=="member")).join("")||'<div class="ws-empty">No tasks found.</div>'}
      </div>
    </section>`;

  } else if(view==="history") {
    const rows=tasksCache.filter(t=>["completed","submitted","revision"].includes(t.assignment_status));

    box.innerHTML=`<section class="ws-panel">
      <h2>Task history</h2>
      <div class="ws-task-list">
        ${rows.map(t=>taskCard(t,currentUser.role!=="member")).join("")||'<div class="ws-empty">No activity history yet.</div>'}
      </div>
    </section>`;

  } else if(view==="manage" && currentUser.role!=="member") {
    box.innerHTML=`<section class="ws-panel">
      <h2>Create a task</h2>
      <p class="ws-muted">Target accepts one or more usernames separated by commas. Use <b>all</b> to assign every active member.</p>
      <form id="createTaskForm" class="ws-form">
        <div class="ws-field full">
          <label>Task title *</label>
          <input name="title" required maxlength="140" placeholder="Task title">
        </div>
        <div class="ws-field">
          <label>Target *</label>
          <input name="target" required placeholder="username1, username2 or all">
        </div>
        <div class="ws-field">
          <label>Deadline</label>
          <input name="deadline" type="datetime-local">
        </div>
        <div class="ws-field">
          <label>Priority</label>
          <select name="priority">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div class="ws-field full">
          <label>Description</label>
          <textarea name="description" placeholder="Task details and expected result"></textarea>
        </div>
        <div class="ws-field full">
          <button class="ws-btn" type="submit">Create and assign task</button>
        </div>
      </form>
    </section>
    <section class="ws-panel">
      <h2>Member accounts</h2>
      <div class="ws-task-list">
        ${usersCache.map(u=>`
          <div class="ws-task">
            <div class="ws-task-head">
              <div>
                <h3>${escapeHtml(u.username)}</h3>
                <p>Joined ${dateText(u.created_at)}</p>
              </div>
              <span class="ws-pill">${escapeHtml(u.role)}</span>
            </div>
            ${currentUser.role==="pengawas" && u.role!=="pengawas"?`
              <div class="ws-actions">
                <button class="ws-btn secondary" data-role-user="${u.id}" data-role="${u.role==="admin"?"member":"admin"}">
                  ${u.role==="admin"?"Set as Member":"Promote to Admin"}
                </button>
              </div>
            `:""}
          </div>
        `).join("")||'<div class="ws-empty">No members yet.</div>'}
      </div>
    </section>`;

    $("#createTaskForm").addEventListener("submit",createTask);
    $$("[data-role-user]").forEach(b=>b.addEventListener("click",changeRole));
  }

  bindTaskActions();
}

function bindTaskActions() {
  $$(".ws-proof-list[data-proofs]").forEach(async box => {
    try {
      const files = await api(`/assignments/${box.dataset.proofs}/proofs`);

      if (!files.length) {
        box.innerHTML = '<span class="ws-note">No proof submitted yet.</span>';
        return;
      }

      box.innerHTML = `<div class="ws-note"><b>Submitted files</b></div>` + files.map(file =>
        `<button type="button" class="ws-btn secondary" data-open-proof="${escapeHtml(file.id)}">${escapeHtml(file.original_name)} · ${(file.size_bytes/1024).toFixed(0)} KB</button>`
      ).join(" ");

      $$("[data-open-proof]", box).forEach(button => button.addEventListener("click", async () => {
        try {
          const token = localStorage.getItem("ahoyWorkspaceToken");

          const response = await fetch(`${API}/proofs/${encodeURIComponent(button.dataset.openProof)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            cache: "no-store"
          });

          if (!response.ok) throw new Error("Unable to open proof file");

          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");

          link.href = objectUrl;
          link.target = "_blank";
          link.rel = "noopener";
          link.click();

          setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

        } catch (error) {
          alert(humanError(error));
        }
      }));

    } catch {
      box.innerHTML = '<span class="ws-note">Could not load proof files.</span>';
    }
  });

  $$("[data-start]").forEach(b=>b.addEventListener("click",async()=>{
    try {
      await api(`/assignments/${b.dataset.start}/status`,{
        method:"PATCH",
        body:"{}"
      });
      await showView(activeView);
    } catch(e) {
      alert(humanError(e));
    }
  }));

  $$(".ws-proof-form").forEach(f=>f.addEventListener("submit",async e=>{
    e.preventDefault();

    const fd=new FormData(f);
    const b=$("button",f);
    b.disabled=true;

    try {
      await api(`/assignments/${f.dataset.proof}/proof`,{
        method:"POST",
        body:fd
      });
      await showView(activeView);
    } catch(err) {
      alert(humanError(err));
      b.disabled=false;
    }
  }));

  $$("[data-review]").forEach(b=>b.addEventListener("click",async()=>{
    const note=prompt(b.dataset.status==="completed"?"Optional approval note:":"What needs to be revised?")||"";

    try {
      await api(`/assignments/${b.dataset.review}/review`,{
        method:"POST",
        body:JSON.stringify({status:b.dataset.status,note})
      });
      await showView(activeView);
    } catch(e) {
      alert(humanError(e));
    }
  }));
}

async function createTask(e) {
  e.preventDefault();

  const data=Object.fromEntries(new FormData(e.currentTarget).entries());

  if(data.deadline) data.deadline=new Date(data.deadline).toISOString();

  try {
    const result=await api("/tasks",{
      method:"POST",
      body:JSON.stringify(data)
    });

    alert(`Task created. Assigned to ${result.assigned} member(s).`);
    await showView("tasks");

  } catch(err) {
    alert(humanError(err));
  }
}

async function changeRole(e) {
  const b=e.currentTarget;

  if(!confirm(`Change this account role to ${b.dataset.role}?`)) return;

  try {
    await api(`/admin/users/${b.dataset.roleUser}/role`,{
      method:"PATCH",
      body:JSON.stringify({role:b.dataset.role})
    });
    await showView("manage");

  } catch(err) {
    alert(humanError(err));
  }
}

async function logout() {
  try {
    await api("/auth/logout",{
      method:"POST",
      body:"{}"
    });
  } catch {}

  localStorage.removeItem("ahoyWorkspaceToken");
  currentUser=null;

  $("#workspaceRoot").classList.add("hidden");
  $("#landingMain").classList.remove("hidden");
  $("#siteFooter").classList.remove("hidden");
  $("#mainNav").classList.remove("hidden");
  $("#mobileMenu").classList.remove("hidden");

  window.scrollTo({top:0,behavior:"smooth"});
}

(async function init(){
  const stages=[
    ["Good morning, Admin.","Your team's progress at a glance."],
    ["Task assigned.","A new task is ready for the team."],
    ["Proof submitted.","A member has uploaded work for review."],
    ["Task approved.","Review complete. The assignment is done."]
  ];

  let stage=0;

  setInterval(()=>{
    const w=$("#demoContent .demo-welcome");
    if(!w) return;

    stage=(stage+1)%stages.length;
    w.querySelector("b").textContent=stages[stage][0];
    w.querySelector("span").textContent=stages[stage][1];
    $("#demoStep").textContent=`0${stage+1} / 04`;
  },4200);

  const token=localStorage.getItem("ahoyWorkspaceToken");

  if(token) await enterWorkspace();
  else await checkInitialSetup();
})();

// Refresh Cloudflare deployment
