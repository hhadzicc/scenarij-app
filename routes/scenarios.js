const express = require("express");
const { Op } = require("sequelize");
const { sequelize, Scenario, Line, Delta } = require("../models");
const { asyncRoute, currentUserId, requireAuth } = require("../middleware");
const {
  nowUnixSeconds, keyLine, escapeRegExp, findAccessibleScenario,
  findEditableScenario, flattenNewTextArray, getOrderedContent,
  dbGetLines, dbGetLineOrNull, dbNextLineIdValue
} = require("../scenario-content");

const router = express.Router();

// =================== LOCKOVI U RAM-U ===================
// user može imati samo 1 zaključanu liniju globalno
const lockedLineByUser = new Map(); // userId -> { scenarioId, lineId }
const lockedLineOwner = new Map();  // "scenarioId:lineId" -> userId

// zaključavanje imena likova po scenariju
const lockedCharacterOwner = new Map(); // scenarioId -> Map(characterName -> userId)

// GET /api/scenarios
router.get("/api/scenarios", asyncRoute(async (req, res) => {
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
}));

// POST /api/scenarios
router.post("/api/scenarios", requireAuth, asyncRoute(async (req, res) => {
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
}));

// POST /api/scenarios/:scenarioId/duplicate
router.post("/api/scenarios/:scenarioId/duplicate", requireAuth, asyncRoute(async (req, res) => {
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
}));

// PATCH /api/scenarios/:scenarioId
router.patch("/api/scenarios/:scenarioId", requireAuth, asyncRoute(async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const title = String(req.body?.title ?? "").trim();

  if (!title) return res.status(400).json({ message: "Naslov je obavezan." });

  const scenario = await findEditableScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  scenario.title = title.slice(0, 160);
  await scenario.save();

  return res.status(200).json({ id: scenario.id, title: scenario.title });
}));

// POST /api/scenarios/:scenarioId/lines
router.post("/api/scenarios/:scenarioId/lines", requireAuth, asyncRoute(async (req, res) => {
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
}));

// POST /api/scenarios/:scenarioId/lines/:lineId/lock
router.post("/api/scenarios/:scenarioId/lines/:lineId/lock", requireAuth, asyncRoute(async (req, res) => {
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
}));

// PUT /api/scenarios/:scenarioId/lines/:lineId
router.put("/api/scenarios/:scenarioId/lines/:lineId", requireAuth, asyncRoute(async (req, res) => {
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
  // Autosave preserves the edited line so later keystrokes cannot duplicate split chunks.
  const chunks = req.body?.preserveLine === true
    ? newText.map(String)
    : flattenNewTextArray(newText);
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
}));

// POST /api/scenarios/:scenarioId/characters/lock
router.post("/api/scenarios/:scenarioId/characters/lock", requireAuth, asyncRoute(async (req, res) => {
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
}));

// POST /api/scenarios/:scenarioId/characters/update
router.post("/api/scenarios/:scenarioId/characters/update", requireAuth, asyncRoute(async (req, res) => {
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
}));

// GET /api/scenarios/:scenarioId/deltas?since=
router.get("/api/scenarios/:scenarioId/deltas", asyncRoute(async (req, res) => {
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
}));

// GET /api/scenarios/:scenarioId
router.get("/api/scenarios/:scenarioId", asyncRoute(async (req, res) => {
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
}));

module.exports = router;
