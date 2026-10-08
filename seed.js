const { Scenario, Line, Delta } = require("./models");

async function seedDatabase() {
  // Scenario 1 (iz tvoje poruke / “njihovi podaci”)
  const scenario1 = {
    id: 1,
    title: "Potraga za izgubljenim ključem",
    content: [
      { lineId: 1, nextLineId: 2, text: "NARATOR: Sunce je polako zalazilo nad starim gradom." },
      { lineId: 2, nextLineId: 3, text: "ALICE: Jesi li siguran da je ključ ostao u biblioteci?" },
      { lineId: 3, nextLineId: 4, text: "BOB: To je posljednje mjesto gdje sam ga vidio prije nego što je pala noć." },
      { lineId: 4, nextLineId: 5, text: "ALICE: Moramo požuriti prije nego što čuvar zaključa glavna vrata." },
      { lineId: 5, nextLineId: 6, text: "BOB: Čekaj, čuješ li taj zvuk iza polica?" },
      { lineId: 6, nextLineId: null, text: "NARATOR: Iz sjene se polako pojavila nepoznata figura." }
    ]
  };

  const deltas = [
    {
      scenarioId: 1,
      type: "line_update",
      lineId: 1,
      nextLineId: 2,
      content: "NARATOR: Sunce je polako zalazilo nad starim gradom.",
      timestamp: 1736520000
    },
    {
      scenarioId: 1,
      type: "line_update",
      lineId: 2,
      nextLineId: 3,
      content: "ALICE: Jesi li siguran da je ključ ostao u biblioteci?",
      timestamp: 1736520010
    },
    {
      scenarioId: 1,
      type: "line_update",
      lineId: 3,
      nextLineId: 4,
      content: "BOB: To je posljednje mjesto gdje sam ga vidio prije nego što je pala noć.",
      timestamp: 1736520020
    },
    {
      scenarioId: 1,
      type: "line_update",
      lineId: 4,
      nextLineId: 5,
      content: "ALICE: Moramo požuriti prije nego što čuvar zaključa glavna vrata.",
      timestamp: 1736520030
    },
    {
      scenarioId: 1,
      type: "line_update",
      lineId: 5,
      nextLineId: 6,
      content: "BOB: Čekaj, čuješ li taj zvuk iza polica?",
      timestamp: 1736520040
    },
    {
      scenarioId: 1,
      type: "line_update",
      lineId: 6,
      nextLineId: null,
      content: "NARATOR: Iz sjene se polako pojavila nepoznata figura.",
      timestamp: 1736520050
    },
    {
      scenarioId: 1,
      type: "char_rename",
      oldName: "BOB",
      newName: "ROBERT",
      timestamp: 1736520100
    }
  ];

  // Kreiraj scenario 1 (sa initialSnapshot baseline)
  const createdScenario = await Scenario.create({
    title: scenario1.title,
    initialSnapshot: JSON.stringify(scenario1.content)
  });

  const scenarioId = createdScenario.id;

  // Kreiraj linije
  await Line.bulkCreate(
    scenario1.content.map((l) => ({
      scenarioId,
      lineId: l.lineId,
      nextLineId: l.nextLineId,
      text: l.text
    }))
  );

  // Kreiraj delte
  await Delta.bulkCreate(
    deltas.map((delta) => ({
      ...delta,
      scenarioId
    }))
  );
}

module.exports = { seedDatabase };
