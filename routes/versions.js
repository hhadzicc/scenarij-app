const express = require("express");
const { Op, Transaction } = require("sequelize");
const { sequelize, Checkpoint, Delta } = require("../models");
const { asyncRoute, currentUserId, requireAuth } = require("../middleware");
const {
  nowUnixSeconds, escapeRegExp, findAccessibleScenario,
  findEditableScenario, getOrderedContent, dbGetLines
} = require("../scenario-content");

const router = express.Router();

// POST /api/scenarios/:scenarioId/checkpoint
router.post("/api/scenarios/:scenarioId/checkpoint", requireAuth, asyncRoute(async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);

  const checkpoint = await sequelize.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
    async (transaction) => {
      const scenario = await findEditableScenario(scenarioId, currentUserId(req), { transaction });
      if (!scenario) return null;

      const content = getOrderedContent(await dbGetLines(scenarioId, { transaction }))
        .map(({ lineId, nextLineId, text }) => ({ lineId, nextLineId, text }));
      return Checkpoint.create({
        scenarioId,
        timestamp: nowUnixSeconds(),
        snapshot: JSON.stringify({ title: scenario.title, content })
      }, { transaction });
    }
  );
  if (!checkpoint) return res.status(403).json({ message: "Ovaj scenarij možeš samo pregledati." });

  return res.status(200).json({ message: "Checkpoint je uspjesno kreiran!" });
}));

// GET /api/scenarios/:scenarioId/checkpoints
router.get("/api/scenarios/:scenarioId/checkpoints", asyncRoute(async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);

  const scenario = await findAccessibleScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const cps = await Checkpoint.findAll({
    where: { scenarioId },
    order: [["timestamp", "ASC"], ["id", "ASC"]]
  });

  return res.status(200).json(cps.map((c) => ({ id: c.id, timestamp: c.timestamp })));
}));

// GET /api/scenarios/:scenarioId/restore/:checkpointId
router.get("/api/scenarios/:scenarioId/restore/:checkpointId", asyncRoute(async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const checkpointId = Number(req.params.checkpointId);

  const scenario = await findAccessibleScenario(scenarioId, currentUserId(req));
  if (!scenario) return res.status(404).json({ message: "Scenario ne postoji!" });

  const checkpoint = await Checkpoint.findOne({ where: { id: checkpointId, scenarioId } });
  if (!checkpoint) return res.status(404).json({ message: "Checkpoint ne postoji!" });

  if (checkpoint.snapshot !== null) {
    const snapshot = JSON.parse(checkpoint.snapshot);
    return res.status(200).json({ id: scenario.id, title: snapshot.title, content: snapshot.content });
  }

  // Older checkpoints retain their timestamp-based reconstruction.
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
}));

module.exports = router;
