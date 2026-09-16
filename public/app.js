const $ = (s) => document.querySelector(s);
const content = $("#content");
let cabins = [],
  settings = {},
  clients = [];
let currentView = "dashboard";
let calendarOffset = 0;
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
  content.innerHTML = `<div class="content"><div class="grid kpis"><div class="card kpi"><div class="label">CABAÑAS OCUPADAS AHORA</div><div class="value">${d.occupiedNow} / 10</div><div class="hint">${d.availableNow} disponibles</div></div><div class="card kpi"><div class="label">ENTRADAS HOY</div><div class="value">${d.arrivalsToday}</div><div class="hint">Check-in desde ${settings.checkIn} hs</div></div><div class="card kpi"><div class="label">SALIDAS HOY</div><div class="value">${d.departuresToday}</div><div class="hint">Check-out hasta ${settings.checkOut} hs</div></div><div class="card kpi"><div class="label">RESERVAS PENDIENTES</div><div class="value">${d.pending}</div><div class="hint">Para confirmar</div></div></div><div class="grid two"><div class="card"><div class="section-title">Próximas reservas</div>${upcoming.length ? `<table class="table"><thead><tr><th>Cliente</th><th>Cabaña</th><th>Entrada</th><th>Salida</th><th>Personas</th><th>Estado</th></tr></thead><tbody>${upcoming.map((r) => `<tr><td><b>${esc(r.clientName)}</b><br><small>${esc(r.phone || "")}</small></td><td>Cabaña ${r.cabinId}</td><td>${fmt(r.checkIn)}</td><td>${fmt(r.checkOut)}</td><td>${r.guests}</td><td><span class="pill ${r.status}">${r.status}</span></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No hay próximas reservas.</div>'}</div><div class="card"><div class="section-title">Resumen</div><div class="stat-list"><div class="stat"><span>Capacidad total</span><b>52 personas</b></div><div class="stat"><span>Precio informado</span><b>$${money(settings.pricePerPerson)} / persona</b></div><div class="stat"><span>Recepción</span><b>Cabaña 5</b></div><div class="stat"><span>Responsable</span><b>${esc(settings.owner)}</b></div></div><div class="note" style="margin-top:16px">Una salida a las ${settings.checkOut} libera la cabaña para una nueva entrada el mismo día desde las ${settings.checkIn}. El sistema controla esto automáticamente.</div></div></div></div>`;
}
function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + calendarOffset * 7);
  return d;
}
async function renderCalendar() {
  const rs = await api("/api/reservations");
  const start = weekStart();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });

  const labels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const rows = cabins
    .map((c) => {
      const reservations = rs.filter(
        (r) => r.cabinId === c.id && r.status !== "cancelada",
      );

      const bookings = reservations
        .map((r, index) => {
          const checkIn = new Date(r.checkIn);
          const checkOut = new Date(r.checkOut);

          const visibleStart = checkIn < start ? start : checkIn;

          const weekEnd = new Date(start);
          weekEnd.setDate(weekEnd.getDate() + 7);

          const visibleEnd = checkOut > weekEnd ? weekEnd : checkOut;

          if (visibleEnd <= start || visibleStart >= weekEnd) {
            return "";
          }

          const left = ((visibleStart - start) / weekMs) * 100;

          const width = ((visibleEnd - visibleStart) / weekMs) * 100;

          const col = colors[index % colors.length];

          return `
            <div
              class="booking ${col}"
              style="left:${left}%; width:${width}%"
              onclick="editReservation('${r.id}')"
              title="${esc(r.clientName)}"
            >
              <strong>${esc(r.clientName)}</strong>
              <small>
                ${r.guests} pers. ·
                ${fmtTime(r.checkIn)} →
                ${fmtTime(r.checkOut)}
              </small>
            </div>
          `;
        })
        .join("");

      return `
        <div class="cal-row">
          <div class="cal-name">
            Cabaña ${c.id}
            <small>${c.capacity} personas</small>
          </div>

          <div class="calendar-track">
            ${days
              .map(
                (d) => `
                  <div class="day ${
                    d.toISOString().slice(0, 10) ===
                    new Date().toISOString().slice(0, 10)
                      ? "today"
                      : ""
                  }"></div>
                `,
              )
              .join("")}

            ${bookings}
          </div>
        </div>
      `;
    })
    .join("");

  content.innerHTML = `
    <div class="content">

      <div class="toolbar">
        <div class="actions">
          <button
            class="secondary"
            onclick="calendarOffset--;renderCalendar()"
          >
            ‹
          </button>

          <button
            class="secondary"
            onclick="calendarOffset=0;renderCalendar()"
          >
            Hoy
          </button>

          <button
            class="secondary"
            onclick="calendarOffset++;renderCalendar()"
          >
            ›
          </button>
        </div>

        <b>
          ${dateLabel(days[0])} – ${dateLabel(days[6])}
        </b>

        <button
          class="primary"
          onclick="newReservation()"
        >
          ＋ Nueva reserva
        </button>
      </div>

      <div class="card calendar-wrap">
        <div class="cal">

          <div class="cal-head">
            <div>Cabaña</div>

            ${days
              .map(
                (d, i) => `
                  <div>
                    ${labels[i]}<br>
                    ${d.getDate()}
                    ${d.toLocaleDateString("es-AR", {
                      month: "short",
                    })}
                  </div>
                `,
              )
              .join("")}
          </div>

          ${rows}

        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <b>Horarios:</b>
        entrada desde las ${settings.checkIn} hs
        · salida hasta las ${settings.checkOut} hs.
        Una cabaña puede tener una salida por la mañana
        y una nueva entrada el mismo día por la tarde.
      </div>

    </div>
  `;
}
async function renderReservations() {
  const rs = await api("/api/reservations");
  content.innerHTML = `<div class="content"><div class="toolbar"><input id="search" placeholder="Buscar cliente o teléfono…" oninput="filterReservations()"><button class="primary" onclick="newReservation()">＋ Nueva reserva</button></div><div class="card"><table class="table"><thead><tr><th>Cliente</th><th>Cabaña</th><th>Entrada</th><th>Salida</th><th>Personas</th><th>Seña</th><th>Estado</th><th></th></tr></thead><tbody id="reservationRows">${rs.map((r) => reservationRow(r)).join("")}</tbody></table></div></div>`;
}
function reservationRow(r) {
  return `<tr data-search="${esc((r.clientName + " " + (r.phone || "")).toLowerCase())}"><td><b>${esc(r.clientName)}</b><br><small>${esc(r.phone || "")}</small></td><td>${r.cabinId}</td><td>${fmt(r.checkIn)}</td><td>${fmt(r.checkOut)}</td><td>${r.guests}</td><td>$${money(r.deposit || 0)}</td><td><span class="pill ${r.status}">${r.status}</span></td><td><div class="actions"><button class="small-btn" onclick="editReservation('${r.id}')">Editar</button><button class="small-btn danger" onclick="deleteReservation('${r.id}')">Eliminar</button></div></td></tr>`;
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
  content.innerHTML = `<div class="content"><div class="toolbar"><span>Guardá los datos de cada cliente una sola vez para reutilizarlos en futuras reservas.</span><button class="primary" onclick="newClient()">＋ Nuevo cliente</button></div><div class="card"><table class="table"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Dirección</th><th>Mail</th><th>Reservas</th><th>Última estadía</th></tr></thead><tbody>${enriched.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || "")}</td><td>${esc(c.address || "")}</td><td>${esc(c.email || "")}</td><td>${c.count}</td><td>${c.last ? fmt(c.last) : "-"}</td></tr>`).join("")}</tbody></table>${enriched.length ? "" : '<div class="empty">No hay clientes registrados.</div>'}</div></div>`;
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
async function renderPayments() {
  const [reservations, payments, settings] = await Promise.all([
    api("/api/reservations"),
    api("/api/payments"),
    api("/api/settings"),
  ]);

  const activeReservations = reservations.filter(
    (r) => r.status !== "cancelada",
  );

  const getTotal = (reservation) => {
    const nights = getNights(reservation.checkIn, reservation.checkOut);

    if (reservation.total != null) return Number(reservation.total || 0);
    return (
      Number(reservation.adults ?? reservation.guests ?? 0) * Number(reservation.adultPricePerPerson ?? settings.pricePerPerson ?? 0) +
      Number(reservation.children || 0) * Number(reservation.childPricePerPerson ?? settings.childPricePerPerson ?? 0)
    ) * nights;
  };

  const getPaid = (reservationId) => {
    return payments
      .filter((p) => p.reservationId === reservationId)
      .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  };

  const totalExpected = activeReservations.reduce(
    (total, reservation) => total + getTotal(reservation),
    0,
  );

  const totalPaid = activeReservations.reduce(
    (total, reservation) => total + getPaid(reservation.id),
    0,
  );

  const totalBalance = totalExpected - totalPaid;

  content.innerHTML = `
    <div class="content">

      <div class="grid kpis">

        <div class="card kpi">
          <div class="label">TOTAL RESERVAS</div>
          <div class="value">
            $${money(totalExpected)}
          </div>
        </div>

        <div class="card kpi">
          <div class="label">TOTAL COBRADO</div>
          <div class="value">
            $${money(totalPaid)}
          </div>
        </div>

        <div class="card kpi">
          <div class="label">SALDO PENDIENTE</div>
          <div class="value">
            $${money(totalBalance)}
          </div>
        </div>

      </div>

      <div
        class="card"
        style="margin-top:18px"
      >

        <div class="section-title">
          Estado de pagos por reserva
        </div>

        ${
          activeReservations.length
            ? `
              <table class="table">

                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Cabaña</th>
                    <th>Estadía</th>
                    <th>Total</th>
                    <th>Pagado</th>
                    <th>Saldo</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>

                  ${activeReservations
                    .map((reservation) => {
                      const total = getTotal(reservation);
                      const paid = getPaid(reservation.id);
                      const balance = total - paid;

                      return `
                        <tr>

                          <td>
                            <b>
                              ${esc(reservation.clientName)}
                            </b>

                            <br>

                            <small>
                              ${esc(reservation.phone || "")}
                            </small>
                          </td>

                          <td>
                            Cabaña ${reservation.cabinId}
                          </td>

                          <td>
                            ${fmt(reservation.checkIn)}
                            <br>
                            →
                            ${fmt(reservation.checkOut)}
                          </td>

                          <td>
                            <b>
                              $${money(total)}
                            </b>
                          </td>

                          <td>
                            $${money(paid)}
                          </td>

                          <td>
                            <span
                              class="pill ${
                                balance <= 0 ? "confirmada" : "pendiente"
                              }"
                            >
                              $${money(Math.max(0, balance))}
                            </span>
                          </td>

                          <td>
                            <button
                              class="small-btn"
                              onclick="addPayment('${reservation.id}')"
                            >
                              Registrar pago
                            </button>
                          </td>

                        </tr>
                      `;
                    })
                    .join("")}

                </tbody>

              </table>
            `
            : `
              <div class="empty">
                Todavía no hay reservas.
              </div>
            `
        }

      </div>

    </div>
  `;
}
async function addPayment(reservationId) {
  const [reservations, payments] = await Promise.all([
    api("/api/reservations"),
    api("/api/payments"),
  ]);

  const reservation = reservations.find((r) => r.id === reservationId);

  if (!reservation) {
    alert("No se encontró la reserva.");
    return;
  }

  const paid = payments
    .filter((p) => p.reservationId === reservationId)
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);

  const settings = await api("/api/settings");

  const nights = getNights(
  reservation.checkIn,
  reservation.checkOut,
);

  const total =
    reservation.total != null
      ? Number(reservation.total || 0)
      : (
          Number(reservation.adults ?? reservation.guests ?? 0) *
            Number(
              reservation.adultPricePerPerson ??
                settings.pricePerPerson ??
                0,
            ) +
          Number(reservation.children || 0) *
            Number(
              reservation.childPricePerPerson ??
                settings.childPricePerPerson ??
                0,
            )
        ) * nights;

  const balance = Math.max(0, total - paid);

  modal(`
    <div class="modal-head">

      <div>
        <h2>Registrar pago</h2>

        <small>
          ${esc(reservation.clientName)}
          · Cabaña ${reservation.cabinId}
        </small>
      </div>

      <button
        class="icon-btn"
        onclick="closeModal()"
      >
        ×
      </button>

    </div>

    <div class="card" style="margin-bottom:16px">

      <div>
        <b>Total de la reserva</b>
        <strong>
          $${money(total)}
        </strong>
      </div>

      <div style="margin-top:8px">
        Pagado:
        <b>$${money(paid)}</b>
      </div>

      <div style="margin-top:8px">
        Saldo:
        <b>$${money(balance)}</b>
      </div>

    </div>

    <form
      class="form"
      onsubmit="savePayment(event,'${reservationId}')"
    >

      <div class="field full">
        <label>Monto</label>

        <input
          type="number"
          name="amount"
          min="1"
          max="${balance}"
          required
          value="${balance > 0 ? balance : 0}"
        >
      </div>

      <div class="field full">
        <label>Concepto</label>

        <select name="concept">
          <option>Seña</option>
          <option>Pago parcial</option>
          <option>Pago final</option>
        </select>
      </div>

      <div class="form-actions">

        <button
          type="button"
          class="secondary"
          onclick="closeModal()"
        >
          Cancelar
        </button>

        <button
          class="primary"
          ${balance <= 0 ? "disabled" : ""}
        >
          Registrar pago
        </button>

      </div>

    </form>
  `);
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
  content.innerHTML = `<div class="content"><div class="card"><div class="section-title">Datos del establecimiento</div><form class="form" onsubmit="saveSettings(event)"><div class="field"><label>Nombre</label><input name="business" value="${esc(settings.business)}"></div><div class="field"><label>Responsable / dueño</label><input name="owner" value="${esc(settings.owner)}"></div><div class="field"><label>Teléfono de reservas</label><input name="phone" value="${esc(settings.phone)}"></div><div class="field"><label>Precio adulto</label><input type="number" name="pricePerPerson" value="${settings.pricePerPerson}"></div><div class="field"><label>Precio niño</label><input type="number" name="childPricePerPerson" value="${settings.childPricePerPerson || 0}"></div><div class="field"><label>Horario de entrada</label><input type="time" name="checkIn" value="${settings.checkIn}"></div><div class="field"><label>Horario de salida</label><input type="time" name="checkOut" value="${settings.checkOut}"></div><div class="form-actions"><button class="primary">Guardar cambios</button></div></form></div></div>`;
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

  modal(`<div class="modal-head"><div><h2>${r ? "Editar reserva" : "Nueva reserva"}</h2><small>Una misma reserva puede incluir varias cabañas.</small></div><button class="icon-btn" onclick="closeModal()">×</button></div><form id="reservationForm" class="form" onsubmit="saveReservation(event,'${r?.id || ""}')"><div class="field full"><label>Cliente</label><input id="clientSearch" list="clientList" name="clientName" required value="${esc(r?.clientName || initialClient?.name || "")}" placeholder="Buscar cliente o escribir uno nuevo"><datalist id="clientList">${clients.map((c) => `<option value="${esc(c.name)}" data-id="${c.id}">${esc(c.phone || "")}</option>`).join("")}</datalist></div><div class="field"><label>Teléfono</label><input id="clientPhone" name="phone" value="${esc(r?.phone || initialClient?.phone || "")}"></div><div class="field"><label>Mail</label><input id="clientEmail" name="email" type="email" value="${esc(r?.email || initialClient?.email || "")}"></div><div class="field full"><label>Dirección</label><input id="clientAddress" name="address" value="${esc(r?.address || initialClient?.address || "")}"></div><div class="field"><label>Entrada</label><input id="reservationCheckIn" type="datetime-local" name="checkIn" required value="${localInput(r?.checkIn)}"></div><div class="field"><label>Salida</label><input id="reservationCheckOut" type="datetime-local" name="checkOut" required value="${localInput(r?.checkOut)}"></div><div class="field"><label>Estado</label><select name="status"><option ${r?.status === "confirmada" || !r ? "selected" : ""}>confirmada</option><option ${r?.status === "pendiente" ? "selected" : ""}>pendiente</option><option ${r?.status === "cancelada" ? "selected" : ""}>cancelada</option></select></div><div class="field full"><label>Cabañas de esta reserva</label><div id="reservationCabins">${initialItems.map(itemHtml).join("")}</div><button type="button" class="secondary" id="addCabin" style="margin-top:12px">＋ Agregar otra cabaña</button></div><div class="card full" style="margin-top:8px"><b>Total de la reserva:</b> <span id="reservationGrandTotal">$0</span></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">${r ? "Guardar cambios" : "Crear reserva"}</button></div></form>`);

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
    const start = new Date(checkIn).getTime(), end = new Date(checkOut).getTime();
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
