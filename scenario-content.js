const { Op } = require("sequelize");
const { Scenario, Line } = require("./models");

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function keyLine(scenarioId, lineId) {
  return `${scenarioId}:${lineId}`;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

async function findEditableScenario(scenarioId, userId, options = {}) {
  if (!userId) return null;
  return Scenario.findOne({
    where: { id: scenarioId, ownerId: userId, isDemo: false },
    ...options
  });
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

async function dbGetLines(scenarioId, options = {}) {
  const lines = await Line.findAll({
    where: { scenarioId },
    order: [["lineId", "ASC"]],
    ...options
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

module.exports = {
  nowUnixSeconds, keyLine, escapeRegExp, findAccessibleScenario,
  findEditableScenario, flattenNewTextArray, getOrderedContent,
  dbGetLines, dbGetLineOrNull, dbNextLineIdValue
};
