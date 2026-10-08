const express = require("express");
const path = require("path");
const { Op } = require("sequelize");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const SequelizeStoreFactory = require("connect-session-sequelize");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const { sequelize, User, Scenario, Line, Delta, Checkpoint } = require("./models");
const { runMigrations } = require("./migrations");
const { seedDatabase } = require("./seed");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || "scenarijpro-local-development-only";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required in production.");
}

if (isProduction) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://unpkg.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"]
      }
    }
  })
);
app.use(express.json({ limit: "256kb" }));

const SequelizeStore = SequelizeStoreFactory(session.Store);
const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: "Session",
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 7 * 24 * 60 * 60 * 1000
});

app.use(
  session({
    name: "scenarij.sid",
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Previše pokušaja. Pokušaj ponovo za nekoliko minuta." }
});

app.get("/health", async (_req, res) => {
  try {
    await sequelize.authenticate();
    return res.status(200).json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "unavailable" });
  }
});

// Public frontend assets only. Server source, logs and local configuration stay private.
app.use("/css", express.static(path.join(__dirname, "css"), { index: false }));
app.use("/js", express.static(path.join(__dirname, "js"), { index: false }));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "projects.html"));
});
app.get("/editor", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "writing.html"));
});
app.get("/auth", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "auth.html"));
});

// =================== LOCKOVI U RAM-U ===================
// user može imati samo 1 zaključanu liniju globalno
const lockedLineByUser = new Map(); // userId -> { scenarioId, lineId }
const lockedLineOwner = new Map();  // "scenarioId:lineId" -> userId

// zaključavanje imena likova po scenariju
const lockedCharacterOwner = new Map(); // scenarioId -> Map(characterName -> userId)

// =================== HELPERS ===================
function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function keyLine(scenarioId, lineId) {
  return `${scenarioId}:${lineId}`;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function currentUserId(req) {
  const userId = Number(req.session?.userId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function requireAuth(req, res, next) {
  if (!currentUserId(req)) {
    return res.status(401).json({ message: "Prijavi se da nastaviš." });
  }
  return next();
}

async function findAccessibleScenario(scenarioId, userId) {
  const access = [{ isDemo: true }];
  if (userId) access.push({ ownerId: userId });

  return Scenario.findOne({
    where: {
      id: scenarioId,
      [Op.or]: access
    }
  });
}

async function findEditableScenario(scenarioId, userId) {
  if (!userId) return null;
  return Scenario.findOne({
    where: { id: scenarioId, ownerId: userId, isDemo: false }
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

// Separatori riječi: razmak/tab/newline + zarez + tačka
function isSeparator(ch) {
  return /[ \t\r\n,.]/.test(ch);
}

// Riječ se broji samo ako token ima bar jedno slovo
function tokenHasLetter(token) {
  return /[A-Za-zČĆŽŠĐčćžšđ]/.test(token);
}

// Wrap jednog stringa na maxWords riječi, ali NE uklanja interpunkciju/spacije.
function wrap20Words(text, maxWords = 20) {
  const str = (text ?? "").toString();
  if (str.length === 0) return [""];

  const segments = [];
  let seg = "";
  let wordCount = 0;

  let i = 0;
  while (i < str.length) {
    const ch = str[i];

    // separatore samo kopirati (ne utiču direktno na brojanje)
    if (isSeparator(ch)) {
      seg += ch;
      i++;
      continue;
    }

    // token = sve do sljedećeg separatora
    let j = i;
    while (j < str.length && !isSeparator(str[j])) j++;
    const token = str.slice(i, j);

    const countsAsWord = tokenHasLetter(token);

    // ako bi ovo bila 21. riječ -> prelomi prije tokena
    if (countsAsWord && wordCount >= maxWords) {
      segments.push(seg.trimEnd());
      seg = "";
      wordCount = 0;
    }

    seg += token;
    if (countsAsWord) wordCount++;

    i = j;
  }

  segments.push(seg.trimEnd());
  return segments;
}

function flattenNewTextArray(newTextArr) {
  const result = [];
  for (const s of newTextArr) {
    const chunks = wrap20Words(String(s));
    result.push(...chunks);
  }
  return result;
}

function getOrderedContent(content) {
  if (!Array.isArray(content) || content.length === 0) return [];

  const map = new Map(content.map((l) => [l.lineId, l]));
  const pointed = new Set(content.map((l) => l.nextLineId).filter((x) => x !== null));

  let head = content.find((l) => !pointed.has(l.lineId));
  if (!head) head = content[0];

  const ordered = [];
  const visited = new Set();
  let cur = head;

  while (cur && !visited.has(cur.lineId)) {
    visited.add(cur.lineId);
    ordered.push(cur);
    cur = cur.nextLineId === null ? null : map.get(cur.nextLineId);
  }
  return ordered;
}

async function dbGetScenarioOrNull(scenarioId) {
  const sc = await Scenario.findByPk(scenarioId);
  return sc ? sc.get({ plain: true }) : null;
}

async function dbGetLines(scenarioId) {
  const lines = await Line.findAll({
    where: { scenarioId },
    order: [["lineId", "ASC"]]
  });
  return lines.map((l) => l.get({ plain: true }));
}

async function dbGetLineOrNull(scenarioId, lineId) {
  const line = await Line.findOne({ where: { scenarioId, lineId } });
  return line ? line : null; // vraćamo Sequelize instancu radi update()
}

async function dbNextLineIdValue(scenarioId) {
  const max = await Line.max("lineId", { where: { scenarioId } });
  return (Number(max) || 0) + 1;
}

// =================== AUTENTIFIKACIJA ===================

app.get("/api/auth/me", async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(200).json({ user: null });

  const user = await User.findByPk(userId);
  if (!user) {
    await destroySession(req);
    return res.status(200).json({ user: null });
  }

  return res.status(200).json({ user: publicUser(user) });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ message: "Ime mora imati između 2 i 80 znakova." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ message: "Unesi ispravnu email adresu." });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: "Lozinka mora imati najmanje 8 znakova." });
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    return res.status(409).json({ message: "Račun sa ovom email adresom već postoji." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash });
  await regenerateSession(req);
  req.session.userId = user.id;

  return res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const user = await User.findOne({ where: { email } });
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!valid) {
    return res.status(401).json({ message: "Email ili lozinka nisu ispravni." });
  }

  await regenerateSession(req);
  req.session.userId = user.id;
  return res.status(200).json({ user: publicUser(user) });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await destroySession(req);
  res.clearCookie("scenarij.sid");
  return res.status(204).end();
});

// =================== SCENARIJI ===================

// GET /api/scenarios
app.get("/api/scenarios", async (req, res) => {
  try {
    const userId = currentUserId(req);
    const access = [{ isDemo: true }];
    if (userId) access.push({ ownerId: userId });

    const scenarios = await Scenario.findAll({
      where: { [Op.or]: access },
      order: [["isDemo", "ASC"], ["id", "DESC"]]
    });
    const result = await Promise.all(
      scenarios.map(async (scenario) => {
        const [lineCount, lastDelta] = await Promise.all([
          Line.count({ where: { scenarioId: scenario.id } }),
          Delta.max("timestamp", { where: { scenarioId: scenario.id } })
        ]);

        return {
          id: scenario.id,
          title: scenario.title,
          lineCount,
          updatedAt: Number(lastDelta) || null,
          isDemo: scenario.isDemo,
          canEdit: Boolean(userId && scenario.ownerId === userId && !scenario.isDemo)
        };
      })
    );

    return res.status(200).json(result);
  } catch {
    return res.status(500).json({ message: "Scenarije trenutno nije moguce ucitati." });
  }
});

// POST /api/scenarios
app.post("/api/scenarios", requireAuth, async (req, res) => {
  const titleRaw = req.body?.title;
  const title =
    typeof titleRaw === "string" && titleRaw.trim() !== ""
      ? titleRaw.trim()
      : "Neimenovani scenarij";

  // Kreiraj scenario
  const sc = await Scenario.create({
    title: title.slice(0, 160),
    ownerId: currentUserId(req),
    isDemo: false,
    initialSnapshot: JSON.stringify([{ lineId: 1, nextLineId: null, text: "" }])
  });

  // Kreiraj prvu liniju
  await Line.create({
    scenarioId: sc.id,
    lineId: 1,
    nextLineId: null,
    text: ""
  });

  return res.status(200).json({
    id: sc.id,
    title: sc.title,
    content: [{ lineId: 1, nextLineId: null, text: "" }]
  });
});

// POST /api/scenarios/:scenarioId/duplicate
app.post("/api/scenarios/:scenarioId/duplicate", requireAuth, async (req, res) => {
  const sourceId = Number(req.params.scenarioId);
  const userId = currentUserId(req);
  const source = await findAccessibleScenario(sourceId, userId);
  if (!source) return res.status(404).json({ message: "Scenario ne postoji!" });

  const sourceLines = getOrderedContent(await dbGetLines(sourceId));
  const copy = await sequelize.transaction(async (transaction) => {
    const scenario = await Scenario.create(
      {
        title: `${source.title} - kopija`.slice(0, 160),
        ownerId: userId,
        isDemo: false,
        initialSnapshot: JSON.stringify(
          sourceLines.map(({ lineId, nextLineId, text }) => ({ lineId, nextLineId, text }))
        )
      },
      { transaction }
    );

    await Line.bulkCreate(
      sourceLines.map(({ lineId, nextLineId, text }) => ({
        scenarioId: scenario.id,
        lineId,
        nextLineId,
        text
      })),
      { transaction }
    );

    const timestamp = nowUnixSeconds();
    await Delta.bulkCreate(
      sourceLines.map(({ lineId, nextLineId, text }, index) => ({
        scenarioId: scenario.id,
        type: "line_update",
        lineId,
        nextLineId,
        content: text,
        timestamp: timestamp + index
      })),
      { transaction }
    );

    return scenario;
  });

  return res.status(201).json({ id: copy.id, title: copy.title });
});

// PATCH /api/scenarios/:scenarioId
app.patch("/api/scenarios/:scenarioId", requireAuth, async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const title = String(req.body?.title ?? "").trim();

  if (!title) return res.status(400).json({ message: "Naslov je obavezan." });

  const scenario = await findEditableScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  scenario.title = title.slice(0, 160);
  await scenario.save();

  return res.status(200).json({ id: scenario.id, title: scenario.title });
});

// POST /api/scenarios/:scenarioId/lines
app.post("/api/scenarios/:scenarioId/lines", requireAuth, async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const text = String(req.body?.text ?? "");

  if (text.length > 10000) {
    return res.status(400).json({ message: "Linija je preduga." });
  }

  const scenario = await findEditableScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  try {
    const created = await sequelize.transaction(async (transaction) => {
      const lines = await dbGetLines(scenarioId);
      const ordered = getOrderedContent(lines);
      const previous = ordered.at(-1) || null;
      const lineId = await dbNextLineIdValue(scenarioId);

      const line = await Line.create(
        { scenarioId, lineId, nextLineId: null, text },
        { transaction }
      );

      if (previous) {
        await Line.update(
          { nextLineId: lineId },
          { where: { scenarioId, lineId: previous.lineId }, transaction }
        );

        await Delta.create(
          {
            scenarioId,
            type: "line_update",
            lineId: previous.lineId,
            nextLineId: lineId,
            content: previous.text,
            timestamp: nowUnixSeconds()
          },
          { transaction }
        );
      }

      await Delta.create(
        {
          scenarioId,
          type: "line_update",
          lineId,
          nextLineId: null,
          content: text,
          timestamp: nowUnixSeconds()
        },
        { transaction }
      );

      return line;
    });

    return res.status(201).json({
      lineId: created.lineId,
      nextLineId: created.nextLineId,
      text: created.text
    });
  } catch {
    return res.status(500).json({ message: "Nova linija nije sacuvana." });
  }
});

// POST /api/scenarios/:scenarioId/lines/:lineId/lock
app.post("/api/scenarios/:scenarioId/lines/:lineId/lock", requireAuth, async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const lineId = Number(req.params.lineId);
  const userId = currentUserId(req);

  const scenario = await findEditableScenario(scenarioId, userId);
  if (!scenario) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  const line = await dbGetLineOrNull(scenarioId, lineId);
  if (!line) return res.status(404).json({ message: "Linija ne postoji!" });

  const k = keyLine(scenarioId, lineId);
  const owner = lockedLineOwner.get(k);

  if (owner && owner !== userId) {
    return res.status(409).json({ message: "Linija je vec zakljucana!" });
  }

  // ako user ima zaključanu drugu liniju -> otključaj staru (samo njegovu)
  const prev = lockedLineByUser.get(userId);
  if (prev) {
    const prevKey = keyLine(prev.scenarioId, prev.lineId);
    if (lockedLineOwner.get(prevKey) === userId) {
      lockedLineOwner.delete(prevKey);
    }
    lockedLineByUser.delete(userId);
  }

  lockedLineOwner.set(k, userId);
  lockedLineByUser.set(userId, { scenarioId, lineId });

  return res.status(200).json({ message: "Linija je uspjesno zakljucana!" });
});

// PUT /api/scenarios/:scenarioId/lines/:lineId
app.put("/api/scenarios/:scenarioId/lines/:lineId", requireAuth, async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const lineId = Number(req.params.lineId);
  const userId = currentUserId(req);
  const newText = req.body?.newText;

  const scenario = await findEditableScenario(scenarioId, userId);
  if (!scenario) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  const line = await dbGetLineOrNull(scenarioId, lineId);
  if (!line) return res.status(404).json({ message: "Linija ne postoji!" });

  if (!Array.isArray(newText) || newText.length === 0) {
    return res.status(400).json({ message: "Niz new_text ne smije biti prazan!" });
  }
  if (newText.some((text) => String(text).length > 10000)) {
    return res.status(400).json({ message: "Linija je preduga." });
  }

  const k = keyLine(scenarioId, lineId);
  const owner = lockedLineOwner.get(k);

  if (!owner) return res.status(409).json({ message: "Linija nije zakljucana!" });
  if (owner !== userId) return res.status(409).json({ message: "Linija je vec zakljucana!" });

  const oldNext = line.nextLineId;
  const chunks = flattenNewTextArray(newText);
  const timestamp = nowUnixSeconds();

  try {
    await sequelize.transaction(async (t) => {
      // Update postojeće linije
      line.text = chunks[0];

      let createdLines = [];

      if (chunks.length > 1) {
        let nextId = await dbNextLineIdValue(scenarioId);

        // Prva nova linija će postati next od originalne
        const firstNewLineId = nextId;

        // originalna linija sada pokazuje na prvu novu
        line.nextLineId = firstNewLineId;

        // kreiraj nove linije (sa pravilnim nextLineId)
        for (let i = 1; i < chunks.length; i++) {
          const thisLineId = nextId++;
          const nextLineIdValue = i === chunks.length - 1 ? oldNext : thisLineId + 1;

          createdLines.push({
            scenarioId,
            lineId: thisLineId,
            nextLineId: nextLineIdValue,
            text: chunks[i]
          });
        }

        await Line.bulkCreate(createdLines, { transaction: t });
      }

      // ako nema novih chunkova, nextLineId ostaje isti (oldNext)
      if (chunks.length === 1) {
        line.nextLineId = oldNext;
      }

      await line.save({ transaction: t });

      // Delta za prvu liniju (promijenjenu)
      await Delta.create(
        {
          scenarioId,
          type: "line_update",
          lineId: line.lineId,
          nextLineId: line.nextLineId,
          content: line.text,
          timestamp
        },
        { transaction: t }
      );

      // Delta za sve novokreirane linije (ako ih ima)
      if (createdLines.length > 0) {
        await Delta.bulkCreate(
          createdLines.map((l) => ({
            scenarioId,
            type: "line_update",
            lineId: l.lineId,
            nextLineId: l.nextLineId,
            content: l.text,
            timestamp
          })),
          { transaction: t }
        );
      }
    });
  } catch (e) {
    return res.status(500).json({ message: "Greska na serveru!" });
  }

  // otključaj liniju
  lockedLineOwner.delete(k);
  const prev = lockedLineByUser.get(userId);
  if (prev && prev.scenarioId === scenarioId && prev.lineId === lineId) {
    lockedLineByUser.delete(userId);
  }

  return res.status(200).json({ message: "Linija je uspjesno azurirana!" });
});

// POST /api/scenarios/:scenarioId/characters/lock
app.post("/api/scenarios/:scenarioId/characters/lock", requireAuth, async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const userId = currentUserId(req);
  const characterName = String(req.body?.characterName ?? "");

  const scenario = await findEditableScenario(scenarioId, userId);
  if (!scenario) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  if (!lockedCharacterOwner.has(scenarioId)) {
    lockedCharacterOwner.set(scenarioId, new Map());
  }
  const map = lockedCharacterOwner.get(scenarioId);

  const owner = map.get(characterName);
  if (owner && owner !== userId) {
    return res.status(409).json({ message: "Konflikt! Ime lika je vec zakljucano!" });
  }

  map.set(characterName, userId);
  return res.status(200).json({ message: "Ime lika je uspjesno zakljucano!" });
});

// POST /api/scenarios/:scenarioId/characters/update
app.post("/api/scenarios/:scenarioId/characters/update", requireAuth, async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const userId = currentUserId(req);
  const oldName = String(req.body?.oldName ?? "");
  const newName = String(req.body?.newName ?? "");

  const scenario = await findEditableScenario(scenarioId, userId);
  if (!scenario) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  const map = lockedCharacterOwner.get(scenarioId) || new Map();
  const owner = map.get(oldName);

  // mora biti zaključano od tog usera
  if (!owner || owner !== userId) {
    return res.status(409).json({ message: "Konflikt! Ime lika nije zakljucano!" });
  }

  const re = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");

  // konflikt ako bilo koja linija koja sadrži oldName je zaključana od drugog usera
  const lines = await dbGetLines(scenarioId);
  for (const l of lines) {
    if (re.test(l.text)) {
      const lk = keyLine(scenarioId, l.lineId);
      const lineOwner = lockedLineOwner.get(lk);
      if (lineOwner && lineOwner !== userId) {
        return res.status(409).json({
          message: "Konflikt! Neke linije su zakljucane od drugog korisnika."
        });
      }
    }
    re.lastIndex = 0;
  }

  const timestamp = nowUnixSeconds();

  try {
    await sequelize.transaction(async (t) => {
      // rename svuda u tekstu
      for (const l of lines) {
        re.lastIndex = 0;
        if (!re.test(l.text)) continue;

        const newText = l.text.replace(re, newName);
        await Line.update(
          { text: newText },
          { where: { scenarioId, lineId: l.lineId }, transaction: t }
        );
      }

      await Delta.create(
        { scenarioId, type: "char_rename", oldName, newName, timestamp },
        { transaction: t }
      );
    });
  } catch (e) {
    return res.status(500).json({ message: "Greska na serveru!" });
  }

  // otključaj ime
  map.delete(oldName);
  lockedCharacterOwner.set(scenarioId, map);

  return res.status(200).json({ message: "Ime lika je uspjesno promijenjeno!" });
});

// GET /api/scenarios/:scenarioId/deltas?since=
app.get("/api/scenarios/:scenarioId/deltas", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const since = Number(req.query.since ?? 0);

  const scenario = await findAccessibleScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const deltas = await Delta.findAll({
    where: {
      scenarioId,
      timestamp: { [Op.gt]: since }
    },
    order: [["timestamp", "ASC"], ["id", "ASC"]]
  });

  return res.status(200).json({ deltas: deltas.map((d) => d.get({ plain: true })) });
});

// GET /api/scenarios/:scenarioId
app.get("/api/scenarios/:scenarioId", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const userId = currentUserId(req);

  const scenario = await findAccessibleScenario(scenarioId, userId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const lines = await dbGetLines(scenarioId);
  const ordered = getOrderedContent(
    lines.map((l) => ({ lineId: l.lineId, nextLineId: l.nextLineId, text: l.text }))
  );

  return res.status(200).json({
    id: scenario.id,
    title: scenario.title,
    isDemo: scenario.isDemo,
    canEdit: Boolean(userId && scenario.ownerId === userId && !scenario.isDemo),
    content: ordered
  });
});

// =================== VERZIJE SCENARIJA ===================

// POST /api/scenarios/:scenarioId/checkpoint
app.post("/api/scenarios/:scenarioId/checkpoint", requireAuth, async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);

  const scenario = await findEditableScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  await Checkpoint.create({ scenarioId, timestamp: nowUnixSeconds() });

  return res.status(200).json({ message: "Checkpoint je uspjesno kreiran!" });
});

// GET /api/scenarios/:scenarioId/checkpoints
app.get("/api/scenarios/:scenarioId/checkpoints", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);

  const scenario = await findAccessibleScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const cps = await Checkpoint.findAll({
    where: { scenarioId },
    order: [["timestamp", "ASC"], ["id", "ASC"]]
  });

  return res.status(200).json(cps.map((c) => ({ id: c.id, timestamp: c.timestamp })));
});

// GET /api/scenarios/:scenarioId/restore/:checkpointId
app.get("/api/scenarios/:scenarioId/restore/:checkpointId", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const checkpointId = Number(req.params.checkpointId);

  const scenario = await findAccessibleScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const checkpoint = await Checkpoint.findOne({ where: { id: checkpointId, scenarioId } });
  if (!checkpoint) return res.status(404).json({ message: "Checkpoint ne postoji!" });

  const checkpointTs = Number(checkpoint.timestamp);

  // Baseline: stanje nakon kreiranja scenarija
  let baseline = [];
  try {
    baseline = JSON.parse(scenario.initialSnapshot || "[]");
  } catch {
    baseline = [];
  }

  // map lineId -> { lineId, nextLineId, text }
  const map = new Map();
  for (const l of baseline) {
    map.set(Number(l.lineId), {
      lineId: Number(l.lineId),
      nextLineId: l.nextLineId === null ? null : Number(l.nextLineId),
      text: String(l.text ?? "")
    });
  }

  const deltas = await Delta.findAll({
    where: {
      scenarioId,
      timestamp: { [Op.lte]: checkpointTs }
    },
    order: [["timestamp", "ASC"], ["id", "ASC"]]
  });

  for (const d of deltas) {
    const delta = d.get({ plain: true });

    if (delta.type === "line_update") {
      const lid = Number(delta.lineId);
      map.set(lid, {
        lineId: lid,
        nextLineId: delta.nextLineId === null ? null : Number(delta.nextLineId),
        text: String(delta.content ?? "")
      });
    } else if (delta.type === "char_rename") {
      const oldName = String(delta.oldName ?? "");
      const newName = String(delta.newName ?? "");
      if (!oldName) continue;

      const re = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");

      for (const [lid, lineObj] of map.entries()) {
        re.lastIndex = 0;
        if (!re.test(lineObj.text)) continue;
        map.set(lid, { ...lineObj, text: lineObj.text.replace(re, newName) });
      }
    }
  }

  const contentArr = Array.from(map.values());
  const ordered = getOrderedContent(contentArr);

  return res.status(200).json({
    id: scenario.id,
    title: scenario.title,
    content: ordered
  });
});

// =================== START ===================
async function start() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    await runMigrations(sequelize);
    await sessionStore.sync();
    await seedDatabase();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
  } catch (e) {
    console.error("Ne mogu pokrenuti server / bazu:", e);
    process.exit(1);
  }
}

start();
