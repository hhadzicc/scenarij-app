const express = require("express");
const path = require("path");

const { sequelize, Scenario, Line, Delta, Checkpoint } = require("./models");
const { seedDatabase } = require("./seed");

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await sequelize.authenticate();
    return res.status(200).json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "unavailable" });
  }
});

// Static i homepage
app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "writing.html"));
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

// =================== RUTE (S3) ===================

// POST /api/scenarios
app.post("/api/scenarios", async (req, res) => {
  const titleRaw = req.body?.title;
  const title =
    typeof titleRaw === "string" && titleRaw.trim() !== ""
      ? titleRaw.trim()
      : "Neimenovani scenarij";

  // Kreiraj scenario
  const sc = await Scenario.create({
    title,
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

// POST /api/scenarios/:scenarioId/lines/:lineId/lock
app.post("/api/scenarios/:scenarioId/lines/:lineId/lock", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const lineId = Number(req.params.lineId);
  const userId = Number(req.body?.userId);

  const scenario = await dbGetScenarioOrNull(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

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
app.put("/api/scenarios/:scenarioId/lines/:lineId", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const lineId = Number(req.params.lineId);
  const userId = Number(req.body?.userId);
  const newText = req.body?.newText;

  const scenario = await dbGetScenarioOrNull(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const line = await dbGetLineOrNull(scenarioId, lineId);
  if (!line) return res.status(404).json({ message: "Linija ne postoji!" });

  if (!Array.isArray(newText) || newText.length === 0) {
    return res.status(400).json({ message: "Niz new_text ne smije biti prazan!" });
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
app.post("/api/scenarios/:scenarioId/characters/lock", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const userId = Number(req.body?.userId);
  const characterName = String(req.body?.characterName ?? "");

  const scenario = await dbGetScenarioOrNull(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

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
app.post("/api/scenarios/:scenarioId/characters/update", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const userId = Number(req.body?.userId);
  const oldName = String(req.body?.oldName ?? "");
  const newName = String(req.body?.newName ?? "");

  const scenario = await dbGetScenarioOrNull(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

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

  const scenario = await dbGetScenarioOrNull(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const deltas = await Delta.findAll({
    where: {
      scenarioId,
      timestamp: { [require("sequelize").Op.gt]: since }
    },
    order: [["timestamp", "ASC"], ["id", "ASC"]]
  });

  return res.status(200).json({ deltas: deltas.map((d) => d.get({ plain: true })) });
});

// GET /api/scenarios/:scenarioId
app.get("/api/scenarios/:scenarioId", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);

  const scenario = await dbGetScenarioOrNull(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const lines = await dbGetLines(scenarioId);
  const ordered = getOrderedContent(
    lines.map((l) => ({ lineId: l.lineId, nextLineId: l.nextLineId, text: l.text }))
  );

  return res.status(200).json({
    id: scenario.id,
    title: scenario.title,
    content: ordered
  });
});

// =================== RUTE (S4) ===================

// POST /api/scenarios/:scenarioId/checkpoint
app.post("/api/scenarios/:scenarioId/checkpoint", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);

  const scenario = await dbGetScenarioOrNull(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  await Checkpoint.create({ scenarioId, timestamp: nowUnixSeconds() });

  return res.status(200).json({ message: "Checkpoint je uspjesno kreiran!" });
});

// GET /api/scenarios/:scenarioId/checkpoints
app.get("/api/scenarios/:scenarioId/checkpoints", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);

  const scenario = await dbGetScenarioOrNull(scenarioId);
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

  const scenario = await Scenario.findByPk(scenarioId);
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
      timestamp: { [require("sequelize").Op.lte]: checkpointTs }
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

    if (await Scenario.count() === 0) {
      await seedDatabase();
    }

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
  } catch (e) {
    console.error("Ne mogu pokrenuti server / bazu:", e);
    process.exit(1);
  }
}

start();
