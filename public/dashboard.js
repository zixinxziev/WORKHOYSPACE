const sidebar = document.getElementById("sidebar");
document.getElementById("toggleSidebar").addEventListener("click", () => sidebar.classList.toggle("open"));
document.querySelectorAll(".side-nav a").forEach(link => link.addEventListener("click", () => {
  document.querySelectorAll(".side-nav a").forEach(a => a.classList.remove("active"));
  link.classList.add("active");
  if (window.innerWidth <= 700) sidebar.classList.remove("open");
}));
const toast = document.getElementById("toast");
let toastTimer;
document.getElementById("createTask").addEventListener("click", () => {
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
});
document.addEventListener("click", e => {
  if (window.innerWidth <= 700 && sidebar.classList.contains("open") &&
      !sidebar.contains(e.target) && !e.target.closest("#toggleSidebar")) sidebar.classList.remove("open");
});
