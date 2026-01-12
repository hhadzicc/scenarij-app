const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "writing.html"));
});


const DATA_DIR = path.join(__dirname, "data");
const SCENARIOS_DIR = path.join(DATA_DIR, "scenarios");
const DELTAS_FILE = path.join(DATA_DIR, "deltas.json");

// =================== LOCKOVI U RAM-U ===================
// user može imati samo 1 zaključanu liniju globalno
const lockedLineByUser = new Map(); // userId -> { scenarioId, lineId }
const lockedLineOwner = new Map();  // "scenarioId:lineId" -> userId

// zaključavanje imena likova po scenariju
const lockedCharacterOwner = new Map(); // scenarioId -> Map(characterName -> userId)

// =================== HELPERS ===================
async function ensureDataLayout() {
  await fs.mkdir(SCENARIOS_DIR, { recursive: true });
  try {
    await fs.access(DELTAS_FILE);
  } catch {
    await fs.writeFile(DELTAS_FILE, JSON.stringify([], null, 2), "utf-8");
  }
}

function scenarioPath(id) {
  return path.join(SCENARIOS_DIR, `scenario-${id}.json`);
}

async function readScenario(id) {
  try {
    const raw = await fs.readFile(scenarioPath(id), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeScenario(scenario) {
  await fs.writeFile(scenarioPath(scenario.id), JSON.stringify(scenario, null, 2), "utf-8");
}

async function readDeltas() {
  const raw = await fs.readFile(DELTAS_FILE, "utf-8");
  return JSON.parse(raw);
}

async function appendDelta(delta) {
  const deltas = await readDeltas();
  deltas.push(delta);
  await fs.writeFile(DELTAS_FILE, JSON.stringify(deltas, null, 2), "utf-8");
}

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function keyLine(scenarioId, lineId) {
  return `${scenarioId}:${lineId}`;
}

function findLine(scenario, lineId) {
  return scenario.content.find(l => l.lineId === lineId) || null;
}

function nextLineIdValue(scenario) {
  let maxId = 0;
  for (const l of scenario.content) maxId = Math.max(maxId, l.lineId);
  return maxId + 1;
}
/*
function splitIntoWords(text) {
  if (text === null || text === undefined) return [];
  return String(text).split(/[\s,.]+/).filter(Boolean);
}


function wrap20Words(text) {
  const words = splitIntoWords(text);
  if (words.length === 0) return [""];
  const out = [];
  for (let i = 0; i < words.length; i += 20) {
    out.push(words.slice(i, i + 20).join(" "));
  }
  return out;
}*/


// Separatori riječi: razmak/tab/newline + zarez + tačka
function isSeparator(ch) {
  return /[ \t\r\n,.]/.test(ch);
}

// Riječ se broji samo ako token ima bar jedno slovo 
function tokenHasLetter(token) {
  return /[A-Za-zČĆŽŠĐčćžšđ]/.test(token);
}

// Wrap jednog stringa na maxWords riječi, ali NE uklanja interpunkciju/spacije.
// Vraća niz segmenata (linija).
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
      segments.push(seg);
      seg = "";
      wordCount = 0;
    }

    seg += token;
    if (countsAsWord) wordCount++;

    i = j;
  }

  segments.push(seg);
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

  const map = new Map(content.map(l => [l.lineId, l]));
  const pointed = new Set(content.map(l => l.nextLineId).filter(x => x !== null));

  let head = content.find(l => !pointed.has(l.lineId));
  if (!head) head = content[0];

  const ordered = [];
  const visited = new Set();
  let cur = head;

  while (cur && !visited.has(cur.lineId)) {
    visited.add(cur.lineId);
    ordered.push(cur);
    cur = (cur.nextLineId === null) ? null : map.get(cur.nextLineId);
  }
  return ordered;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =================== RUTE ===================

// POST /api/scenarios
// kreira novi scenario (title default ako prazan) i content sa jednom praznom linijom (lineId:1)
app.post("/api/scenarios", async (req, res) => {
  const titleRaw = req.body?.title;
  const title = (typeof titleRaw === "string" && titleRaw.trim() !== "")
    ? titleRaw.trim()
    : "Neimenovani scenarij";

  // novi id = max + 1
  let newId = 1;
  try {
    const files = await fs.readdir(SCENARIOS_DIR);
    const ids = files
      .map(f => (f.match(/^scenario-(\d+)\.json$/) || [])[1])
      .filter(Boolean)
      .map(Number);
    if (ids.length > 0) newId = Math.max(...ids) + 1;
  } catch {}

  const scenario = {
    id: newId,
    title,
    content: [{ lineId: 1, nextLineId: null, text: "" }]
  };

  await writeScenario(scenario);
  return res.status(200).json(scenario);
});

// POST /api/scenarios/:scenarioId/lines/:lineId/lock
app.post("/api/scenarios/:scenarioId/lines/:lineId/lock", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const lineId = Number(req.params.lineId);
  const userId = Number(req.body?.userId);

  const scenario = await readScenario(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const line = findLine(scenario, lineId);
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

  const scenario = await readScenario(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const line = findLine(scenario, lineId);
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

  // Update postojeće linije
  line.text = chunks[0];

  // Ako ima više chunkova -> insert novih linija iza trenutne
  const createdLineIds = [];
  if (chunks.length > 1) {
    let nextId = nextLineIdValue(scenario);
    let prevLine = line;

    for (let i = 1; i < chunks.length; i++) {
      const newLineId = nextId++;
      const newLine = { lineId: newLineId, nextLineId: null, text: chunks[i] };
      scenario.content.push(newLine);
      createdLineIds.push(newLineId);

      prevLine.nextLineId = newLineId;
      prevLine = newLine;
    }

    // zadnja nova linija pokazuje na stari nextLineId
    prevLine.nextLineId = oldNext;
  }

  await writeScenario(scenario);

  await appendDelta({
    scenarioId,
    type: "line_update",
    lineId: line.lineId,
    nextLineId: line.nextLineId,
    content: line.text,
    timestamp
  });

  for (const cid of createdLineIds) {
    const l = findLine(scenario, cid);
    await appendDelta({
      scenarioId,
      type: "line_update",
      lineId: l.lineId,
      nextLineId: l.nextLineId,
      content: l.text,
      timestamp
    });
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

  const scenario = await readScenario(scenarioId);
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

  const scenario = await readScenario(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const map = lockedCharacterOwner.get(scenarioId) || new Map();
  const owner = map.get(oldName);

  // mora biti zaključano od tog usera
  if (!owner || owner !== userId) {
    return res.status(409).json({ message: "Konflikt! Ime lika nije zakljucano!" });
  }

  // konflikt ako bilo koja linija koja sadrži oldName je zaključana od drugog usera
  const re = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");

  for (const l of scenario.content) {
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

  // rename svuda
  for (const l of scenario.content) {
    l.text = l.text.replace(re, newName);
  }

  await writeScenario(scenario);

  const timestamp = nowUnixSeconds();
  await appendDelta({
    scenarioId,
    type: "char_rename",
    oldName,
    newName,
    timestamp
  });

  // otključaj ime
  map.delete(oldName);
  lockedCharacterOwner.set(scenarioId, map);

  return res.status(200).json({ message: "Ime lika je uspjesno promijenjeno!" });
});

// GET /api/scenarios/:scenarioId/deltas?since=
app.get("/api/scenarios/:scenarioId/deltas", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const since = Number(req.query.since ?? 0);

  const scenario = await readScenario(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const deltas = await readDeltas();
  const filtered = deltas
    .filter(d => Number(d.scenarioId) === scenarioId && Number(d.timestamp) > since)
    .sort((a, b) => a.timestamp - b.timestamp);

  return res.status(200).json({ deltas: filtered });
});

// GET /api/scenarios/:scenarioId
app.get("/api/scenarios/:scenarioId", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);

  const scenario = await readScenario(scenarioId);
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const ordered = getOrderedContent(scenario.content);
  return res.status(200).json({ ...scenario, content: ordered });
});

// =================== START ===================
ensureDataLayout().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));
});
