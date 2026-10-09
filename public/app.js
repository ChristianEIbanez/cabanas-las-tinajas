const $ = (s) => document.querySelector(s);
const content = $("#content");
let cabins = [],
  settings = {},
  clients = [];
let currentView = "dashboard";
let calendarOffset = 0; // desplazamiento en días desde el inicio de la semana actual
let calendarReservations = [];
let calendarStripGesture = null;
let suppressCalendarChipClickUntil = 0;
const colors = ["green", "blue", "yellow", "pink"];
function getNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 1;

  const startDate = checkIn.slice(0, 10);
  const endDate = checkOut.slice(0, 10);

  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);

  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);

  return Math.max(
    1,
    Math.round((end - start) / (1000 * 60 * 60 * 24)),
  );
}

async function api(url, opts) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) {
    let e = {};
    try {
      e = await r.json();
    } catch {}
    throw new Error(e.error || "Error");
  }
  return r.status === 204 ? null : r.json();
}
async function init() {
  setupCalendarDateStripInteractions();
  cabins = await api("/api/cabins");
  settings = await api("/api/settings");
  clients = await api("/api/clients");
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => go(b.dataset.view)));
  go("dashboard");
}
function go(v) {
  currentView = v;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  const names = {
    dashboard: ["Inicio", "Panel de gestión de Cabañas Las Tinajas"],
    calendar: ["Calendario de reservas", "Disponibilidad de las 10 cabañas"],
    reservations: ["Reservas", "Gestioná entradas, salidas y huéspedes"],
    cabins: ["Cabañas", "Capacidades y distribución de camas"],
    clients: ["Clientes", "Historial de huéspedes registrados"],
    payments: ["Pagos", "Señas y pagos asociados a reservas"],
    blocks: ["Bloqueos", "Mantenimiento o indisponibilidad"],
    settings: ["Configuración", "Datos generales del establecimiento"],
  };
  $("#pageTitle").textContent = names[v][0];
  $("#pageSub").textContent = names[v][1];
  ({
    dashboard: renderDashboard,
    calendar: renderCalendar,
    reservations: renderReservations,
    cabins: renderCabins,
    clients: renderClients,
    payments: renderPayments,
    blocks: renderBlocks,
    settings: renderSettings,
  })[v]();
}
async function renderDashboard() {
  const d = await api("/api/dashboard");
  const rs = await api("/api/reservations");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rs
    .filter((r) => r.status !== "cancelada" && r.checkIn.slice(0, 10) >= today)
    .slice(0, 7);
  content.innerHTML = `<div class="content"><div class="grid kpis"><div class="card kpi"><div class="label">CABAÑAS OCUPADAS AHORA</div><div class="value">${d.occupiedNow} / 10</div><div class="hint">${d.availableNow} disponibles</div></div><div class="card kpi"><div class="label">ENTRADAS HOY</div><div class="value">${d.arrivalsToday}</div><div class="hint">Check-in desde ${settings.checkIn} hs</div></div><div class="card kpi"><div class="label">SALIDAS HOY</div><div class="value">${d.departuresToday}</div><div class="hint">Check-out hasta ${settings.checkOut} hs</div></div><div class="card kpi"><div class="label">RESERVAS PENDIENTES</div><div class="value">${d.pending}</div><div class="hint">Para confirmar</div></div></div><div class="grid two"><div class="card"><div class="section-title">Próximas reservas</div>${upcoming.length ? `<table class="table"><thead><tr><th>Cliente</th><th>Cabaña</th><th>Entrada</th><th>Salida</th><th>Personas</th><th>Estado</th></tr></thead><tbody>${upcoming.map((r) => `<tr><td><b>${esc(r.clientName)}</b><br><small>${esc(r.phone || "")}</small></td><td>Cabaña ${r.cabinId}</td><td>${fmtDate(r.checkIn)}</td><td>${fmtDate(r.checkOut)}</td><td>${r.guests}</td><td><span class="pill ${r.status}">${r.status}</span></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No hay próximas reservas.</div>'}</div><div class="card"><div class="section-title">Resumen</div><div class="stat-list"><div class="stat"><span>Capacidad total</span><b>52 personas</b></div><div class="stat"><span>Precio informado</span><b>$${money(settings.pricePerPerson)} / persona</b></div><div class="stat"><span>Recepción</span><b>Cabaña 5</b></div><div class="stat"><span>Responsable</span><b>${esc(settings.owner)}</b></div></div><div class="note" style="margin-top:16px">El check-out es siempre a las 10:00 y el check-in a las 11:00. El sistema aplica estos horarios automáticamente.</div></div></div></div>`;
}
function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + calendarOffset);
  return d;
}
function calendarDays() {
  const start = weekStart();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}
function calendarFocusDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + calendarOffset);
  return d;
}
function calendarNavStripHtml(days) {
  const focusKey = localDateKey(calendarFocusDate());
  const todayKey = localDateKey(new Date());
  const monthLabel = calendarFocusDate().toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return `<div class="calendar-date-strip" aria-label="Días visibles">${days.map((d) => {
    const key = localDateKey(d);
    const isFocus = key === focusKey;
    const isToday = key === todayKey;
    return `<button type="button" class="calendar-date-chip ${isFocus ? "is-focus" : ""} ${isToday ? "is-today" : ""}" data-calendar-date="${key}" aria-label="Ir al ${d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}" ${isFocus ? 'aria-current="date"' : ""} title="Tocá para ir a esta fecha o mantené pulsado y arrastrá para navegar">
      <span class="calendar-chip-weekday">${["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][d.getDay()]}</span>
      <strong>${d.getDate()}</strong>
      <span class="calendar-chip-month">${d.toLocaleDateString("es-AR", { month: "short" }).replace(".", "")}</span>
      ${isToday ? '<span class="calendar-chip-today">HOY</span>' : '<span class="calendar-chip-marker" aria-hidden="true"></span>'}
    </button>`;
  }).join("")}</div><div class="calendar-focus-caption"><span class="calendar-focus-dot"></span><span>Referencia: <strong>${calendarFocusDate().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}</strong></span><span class="calendar-focus-month">${monthLabel}</span></div>`;
}
function updateCalendarSliderVisual() {
  const slider = document.querySelector(".day-slider");
  if (!slider) return;
  const min = Number(slider.min || -90);
  const max = Number(slider.max || 90);
  const value = Number(slider.value);
  const percent = ((value - min) / (max - min)) * 100;
  slider.style.setProperty("--slider-progress", `${percent}%`);
}
function calendarGridHtml(days, rs) {
  const start = days[0];
  const labels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const todayKey = localDateKey(new Date());
  const focusKey = localDateKey(calendarFocusDate());
  const rows = cabins.map((c) => {
    const reservations = rs.filter((r) => r.cabinId === c.id && r.status !== "cancelada");
    const bookings = reservations.map((r, index) => {
      const checkIn = new Date(r.checkIn);
      const checkOut = new Date(r.checkOut);
      const visibleStart = checkIn < start ? start : checkIn;
      const weekEnd = new Date(start);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const visibleEnd = checkOut > weekEnd ? weekEnd : checkOut;
      if (visibleEnd <= start || visibleStart >= weekEnd) return "";
      const left = ((visibleStart - start) / weekMs) * 100;
      const width = ((visibleEnd - visibleStart) / weekMs) * 100;
      const col = colors[index % colors.length];
      return `<div class="booking ${col}" style="left:${left}%;width:${width}%" onclick="editReservation('${r.id}')" title="${esc(r.clientName)}"><strong>${esc(r.clientName)}</strong><small>${r.guests} pers. · entrada 11:00 / salida 10:00</small></div>`;
    }).join("");
    return `<div class="cal-row"><div class="cal-name">Cabaña ${c.id}<small>${c.capacity} personas</small></div><div class="calendar-track">${days.map((d) => {
      const key = localDateKey(d);
      return `<div class="day ${key === todayKey ? "today" : ""} ${key === focusKey ? "focus-day" : ""}"></div>`;
    }).join("")}${bookings}</div></div>`;
  }).join("");
  return `<div class="cal"><div class="cal-head"><div>Cabaña</div>${days.map((d) => {
    const key = localDateKey(d);
    return `<div class="${key === todayKey ? "today-head" : ""} ${key === focusKey ? "focus-head" : ""}">${labels[d.getDay()]}<br><strong>${d.getDate()}</strong> ${d.toLocaleDateString("es-AR", { month: "short" })}${key === todayKey ? '<span class="today-tag">HOY</span>' : key === focusKey ? '<span class="focus-tag">VISTA</span>' : ""}</div>`;
  }).join("")}</div>${rows}</div>`;
}
function clampCalendarOffset(value) {
  return Math.max(-90, Math.min(90, Number(value) || 0));
}
function animateCalendarTransition(direction) {
  const className = direction >= 0 ? "calendar-slide-forward" : "calendar-slide-backward";
  [document.querySelector(".calendar-date-strip-wrap"), document.querySelector(".calendar-grid-container")].forEach((element) => {
    if (!element) return;
    element.classList.remove("calendar-slide-forward", "calendar-slide-backward");
    // Force reflow so consecutive navigations replay the transition.
    void element.offsetWidth;
    element.classList.add(className);
    element.addEventListener("animationend", () => element.classList.remove(className), { once: true });
  });
}
function refreshCalendarGrid(options = {}) {
  if (currentView !== "calendar") return;
  calendarOffset = clampCalendarOffset(calendarOffset);
  const days = calendarDays();
  const title = document.querySelector(".calendar-toolbar .calendar-date-range");
  if (title) title.textContent = `${dateLabel(days[0])} – ${dateLabel(days[6])}`;
  const grid = document.querySelector(".calendar-grid-container");
  if (grid) grid.innerHTML = calendarGridHtml(days, calendarReservations);
  const strip = document.querySelector(".calendar-date-strip-wrap");
  if (strip) strip.innerHTML = calendarNavStripHtml(days);
  const label = document.querySelector(".day-offset-label");
  if (label) label.textContent = calendarOffset === 0 ? "Semana actual" : `${calendarOffset > 0 ? "+" : ""}${calendarOffset} ${Math.abs(calendarOffset) === 1 ? "día" : "días"}`;
  const hint = document.querySelector(".calendar-slider-hint");
  if (hint) hint.textContent = calendarOffset === 0 ? "Estás en la semana actual" : `Vista desplazada ${Math.abs(calendarOffset)} ${Math.abs(calendarOffset) === 1 ? "día" : "días"}`;
  const slider = document.querySelector(".day-slider");
  if (slider) slider.value = String(calendarOffset);
  updateCalendarSliderVisual();
  if (options.animate && options.direction) animateCalendarTransition(options.direction);
}
function calendarOffsetForDate(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = localDateKey(new Date()).split("-").map(Number);
  const selected = Date.UTC(year, month - 1, day);
  const today = Date.UTC(todayYear, todayMonth - 1, todayDay);
  return clampCalendarOffset(Math.round((selected - today) / 86400000));
}
function navigateCalendarToDate(dateKey) {
  const nextOffset = calendarOffsetForDate(dateKey);
  if (nextOffset === calendarOffset) return;
  const direction = nextOffset > calendarOffset ? 1 : -1;
  calendarOffset = nextOffset;
  refreshCalendarGrid({ animate: true, direction });
}
function navigateCalendarBy(days) {
  const nextOffset = clampCalendarOffset(calendarOffset + days);
  if (nextOffset === calendarOffset) return;
  const direction = nextOffset > calendarOffset ? 1 : -1;
  calendarOffset = nextOffset;
  refreshCalendarGrid({ animate: true, direction });
}
function setupCalendarDateStripInteractions() {
  if (content.dataset.calendarDateInteractions === "ready") return;
  content.dataset.calendarDateInteractions = "ready";

  content.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-calendar-date]");
    if (!chip) return;
    if (Date.now() < suppressCalendarChipClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    navigateCalendarToDate(chip.dataset.calendarDate);
  });

  content.addEventListener("pointerdown", (event) => {
    const chip = event.target.closest("[data-calendar-date]");
    if (!chip || (event.pointerType === "mouse" && event.button !== 0)) return;
    const strip = chip.closest(".calendar-date-strip");
    if (!strip) return;
    const style = getComputedStyle(strip);
    const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
    calendarStripGesture = {
      startX: event.clientX,
      startY: event.clientY,
      startOffset: calendarOffset,
      dateKey: chip.dataset.calendarDate,
      stepWidth: chip.getBoundingClientRect().width + gap,
      pointerId: event.pointerId,
      dragging: false,
    };
  });

  window.addEventListener("pointermove", (event) => {
    const gesture = calendarStripGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.dragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      gesture.dragging = true;
      document.documentElement.classList.add("calendar-strip-dragging");
    }
    event.preventDefault();
    const dayDelta = Math.round(-dx / Math.max(gesture.stepWidth, 1));
    const nextOffset = clampCalendarOffset(gesture.startOffset + dayDelta);
    if (nextOffset !== calendarOffset) {
      calendarOffset = nextOffset;
      refreshCalendarGrid();
    }
  }, { passive: false });

  const finishGesture = (event) => {
    if (!calendarStripGesture || (event && event.pointerId !== calendarStripGesture.pointerId)) return;
    if (calendarStripGesture.dragging) suppressCalendarChipClickUntil = Date.now() + 450;
    calendarStripGesture = null;
    document.documentElement.classList.remove("calendar-strip-dragging");
  };
  window.addEventListener("pointerup", finishGesture);
  window.addEventListener("pointercancel", finishGesture);
}
async function renderCalendar() {
  calendarReservations = await api("/api/reservations");
  const days = calendarDays();
  const offsetClamped = Math.max(-90, Math.min(90, calendarOffset));
  content.innerHTML = `<div class="content">
    <div class="toolbar calendar-toolbar">
      <div class="actions"><button class="secondary" aria-label="Semana anterior" title="Semana anterior" onclick="navigateCalendarBy(-7)">‹</button><button class="secondary" onclick="navigateCalendarBy(-calendarOffset)">Hoy</button><button class="secondary" aria-label="Semana siguiente" title="Semana siguiente" onclick="navigateCalendarBy(7)">›</button></div>
      <b class="calendar-date-range">${dateLabel(days[0])} – ${dateLabel(days[6])}</b>
      <button class="primary" onclick="newReservation()">＋ Nueva reserva</button>
    </div>
    <div class="card calendar-day-nav">
      <div class="calendar-day-nav-head">
        <div class="calendar-nav-title"><span class="calendar-nav-icon">↔</span><div><b>Explorar fechas</b><small>Arrastrá el control para recorrer el calendario día por día. Las flechas de arriba siguen cambiando semanas completas.</small></div></div>
        <span class="day-offset-label">${calendarOffset === 0 ? "Semana actual" : `${calendarOffset > 0 ? "+" : ""}${calendarOffset} ${Math.abs(calendarOffset) === 1 ? "día" : "días"}`}</span>
      </div>
      <div class="calendar-date-strip-wrap">${calendarNavStripHtml(days)}</div>
      <div class="calendar-slider-wrap">
        <div class="calendar-slider-caption"><span><span class="slider-caption-dot"></span>Desplazamiento diario</span><strong class="calendar-slider-hint">${calendarOffset === 0 ? "Estás en la semana actual" : `Vista desplazada ${Math.abs(calendarOffset)} ${Math.abs(calendarOffset) === 1 ? "día" : "días"}`}</strong></div>
        <input class="day-slider" type="range" min="-90" max="90" step="1" value="${offsetClamped}" aria-label="Desplazar calendario por días" oninput="calendarOffset=Number(this.value);refreshCalendarGrid()">
        <div class="day-slider-labels"><span><b>−90 días</b><small>Anterior</small></span><span class="slider-today-label" onclick="navigateCalendarBy(-calendarOffset)"><b>Hoy</b><small>Volver al presente</small></span><span><b>+90 días</b><small>Más adelante</small></span></div>
      </div>
    </div>
    <div class="card calendar-wrap"><div class="calendar-grid-container">${calendarGridHtml(days, calendarReservations)}</div></div>
    <div class="card calendar-fixed-times" style="margin-top:16px"><span class="fixed-time-icon">✓</span><div><b>Horarios fijos</b><small>Check-out 10:00 · Check-in 11:00. El sistema los aplica automáticamente.</small></div></div>
  </div>`;
  updateCalendarSliderVisual();
}
async function renderReservations() {
  const rs = await api("/api/reservations");
  content.innerHTML = `<div class="content"><div class="toolbar"><input id="search" placeholder="Buscar cliente o teléfono…" oninput="filterReservations()"><button class="primary" onclick="newReservation()">＋ Nueva reserva</button></div><div class="card"><table class="table"><thead><tr><th>Cliente</th><th>Cabaña</th><th>Entrada</th><th>Salida</th><th>Personas</th><th>Seña</th><th>Estado</th><th></th></tr></thead><tbody id="reservationRows">${rs.map((r) => reservationRow(r)).join("")}</tbody></table></div></div>`;
}
function reservationRow(r) {
  return `<tr data-search="${esc((r.clientName + " " + (r.phone || "")).toLowerCase())}"><td><b>${esc(r.clientName)}</b><br><small>${esc(r.phone || "")}</small></td><td>${r.cabinId}</td><td>${fmtDate(r.checkIn)}</td><td>${fmtDate(r.checkOut)}</td><td>${r.guests}</td><td>$${money(r.deposit || 0)}</td><td><span class="pill ${r.status}">${r.status}</span></td><td><div class="actions"><button class="small-btn" onclick="editReservation('${r.id}')">Editar</button><button class="small-btn danger" onclick="deleteReservation('${r.id}')">Eliminar</button></div></td></tr>`;
}
function filterReservations() {
  const q = $("#search").value.toLowerCase();
  document
    .querySelectorAll("#reservationRows tr")
    .forEach(
      (tr) => (tr.style.display = tr.dataset.search.includes(q) ? "" : "none"),
    );
}
async function renderCabins() {
  content.innerHTML = `<div class="content"><div class="grid cabins">${cabins.map((c) => `<div class="card cabin-card"><div class="cabin-number">Cabaña ${c.id}</div><div class="capacity">Hasta ${c.capacity} personas</div><div class="beds">${c.rooms.map((x) => `<div class="bed-row"><b>${esc(x.name)}</b><br>${esc(x.beds)}</div>`).join("")}</div><small>✓ Cochera privada · ✓ WiFi · ✓ Ropa blanca · ✓ Pileta termal · ✓ Asador</small></div>`).join("")}</div><div class="note" style="margin-top:18px"><b>Cabaña 5:</b> recepción. No está disponible para reservas. Capacidad total del complejo: 52 personas.</div></div>`;
}
async function renderClients() {
  clients = await api("/api/clients");
  const reservations = await api("/api/reservations");
  const enriched = clients.map((c) => {
    const rs = reservations.filter((r) => r.clientId === c.id || String(r.clientName).toLowerCase() === String(c.name).toLowerCase());
    return { ...c, count: rs.length, last: rs.reduce((max, r) => r.checkIn > max ? r.checkIn : max, "") };
  });
  content.innerHTML = `<div class="content"><div class="toolbar"><span>Guardá los datos de cada cliente una sola vez para reutilizarlos en futuras reservas.</span><button class="primary" onclick="newClient()">＋ Nuevo cliente</button></div><div class="card"><table class="table"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Dirección</th><th>Mail</th><th>Reservas</th><th>Última estadía</th></tr></thead><tbody>${enriched.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || "")}</td><td>${esc(c.address || "")}</td><td>${esc(c.email || "")}</td><td>${c.count}</td><td>${c.last ? fmtDate(c.last) : "-"}</td></tr>`).join("")}</tbody></table>${enriched.length ? "" : '<div class="empty">No hay clientes registrados.</div>'}</div></div>`;
}
async function newClient() {
  modal(`<div class="modal-head"><div><h2>Nuevo cliente</h2><small>Estos datos quedarán guardados para futuras reservas.</small></div><button class="icon-btn" onclick="closeModal()">×</button></div><form class="form" onsubmit="saveClient(event)"><div class="field full"><label>Nombre</label><input name="name" required></div><div class="field"><label>Teléfono</label><input name="phone"></div><div class="field"><label>Mail</label><input type="email" name="email"></div><div class="field full"><label>Dirección</label><input name="address"></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">Guardar cliente</button></div></form>`);
}
async function saveClient(e) {
  e.preventDefault();

  const body = Object.fromEntries(new FormData(e.target).entries());

  try {
    await api("/api/clients", {
      method: "POST",
      body: JSON.stringify(body),
    });

    clients = await api("/api/clients");

    closeModal();
    renderClients();
  } catch (err) {
    alert(err.message);
  }
}
function reservationBaseTotal(reservation, settings = {}) {
  if (reservation.total != null) return Number(reservation.total || 0);
  const nights = getNights(reservation.checkIn, reservation.checkOut);
  return (Number(reservation.adults ?? reservation.guests ?? 0) * Number(reservation.adultPricePerPerson ?? settings.pricePerPerson ?? 0) + Number(reservation.children || 0) * Number(reservation.childPricePerPerson ?? settings.childPricePerPerson ?? 0)) * nights;
}
function extrasTotal(reservation) {
  return (reservation.extraCharges || []).reduce((sum, extra) => sum + Number(extra.amount || 0), 0);
}
function paidExtrasTotal(reservation) {
  return (reservation.extraCharges || []).filter((extra) => extra.status === "paid").reduce((sum, extra) => sum + Number(extra.amount || 0), 0);
}
async function renderPayments() {
  activePaymentFilter = "all";
  const [reservations, payments, currentSettings] = await Promise.all([
    api("/api/reservations"),
    api("/api/payments"),
    api("/api/settings"),
  ]);
  const activeReservations = reservations.filter((r) => r.status !== "cancelada");
  const getTotal = (r) => reservationBaseTotal(r, currentSettings) + extrasTotal(r);
  const getPaid = (r) => {
    const recordedPayments = payments
      .filter((p) => p.reservationId === r.id)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    // If the reservation's deposit was entered directly, count it without double-counting
    // when the same deposit is also present in the payments ledger.
    return Math.max(recordedPayments, Number(r.deposit || 0)) + paidExtrasTotal(r);
  };
  const rows = activeReservations.map((r) => {
    const total = getTotal(r);
    const paid = getPaid(r);
    return { r, total, paid, balance: Math.max(0, total - paid) };
  });
  const pendingRows = rows
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance - a.balance || a.r.checkIn.localeCompare(b.r.checkIn));
  const settledRows = rows
    .filter((x) => x.balance <= 0)
    .sort((a, b) => b.r.checkIn.localeCompare(a.r.checkIn));
  const totalExpected = rows.reduce((sum, x) => sum + x.total, 0);
  const totalPaid = rows.reduce((sum, x) => sum + x.paid, 0);
  const totalBalance = pendingRows.reduce((sum, x) => sum + x.balance, 0);
  const rowHtml = ({ r, total, paid, balance }) => {
    const paidPercent = total > 0 ? Math.max(0, Math.min(100, Math.round((paid / total) * 100))) : 0;
    const paymentState = balance <= 0 ? "settled" : paid > 0 ? "partial" : "unpaid";
    return `
    <tr data-payment-search="${esc(`${r.clientName || ""} ${r.phone || ""} Cabaña ${r.cabinId}`.toLowerCase())}" data-payment-state="${paymentState}" data-payment-balance="${balance}">
      <td class="payment-client-cell"><b>${esc(r.clientName)}</b><br><small>${esc(r.phone || "Sin teléfono")}</small></td>
      <td><span class="payment-cabin-badge"><span class="payment-cabin-icon">⌂</span><span><small>CABAÑA</small><strong>${esc(r.cabinId)}</strong></span></span></td>
      <td class="payment-stay-cell"><span>${fmtDate(r.checkIn)}</span><small>hasta ${fmtDate(r.checkOut)}</small></td>
      <td class="payment-money-cell">$${money(total)}</td>
      <td class="payment-paid-cell"><strong>$${money(paid)}</strong><span class="payment-progress"><i style="width:${paidPercent}%"></i></span><small>${paidPercent}% abonado</small></td>
      <td><span class="payment-balance-pill ${balance <= 0 ? "is-settled" : ""}">$${money(balance)}</span></td>
      <td><div class="actions payment-actions"><button class="small-btn" onclick="manageExtras('${r.id}')">Ver extras</button><button class="small-btn" onclick="downloadReservationTicket('${r.id}')" title="Descargar detalle de estadía en PDF">Ticket PDF</button>${balance > 0 ? `<button class="small-btn primary" onclick="addPayment('${r.id}')">Registrar pago</button>` : '<span class="pill confirmada">Saldado</span>'}</div></td>
    </tr>`;
  };
  content.innerHTML = `
    <div class="content">
      <div class="grid kpis payment-kpis">
        <div class="card kpi"><div class="label">TOTAL A COBRAR</div><div class="value">$${money(totalExpected)}</div><div class="hint">Alojamiento + extras</div></div>
        <div class="card kpi"><div class="label">TOTAL COBRADO</div><div class="value">$${money(totalPaid)}</div><div class="hint">Incluye señas y extras cobrados</div></div>
        <div class="card kpi payment-due-kpi"><div class="label">SALDO PENDIENTE</div><div class="value">$${money(totalBalance)}</div><div class="hint">${pendingRows.length} reserva(s) con deuda</div></div>
      </div>
      <div class="toolbar payments-toolbar" style="margin-top:22px">
        <div><h2 style="margin:0 0 4px;font-size:20px">Control de pagos</h2><span class="muted-text">Las deudas más altas aparecen primero.</span></div>
        <input id="paymentSearch" placeholder="Buscar cliente, teléfono o cabaña…" oninput="filterPaymentRows()" aria-label="Buscar pagos por cliente, teléfono o cabaña">
      </div>
      <div class="payment-filter-row" role="group" aria-label="Filtrar reservas por estado de pago">
        <button class="payment-filter active" data-filter="all" onclick="setPaymentFilter('all',this)">Todas <span>${rows.length}</span></button>
        <button class="payment-filter" data-filter="unpaid" onclick="setPaymentFilter('unpaid',this)">Sin pagos <span>${rows.filter(x => x.paid <= 0 && x.balance > 0).length}</span></button>
        <button class="payment-filter" data-filter="partial" onclick="setPaymentFilter('partial',this)">Pago parcial <span>${rows.filter(x => x.paid > 0 && x.balance > 0).length}</span></button>
        <button class="payment-filter" data-filter="settled" onclick="setPaymentFilter('settled',this)">Saldadas <span>${settledRows.length}</span></button>
      </div>
      <div class="card payment-section pending-payment-section">
        <div class="payment-section-heading"><div><span class="payment-status-dot"></span><b>${pendingRows.length} reserva(s) pendientes</b></div><strong>$${money(totalBalance)} por cobrar</strong></div>
        ${pendingRows.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Cliente</th><th>Cabaña</th><th>Estadía</th><th>Total final</th><th>Pagado</th><th>Debe</th><th>Acciones</th></tr></thead><tbody id="pendingPaymentRows">${pendingRows.map(rowHtml).join("")}</tbody></table></div>` : '<div class="empty payment-empty">¡Excelente! No hay reservas con saldo pendiente.</div>'}
      </div>
      <div class="card payment-section settled-payment-section" style="margin-top:18px">
        <div class="payment-section-heading"><div><span class="payment-status-dot settled-dot"></span><b>Reservas saldadas</b></div><strong>${settledRows.length} reserva(s)</strong></div>
        ${settledRows.length ? `<div class="table-scroll"><table class="table"><thead><tr><th>Cliente</th><th>Cabaña</th><th>Estadía</th><th>Total final</th><th>Pagado</th><th>Saldo</th><th>Acciones</th></tr></thead><tbody id="settledPaymentRows">${settledRows.map(rowHtml).join("")}</tbody></table></div>` : '<div class="empty payment-empty">Todavía no hay reservas completamente pagadas.</div>'}
      </div>
    </div>`;
}
function downloadReservationTicket(reservationId) {
  // La ruta genera el PDF en el servidor y responde como archivo adjunto.
  // La sesión existente viaja en la cookie HttpOnly del mismo origen.
  window.location.href = `/api/reservations/${encodeURIComponent(reservationId)}/ticket.pdf`;
}
let activePaymentFilter = "all";
function setPaymentFilter(filter, button) {
  activePaymentFilter = filter;
  document.querySelectorAll(".payment-filter").forEach((item) => item.classList.toggle("active", item === button));
  filterPaymentRows();
}
function filterPaymentRows() {
  const query = String(document.querySelector("#paymentSearch")?.value || "").trim().toLowerCase();
  document.querySelectorAll("[data-payment-search]").forEach((row) => {
    const matchesQuery = row.dataset.paymentSearch.includes(query);
    const matchesFilter = activePaymentFilter === "all" || row.dataset.paymentState === activePaymentFilter;
    row.style.display = matchesQuery && matchesFilter ? "" : "none";
  });
}
async function addPayment(reservationId) {
  const [reservations, payments, currentSettings] = await Promise.all([api("/api/reservations"), api("/api/payments"), api("/api/settings")]);
  const reservation = reservations.find((r) => r.id === reservationId);
  if (!reservation) return alert("No se encontró la reserva.");
  const paymentSum = payments.filter((p) => p.reservationId === reservationId).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paid = Math.max(paymentSum, Number(reservation.deposit || 0)) + paidExtrasTotal(reservation);
  const total = reservationBaseTotal(reservation, currentSettings) + extrasTotal(reservation);
  const balance = Math.max(0, total - paid);
  modal(`<div class="modal-head"><div><h2>Registrar pago</h2><small>${esc(reservation.clientName)} · Cabaña ${reservation.cabinId}</small></div><button class="icon-btn" onclick="closeModal()">×</button></div><div class="card" style="margin-bottom:16px"><div class="economic-line"><span>Alojamiento</span><b>$${money(reservationBaseTotal(reservation, currentSettings))}</b></div><div class="economic-line"><span>Gastos extras</span><b>$${money(extrasTotal(reservation))}</b></div><div class="economic-line"><span>Total final</span><strong>$${money(total)}</strong></div><div class="economic-line"><span>Pagado (incluye extras cobrados)</span><b>$${money(paid)}</b></div><div class="economic-line"><span>Saldo pendiente</span><b>$${money(balance)}</b></div></div><form class="form" onsubmit="savePayment(event,'${reservationId}')"><div class="field full"><label>Monto</label><input type="number" name="amount" min="1" max="${balance}" required value="${balance > 0 ? balance : 0}"></div><div class="field full"><label>Concepto</label><select name="concept"><option>Seña</option><option>Pago parcial</option><option>Pago final</option></select></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary" ${balance <= 0 ? "disabled" : ""}>Registrar pago</button></div></form>`);
}
async function manageExtras(reservationId) {
  const reservations = await api("/api/reservations");
  const currentSettings = await api("/api/settings");
  const r = reservations.find((x) => x.id === reservationId);
  if (!r) return alert("No se encontró la reserva.");
  const extras = r.extraCharges || [];
  const base = reservationBaseTotal(r, currentSettings);
  const extraSum = extrasTotal(r);
  const paidExtra = paidExtrasTotal(r);
  const list = extras.length ? extras.map((x) => `<div class="extra-row"><div class="extra-main"><b>${esc(x.description)}</b><small>${x.date ? fmt(x.date) : "Sin fecha"}</small><span class="pill ${x.status === "paid" ? "confirmada" : "pendiente"}">${x.status === "paid" ? "Cobrado" : "Pendiente de cobro"}</span></div><div class="extra-actions"><strong>$${money(x.amount)}</strong><button class="small-btn" onclick="toggleExtraStatus('${r.id}','${x.id}','${x.status === "paid" ? "pending" : "paid"}')">${x.status === "paid" ? "Marcar pendiente" : "Marcar cobrado"}</button><button class="small-btn danger" onclick="deleteExtra('${r.id}','${x.id}')">Eliminar</button></div></div>`).join("") : '<div class="empty compact-empty">Todavía no se cargaron gastos extras.</div>';
  modal(`<div class="modal-head"><div><h2>Gastos extras</h2><small>${esc(r.clientName)} · Cabaña ${r.cabinId}</small></div><button class="icon-btn" onclick="closeModal()">×</button></div><div class="card extra-summary"><div class="economic-line"><span>Tarifa del alojamiento</span><b>$${money(base)}</b></div><div class="economic-line"><span>Total de gastos extras</span><b>$${money(extraSum)}</b></div><div class="economic-line"><span>Extras ya cobrados</span><b>$${money(paidExtra)}</b></div><div class="economic-line total-line"><span>Total final</span><strong>$${money(base + extraSum)}</strong></div></div><div class="section-title" style="margin-top:18px">Detalle de extras</div><div class="extras-list">${list}</div><div class="section-title" style="margin-top:18px">Agregar un gasto extra</div><form class="form" onsubmit="saveExtra(event,'${r.id}')"><div class="field full"><label>Descripción</label><input name="description" required maxlength="160" placeholder="Ej.: venta de bebidas, lavandería, servicio adicional"></div><div class="field"><label>Importe ($)</label><input name="amount" type="number" min="1" step="1" required></div><div class="field"><label>Estado del cobro</label><select name="status"><option value="pending">Pendiente de cobro</option><option value="paid">Ya cobrado</option></select></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal();renderPayments()">Cerrar</button><button class="primary">Agregar extra</button></div></form>`);
}
async function saveExtra(event, reservationId) {
  event.preventDefault();
  const form = new FormData(event.target);
  const body = { description: String(form.get("description") || "").trim(), amount: Number(form.get("amount")), status: form.get("status") };
  try { await api(`/api/reservations/${reservationId}/extras`, { method: "POST", body: JSON.stringify(body) }); await manageExtras(reservationId); } catch (error) { alert(error.message); }
}
async function toggleExtraStatus(reservationId, extraId, status) {
  try { await api(`/api/reservations/${reservationId}/extras/${extraId}`, { method: "PUT", body: JSON.stringify({ status }) }); await manageExtras(reservationId); } catch (error) { alert(error.message); }
}
async function deleteExtra(reservationId, extraId) {
  if (!confirm("¿Eliminar este gasto extra? El total de la reserva se actualizará.")) return;
  try { await api(`/api/reservations/${reservationId}/extras/${extraId}`, { method: "DELETE" }); await manageExtras(reservationId); } catch (error) { alert(error.message); }
}
async function savePayment(event, reservationId) {
  event.preventDefault();

  const form = new FormData(event.target);

  const body = {
    reservationId,
    amount: Number(form.get("amount")),
    concept: form.get("concept"),
  };

  try {
    await api("/api/payments", {
      method: "POST",
      body: JSON.stringify(body),
    });

    closeModal();
    go("payments");
  } catch (error) {
    alert(error.message);
  }
}
async function renderBlocks() {
  const bs = await api("/api/blocks");
  content.innerHTML = `<div class="content"><div class="toolbar"><span>Bloqueá una cabaña por mantenimiento, uso interno u otro motivo.</span><button class="primary" onclick="newBlock()">＋ Nuevo bloqueo</button></div><div class="card"><table class="table"><thead><tr><th>Cabaña</th><th>Desde</th><th>Hasta</th><th>Motivo</th><th></th></tr></thead><tbody>${bs
    .map(
      (
        b,
      ) => `<tr><td>${b.cabinId}</td><td>${fmt(b.start)}</td><td>${fmt(b.end)}</td><td>${esc(b.reason || "Sin motivo")}</td><td><button
  class="small-btn"
  onclick="editBlock('${b.id}')"
>
  Editar
</button>

<button
  class="small-btn danger"
  onclick="deleteBlock('${b.id}')"
>
  Eliminar
</button></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table>${bs.length ? "" : '<div class="empty">No hay bloqueos.</div>'}</div></div>`;
}
async function renderSettings() {
  content.innerHTML = `<div class="content"><div class="card"><div class="section-title">Datos del establecimiento</div><form class="form" onsubmit="saveSettings(event)"><div class="field"><label>Nombre</label><input name="business" value="${esc(settings.business)}"></div><div class="field"><label>Responsable / dueño</label><input name="owner" value="${esc(settings.owner)}"></div><div class="field"><label>Teléfono de reservas</label><input name="phone" value="${esc(settings.phone)}"></div><div class="field"><label>Precio adulto</label><input type="number" name="pricePerPerson" value="${settings.pricePerPerson}"></div><div class="field"><label>Precio niño</label><input type="number" name="childPricePerPerson" value="${settings.childPricePerPerson || 0}"></div><div class="field full"><div class="note"><b>Horarios fijos de estadía</b><br>Check-in: 11:00 · Check-out: 10:00. Estos horarios son automáticos y no se modifican por reserva.</div></div><div class="form-actions"><button class="primary">Guardar cambios</button></div></form></div></div>`;
}
function modal(html) {
  $("#modal").innerHTML = `<div class="modal-box">${html}</div>`;
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
}
async function newReservation(existing = null) {
  const r = existing;
  const reservations = await api("/api/reservations");
  const blocks = await api("/api/blocks");
  clients = await api("/api/clients");
  const initialClient = r ? clients.find((c) => c.id === r.clientId) : null;
  const initialItems = r ? [{ cabinId: r.cabinId, adults: r.adults ?? r.guests ?? 1, children: r.children ?? 0, adultPricePerPerson: r.adultPricePerPerson ?? settings.pricePerPerson, childPricePerPerson: r.childPricePerPerson ?? settings.childPricePerPerson ?? 0, deposit: r.deposit ?? 0, notes: r.notes ?? "" }] : [{ cabinId: cabins[0]?.id, adults: 2, children: 0, adultPricePerPerson: settings.pricePerPerson, childPricePerPerson: settings.childPricePerPerson || 0, deposit: 0, notes: "" }];

  const cabinOptions = (selected) => cabins.map((c) => `<option value="${c.id}" ${Number(selected) === c.id ? "selected" : ""}>Cabaña ${c.id} · hasta ${c.capacity} personas</option>`).join("");
  const itemHtml = (item, index) => `<div class="card reservation-cabin-item" data-index="${index}" style="margin-top:12px;padding:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b>Cabaña <span class="cabin-label">${item.cabinId || ""}</span></b>${index ? `<button type="button" class="small-btn danger remove-cabin" data-index="${index}">Quitar</button>` : ""}</div><div class="form" style="margin-top:12px"><div class="field"><label>Cabaña</label><select name="cabinId">${cabinOptions(item.cabinId)}</select></div><div class="field"><label>Adultos</label><input type="number" min="0" name="adults" value="${item.adults}"></div><div class="field"><label>Niños</label><input type="number" min="0" name="children" value="${item.children}"></div><div class="field"><label>Precio adulto</label><input type="number" min="0" name="adultPricePerPerson" value="${item.adultPricePerPerson}"></div><div class="field"><label>Precio niño</label><input type="number" min="0" name="childPricePerPerson" value="${item.childPricePerPerson}"></div><div class="field"><label>Seña</label><input type="number" min="0" name="deposit" value="${item.deposit || 0}"></div><div class="field full"><label>Notas</label><textarea name="notes">${esc(item.notes || "")}</textarea></div></div><div class="cabin-total" style="margin-top:10px;font-weight:700"></div><div class="availability-info cabin-availability"></div></div>`;

  modal(`<div class="modal-head"><div><h2>${r ? "Editar reserva" : "Nueva reserva"}</h2><small>Una misma reserva puede incluir varias cabañas.</small></div><button class="icon-btn" onclick="closeModal()">×</button></div><form id="reservationForm" class="form" onsubmit="saveReservation(event,'${r?.id || ""}')"><div class="field full"><label>Cliente</label><input id="clientSearch" list="clientList" name="clientName" required value="${esc(r?.clientName || initialClient?.name || "")}" placeholder="Buscar cliente o escribir uno nuevo"><datalist id="clientList">${clients.map((c) => `<option value="${esc(c.name)}" data-id="${c.id}">${esc(c.phone || "")}</option>`).join("")}</datalist></div><div class="field"><label>Teléfono</label><input id="clientPhone" name="phone" value="${esc(r?.phone || initialClient?.phone || "")}"></div><div class="field"><label>Mail</label><input id="clientEmail" name="email" type="email" value="${esc(r?.email || initialClient?.email || "")}"></div><div class="field full"><label>Dirección</label><input id="clientAddress" name="address" value="${esc(r?.address || initialClient?.address || "")}"></div><div class="field"><label>Fecha de entrada</label><input id="reservationCheckIn" type="date" name="checkIn" required value="${dateInputValue(r?.checkIn)}"></div><div class="field"><label>Fecha de salida</label><input id="reservationCheckOut" type="date" name="checkOut" required value="${dateInputValue(r?.checkOut)}"></div><div class="field full"><div class="note"><b>Horarios fijos:</b> check-in 11:00 · check-out 10:00. No hace falta ingresar horarios.</div></div><div class="field"><label>Estado</label><select name="status"><option ${r?.status === "confirmada" || !r ? "selected" : ""}>confirmada</option><option ${r?.status === "pendiente" ? "selected" : ""}>pendiente</option><option ${r?.status === "cancelada" ? "selected" : ""}>cancelada</option></select></div><div class="field full"><label>Cabañas de esta reserva</label><div id="reservationCabins">${initialItems.map(itemHtml).join("")}</div><button type="button" class="secondary" id="addCabin" style="margin-top:12px">＋ Agregar otra cabaña</button></div><div class="card full" style="margin-top:8px"><b>Total de la reserva:</b> <span id="reservationGrandTotal">$0</span></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">${r ? "Guardar cambios" : "Crear reserva"}</button></div></form>`);

  const cabinsBox = document.querySelector("#reservationCabins");
  const clientSearch = document.querySelector("#clientSearch");
  function fillClient() {
    const c = clients.find((x) => x.name.toLowerCase() === clientSearch.value.trim().toLowerCase());
    if (!c) return;
    $("#clientPhone").value = c.phone || ""; $("#clientEmail").value = c.email || ""; $("#clientAddress").value = c.address || "";
  }
  clientSearch.addEventListener("change", fillClient);
  clientSearch.addEventListener("blur", fillClient);

  function readItems() {
    return [...cabinsBox.querySelectorAll(".reservation-cabin-item")].map((box) => ({ cabinId: Number(box.querySelector('[name="cabinId"]').value), adults: Number(box.querySelector('[name="adults"]').value || 0), children: Number(box.querySelector('[name="children"]').value || 0), adultPricePerPerson: Number(box.querySelector('[name="adultPricePerPerson"]').value || 0), childPricePerPerson: Number(box.querySelector('[name="childPricePerPerson"]').value || 0), deposit: Number(box.querySelector('[name="deposit"]').value || 0), notes: box.querySelector('[name="notes"]').value || "" }));
  }
  function available(cabinId, checkIn, checkOut, ignoreId) {
    if (!checkIn || !checkOut) return true;
    const start = reservationDateTime(checkIn, "11:00"), end = reservationDateTime(checkOut, "10:00");
    if (!start || !end || end <= start) return false;
    return !reservations.some((x) => x.id !== ignoreId && Number(x.cabinId) === Number(cabinId) && x.status !== "cancelada" && start < new Date(x.checkOut).getTime() && new Date(x.checkIn).getTime() < end) && !blocks.some((x) => Number(x.cabinId) === Number(cabinId) && start < new Date(x.end).getTime() && new Date(x.start).getTime() < end);
  }
  function updateTotals() {
    const items = readItems();
    const checkIn = $("#reservationCheckIn").value, checkOut = $("#reservationCheckOut").value;
    const nights =
  checkIn && checkOut
    ? getNights(checkIn, checkOut)
    : 1;
    let grand = 0;
    cabinsBox.querySelectorAll(".reservation-cabin-item").forEach((box, i) => {
      const item = items[i], cabin = cabins.find((c) => c.id === item.cabinId);
      const guests = item.adults + item.children;
      const total = (item.adults * item.adultPricePerPerson + item.children * item.childPricePerPerson) * nights;
      grand += total;
      box.querySelector(".cabin-label").textContent = item.cabinId || "";
      box.querySelector(".cabin-total").textContent = `Total cabaña: $${money(total)} · ${guests} huésped${guests === 1 ? "" : "es"}`;
      const ok = cabin && guests > 0 && guests <= cabin.capacity && available(item.cabinId, checkIn, checkOut, r?.id);
      box.querySelector(".cabin-availability").innerHTML = ok ? "🟢 Disponible" : (guests > (cabin?.capacity || 0) ? `🔴 Capacidad máxima: ${cabin?.capacity || 0}` : "🔴 No disponible en ese horario");
    });
    $("#reservationGrandTotal").textContent = `$${money(grand)}`;
  }
  function bind() {
    cabinsBox.querySelectorAll("select,input,textarea").forEach((el) => el.addEventListener("input", updateTotals));
    cabinsBox.querySelectorAll(".remove-cabin").forEach((btn) => btn.addEventListener("click", () => { btn.closest(".reservation-cabin-item").remove(); updateTotals(); }));
    updateTotals();
  }
  document.querySelector("#addCabin").addEventListener("click", () => {
    const item = { cabinId: cabins.find((c) => available(c.id, $("#reservationCheckIn").value, $("#reservationCheckOut").value, r?.id))?.id || cabins[0]?.id, adults: 1, children: 0, adultPricePerPerson: settings.pricePerPerson, childPricePerPerson: settings.childPricePerPerson || 0, deposit: 0, notes: "" };
    cabinsBox.insertAdjacentHTML("beforeend", itemHtml(item, cabinsBox.children.length));
    bind();
  });
  $("#reservationCheckIn").addEventListener("input", updateTotals); $("#reservationCheckOut").addEventListener("input", updateTotals);
  bind();
}
async function saveReservation(e, id) {
  e.preventDefault();
  const f = new FormData(e.target);
  const data = Object.fromEntries(f.entries());
  const boxes = [...document.querySelectorAll("#reservationCabins .reservation-cabin-item")];
  const items = boxes.map((box) => ({ cabinId: Number(box.querySelector('[name="cabinId"]').value), adults: Number(box.querySelector('[name="adults"]').value || 0), children: Number(box.querySelector('[name="children"]').value || 0), adultPricePerPerson: Number(box.querySelector('[name="adultPricePerPerson"]').value || 0), childPricePerPerson: Number(box.querySelector('[name="childPricePerPerson"]').value || 0), deposit: Number(box.querySelector('[name="deposit"]').value || 0), notes: box.querySelector('[name="notes"]').value || "" }));
  try {
    if (id) {
      if (items.length !== 1) throw new Error("Para editar una reserva existente, modificá una cabaña por vez.");
      await api(`/api/reservations/${id}`, { method: "PUT", body: JSON.stringify({ clientName: data.clientName, phone: data.phone, email: data.email, address: data.address, checkIn: data.checkIn, checkOut: data.checkOut, status: data.status, ...items[0] }) });
    } else {
      await api("/api/reservation-groups", { method: "POST", body: JSON.stringify({ client: { name: data.clientName, phone: data.phone, email: data.email, address: data.address }, checkIn: data.checkIn, checkOut: data.checkOut, status: data.status, cabins: items }) });
    }
    closeModal(); go(currentView);
  } catch (err) { alert(err.message); }
}
async function editReservation(id) {
  const rs = await api("/api/reservations");
  const r = rs.find((x) => x.id === id);
  if (r) newReservation(r);
}
async function deleteReservation(id) {
  if (!confirm("¿Eliminar esta reserva?")) return;
  await api("/api/reservations/" + id, { method: "DELETE" });
  go(currentView);
}
async function newBlock() {
  modal(
    `<div class="modal-head"><h2>Nuevo bloqueo</h2><button class="icon-btn" onclick="closeModal()">×</button></div><form class="form" onsubmit="saveBlock(event)"><div class="field"><label>Cabaña</label><select name="cabinId">${cabins.map((c) => `<option value="${c.id}">Cabaña ${c.id}</option>`).join("")}</select></div><div class="field"><label>Motivo</label><input name="reason" placeholder="Mantenimiento"></div><div class="field"><label>Desde</label><input type="datetime-local" name="start" required></div><div class="field"><label>Hasta</label><input type="datetime-local" name="end" required></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">Bloquear</button></div></form>`,
  );
}
async function saveBlock(e) {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target).entries());
  b.cabinId = Number(b.cabinId);
  try {
    await api("/api/blocks", { method: "POST", body: JSON.stringify(b) });
    closeModal();
    renderBlocks();
  } catch (err) {
    alert(err.message);
  }
}
async function deleteBlock(id) {
  if (confirm("¿Eliminar bloqueo?")) {
    await api("/api/blocks/" + id, { method: "DELETE" });
    renderBlocks();
  }
}
async function saveSettings(e) {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target).entries());
  b.pricePerPerson = Number(b.pricePerPerson);
  b.childPricePerPerson = Number(b.childPricePerPerson || 0);
  settings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(b),
  });
  alert("Configuración guardada.");
  go("dashboard");
}
function fmtDate(s) {
  if (!s) return "-";
  return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function dateInputValue(s) {
  return s ? String(s).slice(0, 10) : "";
}
function reservationDateTime(date, time) {
  return new Date(`${date}T${time}:00-03:00`).getTime();
}
function fmt(s) {
  if (!s) return "-";
  const d = new Date(s);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtTime(s) {
  return s
    ? new Date(s).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}
function dateLabel(d) {
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function money(n) {
  return Number(n || 0).toLocaleString("es-AR");
}
function esc(s = "") {
  return String(s).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
function localInput(s) {
  if (!s) return "";
  const d = new Date(s);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function logout() {
  try { await fetch("/api/logout", { method: "POST" }); } finally { window.location.href = "/login.html"; }
}

init();

async function editBlock(id) {
  const blocks = await api("/api/blocks");
  const block = blocks.find((b) => b.id === id);

  if (!block) {
    alert("No se encontró el bloqueo.");
    return;
  }

  modal(`
    <div class="modal-head">
      <div>
        <h2>Editar bloqueo</h2>
        <small>Modificá los datos del bloqueo.</small>
      </div>

      <button
        class="icon-btn"
        onclick="closeModal()"
      >
        ×
      </button>
    </div>

    <form
      class="form"
      onsubmit="updateBlock(event, '${id}')"
    >

      <div class="field">
        <label>Cabaña</label>

        <select name="cabinId">
          ${cabins
            .map(
              (c) => `
                <option
                  value="${c.id}"
                  ${Number(block.cabinId) === c.id ? "selected" : ""}
                >
                  Cabaña ${c.id}
                </option>
              `,
            )
            .join("")}
        </select>
      </div>

      <div class="field">
        <label>Motivo</label>

        <input
          name="reason"
          value="${esc(block.reason || "")}"
          placeholder="Mantenimiento"
        >
      </div>

      <div class="field">
        <label>Desde</label>

        <input
          type="datetime-local"
          name="start"
          required
          value="${localInput(block.start)}"
        >
      </div>

      <div class="field">
        <label>Hasta</label>

        <input
          type="datetime-local"
          name="end"
          required
          value="${localInput(block.end)}"
        >
      </div>

      <div class="form-actions">

        <button
          type="button"
          class="secondary"
          onclick="closeModal()"
        >
          Cancelar
        </button>

        <button class="primary">
          Guardar cambios
        </button>

      </div>

    </form>
  `);
}

async function updateBlock(event, id) {
  event.preventDefault();

  const form = new FormData(event.target);

  const block = {
    cabinId: Number(form.get("cabinId")),
    reason: form.get("reason"),
    start: form.get("start"),
    end: form.get("end"),
  };

  try {
    await api(`/api/blocks/${id}`, {
      method: "PUT",
      body: JSON.stringify(block),
    });

    closeModal();
    renderBlocks();
  } catch (error) {
    alert(error.message);
  }
}
