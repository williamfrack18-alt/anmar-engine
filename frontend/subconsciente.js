const STORAGE_KEY = "ritmo_mental_state_v1";

const state = {
  intention: "",
  affirmations: [],
  journal: "",
  completedDays: [],
  streak: 0,
};

const el = {
  intentionInput: document.getElementById("intentionInput"),
  saveIntentionBtn: document.getElementById("saveIntentionBtn"),
  intentionStatus: document.getElementById("intentionStatus"),
  breathStage: document.getElementById("breathStage"),
  breathCounter: document.getElementById("breathCounter"),
  startBreathBtn: document.getElementById("startBreathBtn"),
  stopBreathBtn: document.getElementById("stopBreathBtn"),
  affirmationInput: document.getElementById("affirmationInput"),
  addAffirmationBtn: document.getElementById("addAffirmationBtn"),
  affirmationList: document.getElementById("affirmationList"),
  journalInput: document.getElementById("journalInput"),
  saveJournalBtn: document.getElementById("saveJournalBtn"),
  journalStatus: document.getElementById("journalStatus"),
  activeDaysMetric: document.getElementById("activeDaysMetric"),
  streakMetric: document.getElementById("streakMetric"),
  affirmationMetric: document.getElementById("affirmationMetric"),
  markDoneBtn: document.getElementById("markDoneBtn"),
  doneStatus: document.getElementById("doneStatus"),
};

const breathSteps = ["Inhala", "Sostiene", "Exhala", "Pausa"];
let breathInterval = null;
let breathIndex = 0;
let secondsLeft = 0;

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISODate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function diffDays(dateA, dateB) {
  const ms = dateA.getTime() - dateB.getTime();
  return Math.round(ms / 86400000);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.intention = parsed.intention || "";
    state.affirmations = Array.isArray(parsed.affirmations) ? parsed.affirmations.slice(0, 30) : [];
    state.journal = parsed.journal || "";
    state.completedDays = Array.isArray(parsed.completedDays) ? parsed.completedDays : [];
    state.streak = Number.isFinite(parsed.streak) ? parsed.streak : 0;
  } catch (_) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function refreshUI() {
  el.intentionInput.value = state.intention;
  el.journalInput.value = state.journal;

  el.affirmationList.innerHTML = "";
  state.affirmations.forEach((text, idx) => {
    const li = document.createElement("li");
    li.textContent = text;
    li.title = "Click para eliminar";
    li.addEventListener("click", () => {
      state.affirmations.splice(idx, 1);
      persistState();
      refreshUI();
    });
    el.affirmationList.appendChild(li);
  });

  el.activeDaysMetric.textContent = String(state.completedDays.length);
  el.streakMetric.textContent = String(state.streak);
  el.affirmationMetric.textContent = String(state.affirmations.length);
}

function saveIntention() {
  const text = el.intentionInput.value.trim();
  if (!text) {
    el.intentionStatus.textContent = "Escribe una intencion primero.";
    el.intentionStatus.classList.add("error");
    return;
  }
  state.intention = text;
  persistState();
  el.intentionStatus.textContent = "Intencion guardada.";
  el.intentionStatus.classList.remove("error");
}

function addAffirmation() {
  const text = el.affirmationInput.value.trim();
  if (!text) return;
  state.affirmations.unshift(text);
  state.affirmations = state.affirmations.slice(0, 30);
  el.affirmationInput.value = "";
  persistState();
  refreshUI();
}

function saveJournal() {
  const text = el.journalInput.value.trim();
  state.journal = text;
  persistState();
  el.journalStatus.textContent = text ? "Nota guardada." : "Diario vacio guardado.";
  el.journalStatus.classList.remove("error");
}

function computeStreak() {
  if (!state.completedDays.length) return 0;
  const uniqueDays = [...new Set(state.completedDays)].sort();
  let streak = 1;
  for (let i = uniqueDays.length - 1; i > 0; i -= 1) {
    const cur = parseISODate(uniqueDays[i]);
    const prev = parseISODate(uniqueDays[i - 1]);
    if (diffDays(cur, prev) === 1) streak += 1;
    else break;
  }
  const lastDay = parseISODate(uniqueDays[uniqueDays.length - 1]);
  const gap = diffDays(parseISODate(todayISO()), lastDay);
  if (gap > 1) return 0;
  return streak;
}

function markDone() {
  const today = todayISO();
  if (!state.completedDays.includes(today)) {
    state.completedDays.push(today);
  }
  state.completedDays = state.completedDays.slice(-120);
  state.streak = computeStreak();
  persistState();
  refreshUI();
  el.doneStatus.textContent = "Rutina completada para hoy.";
  el.doneStatus.classList.remove("error");
}

function resetBreathDisplay() {
  el.breathStage.textContent = "Listo para empezar";
  el.breathCounter.textContent = "00";
}

function tickBreath() {
  if (secondsLeft <= 0) {
    breathIndex = (breathIndex + 1) % breathSteps.length;
    secondsLeft = 4;
  }
  el.breathStage.textContent = breathSteps[breathIndex];
  el.breathCounter.textContent = String(secondsLeft).padStart(2, "0");
  secondsLeft -= 1;
}

function startBreath() {
  if (breathInterval) return;
  breathIndex = 0;
  secondsLeft = 4;
  tickBreath();
  breathInterval = setInterval(tickBreath, 1000);
}

function stopBreath() {
  if (breathInterval) {
    clearInterval(breathInterval);
    breathInterval = null;
  }
  resetBreathDisplay();
}

function bindEvents() {
  el.saveIntentionBtn.addEventListener("click", saveIntention);
  el.addAffirmationBtn.addEventListener("click", addAffirmation);
  el.saveJournalBtn.addEventListener("click", saveJournal);
  el.markDoneBtn.addEventListener("click", markDone);
  el.startBreathBtn.addEventListener("click", startBreath);
  el.stopBreathBtn.addEventListener("click", stopBreath);
}

function init() {
  loadState();
  state.streak = computeStreak();
  refreshUI();
  bindEvents();
}

init();
