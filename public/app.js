const tablet = document.getElementById("tablet");
const visual = document.querySelector(".hero-visual");
let lastScroll = 0;
const header = document.getElementById("siteHeader");

if (visual && tablet && window.matchMedia("(pointer:fine)").matches) {
  visual.addEventListener("mousemove", (event) => {
    const rect = visual.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    const rotateY = -x * 13;
    const rotateX = y * 10;
    tablet.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
  });
  visual.addEventListener("mouseleave", () => tablet.style.transform = "rotateX(0deg) rotateY(0deg)");
}

window.addEventListener("scroll", () => {
  const current = window.scrollY;
  if (current > 150 && current > lastScroll + 4) header.classList.add("hidden");
  else if (current < lastScroll - 4) header.classList.remove("hidden");
  lastScroll = current;
}, { passive: true });

const nav = document.getElementById("mainNav");
document.getElementById("mobileMenu").addEventListener("click", () => nav.classList.toggle("open"));
nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => nav.classList.remove("open")));

const modal = document.getElementById("loginModal");
const message = document.getElementById("formMessage");
document.querySelectorAll("[data-open-login]").forEach(button => button.addEventListener("click", () => {
  modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
}));
function closeModal(){ modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); }
document.getElementById("closeModal").addEventListener("click", closeModal);
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
document.getElementById("showRegister").addEventListener("click", () => {
  message.textContent = "Registration UI is planned for the next implementation phase. Account role is assigned automatically as Member.";
});
document.getElementById("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  message.textContent = "Backend authentication belum diaktifkan. Jangan gunakan form ini untuk kredensial asli.";
});

// Four-stage product-preview loop. It changes the sample dashboard copy only.
const demoContent = document.getElementById("demoContent");
const demoStep = document.getElementById("demoStep");
const demoStages = [
  { label:"01 / 04", title:"Good morning, Admin.", subtitle:"Your team's progress at a glance." },
  { label:"02 / 04", title:"Task assigned.", subtitle:"A new task is ready for the Content Team." },
  { label:"03 / 04", title:"Proof submitted.", subtitle:"Your member has uploaded files for review." },
  { label:"04 / 04", title:"Task approved.", subtitle:"Review complete. The assignment is now done." }
];
let stage = 0;
setInterval(() => {
  stage = (stage + 1) % demoStages.length;
  const welcome = demoContent.querySelector(".demo-welcome");
  welcome.querySelector("b").textContent = demoStages[stage].title;
  welcome.querySelector("span").textContent = demoStages[stage].subtitle;
  demoStep.textContent = demoStages[stage].label;
}, 4200);
