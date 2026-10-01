// Deck navigation: arrow keys, the Previous and Next buttons, and the current slide's mark in the nav.
const slides = [...document.querySelectorAll(".slide")];
const links = [...document.querySelectorAll(".deck-nav ol a")];
const buttons = [...document.querySelectorAll(".deck-nav button")];
let current = 0;

function show(index) {
  const next = Math.max(0, Math.min(slides.length - 1, index));
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  slides[next].scrollIntoView({ behavior: calm ? "auto" : "smooth" });
  history.replaceState(null, "", `#${slides[next].id}`);
}

function mark(index) {
  current = index;
  links.forEach((link, i) => (i === index ? link.setAttribute("aria-current", "true") : link.removeAttribute("aria-current")));
  for (const button of buttons) button.disabled = index + Number(button.dataset.step) < 0 || index + Number(button.dataset.step) >= slides.length;
}

const seen = new IntersectionObserver(
  (entries) => { for (const entry of entries) if (entry.isIntersecting) mark(slides.indexOf(entry.target)); },
  { rootMargin: "-50% 0px -50% 0px" },
);
for (const slide of slides) seen.observe(slide);

for (const button of buttons) {
  button.hidden = false;
  button.addEventListener("click", () => show(current + Number(button.dataset.step)));
}

const STEPS = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === " " && event.target.closest("a, button")) return;
  if (event.key === "Home") show(0);
  else if (event.key === "End") show(slides.length - 1);
  else if (event.key in STEPS) show(current + (event.shiftKey && event.key === " " ? -1 : STEPS[event.key]));
  else return;
  event.preventDefault();
});
