require("dotenv").config();
const express = require("express");
const fs = require("fs");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");
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

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en el archivo .env");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let dbCache = null;

const cabins = [
  {
    id: 1,
    capacity: 8,
    rooms: [
      { name: "Hab. 1", beds: "1 matrimonial + 1 cucheta" },
      { name: "Hab. 2", beds: "1 matrimonial + 1 cucheta" },
    ],
  },
  {
    id: 2,
    capacity: 7,
    rooms: [
      { name: "Hab. 1", beds: "1 matrimonial + 1 plaza" },
      { name: "Hab. 2", beds: "2 cuchetas" },
    ],
  },
  {
    id: 3,
    capacity: 8,
    rooms: [
      { name: "Hab. 1", beds: "1 matrimonial + 1 cucheta" },
      { name: "Hab. 2", beds: "1 matrimonial + 1 cucheta" },
    ],
  },
  {
    id: 4,
    capacity: 3,
    rooms: [{ name: "Hab. única", beds: "1 matrimonial + 1 plaza" }],
  },
  {
    id: 6,
    capacity: 3,
    rooms: [{ name: "Hab. única", beds: "1 matrimonial + 1 plaza" }],
  },
  {
    id: 7,
    capacity: 4,
    rooms: [{ name: "Hab. única", beds: "1 matrimonial + 1 cucheta" }],
  },
  {
    id: 8,
    capacity: 5,
    rooms: [
      { name: "Hab. única", beds: "1 matrimonial + 1 plaza + 1 cucheta" },
    ],
  },
  {
    id: 9,
    capacity: 6,
    rooms: [{ name: "Hab. única", beds: "1 matrimonial + 2 cuchetas" }],
  },
  {
    id: 10,
    capacity: 5,
    rooms: [
      { name: "Hab. única", beds: "1 matrimonial + 1 cucheta + 1 plaza" },
    ],
  },
  {
    id: 11,
    capacity: 3,
    rooms: [{ name: "Hab. única", beds: "1 matrimonial + 1 plaza" }],
  },
];

function initialDb() {
  return {
    reservations: [],
    blocks: [],
    payments: [],
    clients: [],
    settings: {
      owner: "Ivan Olmedo",
      business: "Cabañas Las Tinajas",
      phone: "3858 442610",
      pricePerPerson: 35000,
      childPricePerPerson: 0,
      checkIn: "14:00",
      checkOut: "10:00",
    },
  };
}
function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE))
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialDb(), null, 2));
}

function readLocalDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

async function loadDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cabanas_app (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);

  const result = await pool.query(
    "SELECT data FROM cabanas_app WHERE id = 1",
  );

  if (result.rows.length > 0) {
    dbCache = result.rows[0].data;
    if (!Array.isArray(dbCache.clients)) dbCache.clients = [];
    if (dbCache.settings?.childPricePerPerson == null) {
      dbCache.settings.childPricePerPerson = 0;
    }
    const byKey = new Map(dbCache.clients.map((c) => [String(c.key || "").toLowerCase(), c]));
    for (const r of dbCache.reservations || []) {
      if (r.adults == null) r.adults = Number(r.guests || 0);
      if (r.children == null) r.children = 0;
      if (r.adultPricePerPerson == null) r.adultPricePerPerson = Number(dbCache.settings.pricePerPerson || 0);
      if (r.childPricePerPerson == null) r.childPricePerPerson = Number(dbCache.settings.childPricePerPerson || 0);
      if (r.total == null) r.total = (Number(r.adults || 0) * Number(r.adultPricePerPerson || 0) + Number(r.children || 0) * Number(r.childPricePerPerson || 0)) * getNights(r.checkIn, r.checkOut)
      const key = String(r.phone || r.clientName || "").trim().toLowerCase();
      if (key) {
        let c = byKey.get(key);
        if (!c) {
          c = { id: uid(), key, name: r.clientName || "", phone: r.phone || "", address: r.address || "", email: r.email || "" };
          dbCache.clients.push(c);
          byKey.set(key, c);
        }
        r.clientId = r.clientId || c.id;
        r.address = r.address || c.address;
        r.email = r.email || c.email;
      }
    }
    await writeDb(dbCache);
    ensureDb();
    fs.writeFileSync(DATA_FILE, JSON.stringify(dbCache, null, 2));
    console.log("Base de Cabañas cargada desde Neon.");
    return;
  }

  dbCache = readLocalDb();
  await pool.query(
    `INSERT INTO cabanas_app (id, data) VALUES (1, $1::jsonb)`,
    [JSON.stringify(dbCache)],
  );
  console.log("Base local migrada a Neon correctamente.");
}

function readDb() {
  if (!dbCache) throw new Error("La base de datos todavía no está lista.");
  return dbCache;
}

async function writeDb(db) {
  dbCache = db;
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  await pool.query(
    `
      INSERT INTO cabanas_app (id, data)
      VALUES (1, $1::jsonb)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
    `,
    [JSON.stringify(db)],
  );
}
function uid() {
  return crypto.randomUUID();
}
function normalizeDateTime(s) {
  return new Date(s).getTime();
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return (
    normalizeDateTime(aStart) < normalizeDateTime(bEnd) &&
    normalizeDateTime(bStart) < normalizeDateTime(aEnd)
  );
}
function cabinAvailable(db, cabinId, checkIn, checkOut, ignoreId) {
  const reservations = db.reservations.filter(
    (r) =>
      r.cabinId === Number(cabinId) &&
      r.id !== ignoreId &&
      r.status !== "cancelada",
  );
  const blocks = db.blocks.filter((b) => b.cabinId === Number(cabinId));
  return (
    !reservations.some((r) =>
      overlaps(checkIn, checkOut, r.checkIn, r.checkOut),
    ) && !blocks.some((b) => overlaps(checkIn, checkOut, b.start, b.end))
  );
}

app.use(express.json());

// ===============================
// AUTENTICACIÓN
// ===============================
const SESSION_DAYS = 30;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
  throw new Error("Faltan ADMIN_USER y ADMIN_PASSWORD en el archivo .env");
}
if (!SESSION_SECRET) {
  throw new Error("Falta SESSION_SECRET o ADMIN_PASSWORD para firmar las sesiones.");
}

function base64Url(text) {
  return Buffer.from(text, "utf8").toString("base64url");
}
function sessionSignature(exp) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(exp)).digest("base64url");
}
function createSession() {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return `${base64Url(String(exp))}.${sessionSignature(exp)}`;
}
function getSession(req) {
  const cookie = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("sesion="));
  return cookie ? cookie.substring("sesion=".length) : null;
}
function validSession(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  let exp;
  try { exp = Number(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return false; }
  if (!Number.isSafeInteger(exp) || Date.now() > exp) return false;
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(sessionSignature(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAuth(req, res, next) {
  if (!validSession(getSession(req))) return res.status(401).json({ error: "No autorizado. Iniciá sesión." });
  next();
}

app.get("/login.html", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.post("/api/login", (req, res) => {
  const { usuario, password } = req.body || {};
  if (usuario !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  }
  const token = createSession();
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  res.setHeader("Set-Cookie", `sesion=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60};${secure}`);
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "sesion=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/sesion", (req, res) => {
  if (!validSession(getSession(req))) return res.status(401).json({ ok: false });
  res.json({ ok: true });
});

app.get("/", (req, res, next) => {
  if (!validSession(getSession(req))) return res.redirect("/login.html");
  next();
});
app.get("/index.html", (req, res, next) => {
  if (!validSession(getSession(req))) return res.redirect("/login.html");
  next();
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/cabins", (req, res) => res.json(cabins));
app.get("/api/clients", (req, res) => {
  const db = readDb();
  const clients = Array.isArray(db.clients) ? db.clients : [];
  res.json(clients.sort((a, b) => String(a.name).localeCompare(String(b.name), "es")));
});
app.post("/api/clients", async (req, res) => {
  const db = readDb();
  if (!Array.isArray(db.clients)) db.clients = [];
  const body = req.body || {};
  if (!String(body.name || "").trim()) return res.status(400).json({ error: "El nombre del cliente es obligatorio." });
  const key = String(body.phone || body.email || body.name).trim().toLowerCase();
  let client = db.clients.find((c) => String(c.key || "").toLowerCase() === key);
  if (!client) {
    client = { id: uid(), key, name: String(body.name).trim(), phone: String(body.phone || "").trim(), address: String(body.address || "").trim(), email: String(body.email || "").trim() };
    db.clients.push(client);
  } else {
    client.name = String(body.name).trim();
    client.phone = String(body.phone || "").trim();
    client.address = String(body.address || "").trim();
    client.email = String(body.email || "").trim();
  }
  await writeDb(db);
  res.status(201).json(client);
});

app.get("/api/settings", (req, res) => res.json(readDb().settings));
app.put("/api/settings", async (req, res) => {
  const db = readDb();
  db.settings = { ...db.settings, ...req.body };
  await writeDb(db);
  res.json(db.settings);
});

app.get("/api/dashboard", (req, res) => {
  const db = readDb();
  const now = Date.now();
  const active = db.reservations.filter(
    (r) => r.status !== "cancelada" && normalizeDateTime(r.checkOut) >= now,
  );
  const occupiedNow = active.filter(
    (r) =>
      normalizeDateTime(r.checkIn) <= now &&
      normalizeDateTime(r.checkOut) > now,
  ).length;
  const pending = db.reservations.filter(
    (r) => r.status === "pendiente",
  ).length;
  const arrivalsToday = db.reservations.filter(
    (r) =>
      r.status !== "cancelada" &&
      r.checkIn.slice(0, 10) === new Date().toISOString().slice(0, 10),
  ).length;
  const departuresToday = db.reservations.filter(
    (r) =>
      r.status !== "cancelada" &&
      r.checkOut.slice(0, 10) === new Date().toISOString().slice(0, 10),
  ).length;
  res.json({
    totalCabins: cabins.length,
    occupiedNow,
    availableNow: cabins.length - occupiedNow,
    pending,
    arrivalsToday,
    departuresToday,
    totalPeople: active
      .filter(
        (r) =>
          normalizeDateTime(r.checkIn) <= now &&
          normalizeDateTime(r.checkOut) > now,
      )
      .reduce((s, r) => s + r.guests, 0),
  });
});

app.get("/api/reservations", (req, res) => {
  const db = readDb();
  let list = db.reservations.map((r) => ({
    ...r,
    cabin: cabins.find((c) => c.id === r.cabinId),
  }));
  if (req.query.from)
    list = list.filter((r) => r.checkOut.slice(0, 10) >= req.query.from);
  if (req.query.to)
    list = list.filter((r) => r.checkIn.slice(0, 10) <= req.query.to);
  if (req.query.q) {
    const q = req.query.q.toLowerCase();
    list = list.filter((r) =>
      `${r.clientName} ${r.phone || ""} ${r.notes || ""}`
        .toLowerCase()
        .includes(q),
    );
  }
  list.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  res.json(list);
});

app.post("/api/reservation-groups", async (req, res) => {
  const db = readDb();
  if (!Array.isArray(db.clients)) db.clients = [];
  const body = req.body || {};
  const client = body.client || {};
  const cabinsRequested = Array.isArray(body.cabins) ? body.cabins : [];
  if (!String(client.name || "").trim() || !body.checkIn || !body.checkOut || !cabinsRequested.length) {
    return res.status(400).json({ error: "Completá cliente, fechas y al menos una cabaña." });
  }
  const checkIn = body.checkIn;
  const checkOut = body.checkOut;
  if (normalizeDateTime(checkOut) <= normalizeDateTime(checkIn)) return res.status(400).json({ error: "La salida debe ser posterior a la entrada." });
  const adultsDefault = Number(body.adults || 0);
  const childrenDefault = Number(body.children || 0);
  const groupId = uid();
  const clientKey = String(client.phone || client.email || client.name).trim().toLowerCase();
  let savedClient = db.clients.find((c) => String(c.key || "").toLowerCase() === clientKey);
  if (!savedClient) {
    savedClient = { id: uid(), key: clientKey, name: String(client.name).trim(), phone: String(client.phone || "").trim(), address: String(client.address || "").trim(), email: String(client.email || "").trim() };
    db.clients.push(savedClient);
  } else {
    Object.assign(savedClient, { name: String(client.name).trim(), phone: String(client.phone || "").trim(), address: String(client.address || "").trim(), email: String(client.email || "").trim() });
  }
  const requestedCabinIds = cabinsRequested.map((item) => Number(item.cabinId));
  if (new Set(requestedCabinIds).size !== requestedCabinIds.length) {
    return res.status(400).json({ error: "No podés agregar la misma cabaña dos veces en una reserva." });
  }
  const created = [];
  for (const item of cabinsRequested) {
    const cabinId = Number(item.cabinId);
    const cabin = cabins.find((c) => c.id === cabinId);
    const adults = Number(item.adults ?? adultsDefault);
    const children = Number(item.children ?? childrenDefault);
    const guests = adults + children;
    const adultPricePerPerson = Number(item.adultPricePerPerson ?? db.settings.pricePerPerson ?? 0);
    const childPricePerPerson = Number(item.childPricePerPerson ?? db.settings.childPricePerPerson ?? 0);
    if (!cabin) return res.status(400).json({ error: `Cabaña ${cabinId} inválida.` });
    if (guests < 1) return res.status(400).json({ error: `La cabaña ${cabinId} necesita al menos un huésped.` });
    if (guests > cabin.capacity) return res.status(400).json({ error: `La cabaña ${cabinId} tiene capacidad máxima para ${cabin.capacity} personas.` });
    if (!cabinAvailable(db, cabinId, checkIn, checkOut)) return res.status(409).json({ error: `La cabaña ${cabinId} no está disponible en ese horario.` });
    const nights = getNights(checkIn, checkOut);
    created.push({ id: uid(), groupId, clientId: savedClient.id, clientName: savedClient.name, phone: savedClient.phone, address: savedClient.address, email: savedClient.email, cabinId, checkIn, checkOut, adults, children, guests, adultPricePerPerson, childPricePerPerson, total: (adults * adultPricePerPerson + children * childPricePerPerson) * nights, deposit: Number(item.deposit || 0), notes: item.notes || body.notes || "", status: body.status || "confirmada", createdAt: new Date().toISOString() });
  }
  db.reservations.push(...created);
  await writeDb(db);
  res.status(201).json({ groupId, client: savedClient, reservations: created });
});

app.post("/api/reservations", async (req, res) => {
  const db = readDb();
  const r = { ...req.body, id: uid(), createdAt: new Date().toISOString(), status: req.body.status || "confirmada", guests: Number(req.body.guests || 0), cabinId: Number(req.body.cabinId) };
  r.adults = Number(req.body.adults ?? r.guests);
  r.children = Number(req.body.children || 0);
  r.guests = r.adults + r.children;
  r.adultPricePerPerson = Number(req.body.adultPricePerPerson ?? db.settings.pricePerPerson ?? 0);
  r.childPricePerPerson = Number(req.body.childPricePerPerson ?? db.settings.childPricePerPerson ?? 0);
  const nights = getNights(r.checkIn, r.checkOut);
  r.total = (r.adults * r.adultPricePerPerson + r.children * r.childPricePerPerson) * nights;
  if (!r.clientName || !r.checkIn || !r.checkOut || !r.cabinId || !r.guests) return res.status(400).json({ error: "Completá cliente, cabaña, huéspedes, entrada y salida." });
  const cabin = cabins.find((c) => c.id === r.cabinId);
  if (!cabin) return res.status(400).json({ error: "Cabaña inválida." });
  if (r.guests > cabin.capacity) return res.status(400).json({ error: `La cabaña ${cabin.id} tiene capacidad máxima para ${cabin.capacity} personas.` });
  if (normalizeDateTime(r.checkOut) <= normalizeDateTime(r.checkIn)) return res.status(400).json({ error: "La salida debe ser posterior a la entrada." });
  if (!cabinAvailable(db, r.cabinId, r.checkIn, r.checkOut)) return res.status(409).json({ error: "La cabaña no está disponible en ese horario." });
  if (!Array.isArray(db.clients)) db.clients = [];
  const key = String(r.phone || r.clientName).trim().toLowerCase();
  let c = db.clients.find((x) => String(x.key || "").toLowerCase() === key);
  if (!c) { c = { id: uid(), key, name: r.clientName, phone: r.phone || "", address: r.address || "", email: r.email || "" }; db.clients.push(c); }
  r.clientId = c.id;
  r.address = r.address || c.address;
  r.email = r.email || c.email;
  db.reservations.push(r);
  await writeDb(db);
  res.status(201).json(r);
});

app.put("/api/reservations/:id", async (req, res) => {
  const db = readDb();
  const i = db.reservations.findIndex((r) => r.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "Reserva no encontrada." });
  const old = db.reservations[i];
  const r = {
    ...old,
    ...req.body,
    id: old.id,
    cabinId: Number(req.body.cabinId ?? old.cabinId),
    guests: Number(req.body.guests ?? old.guests),
  };
  r.adults = Number(req.body.adults ?? old.adults ?? r.guests);
  r.children = Number(req.body.children ?? old.children ?? 0);
  r.guests = r.adults + r.children;
  r.adultPricePerPerson = Number(req.body.adultPricePerPerson ?? old.adultPricePerPerson ?? db.settings.pricePerPerson ?? 0);
  r.childPricePerPerson = Number(req.body.childPricePerPerson ?? old.childPricePerPerson ?? db.settings.childPricePerPerson ?? 0);
  const nights = getNights(r.checkIn, r.checkOut);
  r.total = (r.adults * r.adultPricePerPerson + r.children * r.childPricePerPerson) * nights;
  const cabin = cabins.find((c) => c.id === r.cabinId);
  if (r.guests > cabin.capacity)
    return res
      .status(400)
      .json({
        error: `La cabaña ${cabin.id} tiene capacidad máxima para ${cabin.capacity} personas.`,
      });
  if (normalizeDateTime(r.checkOut) <= normalizeDateTime(r.checkIn))
    return res
      .status(400)
      .json({ error: "La salida debe ser posterior a la entrada." });
  if (
    r.status !== "cancelada" &&
    !cabinAvailable(db, r.cabinId, r.checkIn, r.checkOut, r.id)
  )
    return res
      .status(409)
      .json({ error: "La cabaña no está disponible en ese horario." });
  db.reservations[i] = r;
  await writeDb(db);
  res.json(r);
});

app.delete("/api/reservations/:id", async (req, res) => {
  const db = readDb();
  db.reservations = db.reservations.filter((r) => r.id !== req.params.id);
  db.payments = db.payments.filter((p) => p.reservationId !== req.params.id);
  await writeDb(db);
  res.status(204).end();
});

app.get("/api/payments", (req, res) => res.json(readDb().payments));
app.post("/api/payments", async (req, res) => {
  const db = readDb();
  const p = {
    ...req.body,
    id: uid(),
    createdAt: new Date().toISOString(),
    amount: Number(req.body.amount || 0),
  };
  db.payments.push(p);
  await writeDb(db);
  res.status(201).json(p);
});
app.delete("/api/payments/:id", async (req, res) => {
  const db = readDb();
  db.payments = db.payments.filter((p) => p.id !== req.params.id);
  await writeDb(db);
  res.status(204).end();
});

app.get("/api/blocks", (req, res) => res.json(readDb().blocks));
app.post("/api/blocks", async (req, res) => {
  const db = readDb();
  const b = { ...req.body, id: uid(), cabinId: Number(req.body.cabinId) };
  if (!b.start || !b.end || !b.cabinId)
    return res.status(400).json({ error: "Faltan datos del bloqueo." });
  db.blocks.push(b);
  await writeDb(db);
  res.status(201).json(b);
});
app.put("/api/blocks/:id", async (req, res) => {
  const db = readDb();

  const index = db.blocks.findIndex(
    (b) => b.id === req.params.id,
  );

  if (index < 0) {
    return res.status(404).json({
      error: "Bloqueo no encontrado.",
    });
  }

  const old = db.blocks[index];

  const block = {
    ...old,
    ...req.body,
    id: old.id,
    cabinId: Number(
      req.body.cabinId ?? old.cabinId,
    ),
  };

  if (
    !block.cabinId ||
    !block.start ||
    !block.end
  ) {
    return res.status(400).json({
      error:
        "Completá cabaña, fecha de inicio y fecha de finalización.",
    });
  }

  const start = new Date(block.start);
  const end = new Date(block.end);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return res.status(400).json({
      error: "Las fechas no son válidas.",
    });
  }

  if (end <= start) {
    return res.status(400).json({
      error:
        "La fecha de finalización debe ser posterior al inicio.",
    });
  }

  const overlaps = (
    startA,
    endA,
    startB,
    endB,
  ) => {
    return (
      new Date(startA) < new Date(endB) &&
      new Date(startB) < new Date(endA)
    );
  };

  const anotherBlock = db.blocks.some(
    (b) =>
      b.id !== block.id &&
      Number(b.cabinId) === block.cabinId &&
      overlaps(
        block.start,
        block.end,
        b.start,
        b.end,
      ),
  );

  if (anotherBlock) {
    return res.status(409).json({
      error:
        "Ya existe otro bloqueo para esa cabaña en ese horario.",
    });
  }

  const reservationConflict =
    db.reservations.some(
      (r) =>
        Number(r.cabinId) === block.cabinId &&
        r.status !== "cancelada" &&
        overlaps(
          block.start,
          block.end,
          r.checkIn,
          r.checkOut,
        ),
    );

  if (reservationConflict) {
    return res.status(409).json({
      error:
        "Existe una reserva para esa cabaña en ese horario.",
    });
  }

  db.blocks[index] = block;

  await writeDb(db);

  res.json(block);
});
app.delete("/api/blocks/:id", async (req, res) => {
  const db = readDb();
  db.blocks = db.blocks.filter((b) => b.id !== req.params.id);
  await writeDb(db);
  res.status(204).end();
});

app.use((req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

async function startServer() {
  await loadDb();
  app.listen(PORT, "0.0.0.0", () =>
    console.log(`Cabañas Las Tinajas: http://localhost:${PORT}`),
  );
}

startServer().catch((error) => {
  console.error("No se pudo iniciar Cabañas Las Tinajas:", error);
  process.exit(1);
});
