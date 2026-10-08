const { Scenario, Line, Delta } = require("./models");

const demoScenarios = [
  {
    seedKey: "lost-key",
    legacyTitle: "Potraga za izgubljenim ključem",
    title: "Potraga za izgubljenim ključem",
    content: [
      "EXT. STARI GRAD - EVENING",
      "Sunce polako nestaje iza krovova, a ulične lampe trepere jedna po jedna.",
      "ALICE",
      "Jesi li siguran da je ključ ostao u biblioteci?",
      "BOB",
      "To je posljednje mjesto gdje sam ga vidio prije nego što je pala noć.",
      "ALICE",
      "Moramo požuriti prije nego što čuvar zaključa glavna vrata.",
      "INT. GRADSKA BIBLIOTEKA - NIGHT",
      "Između visokih polica vlada tišina. Negdje u mraku pada knjiga.",
      "BOB",
      "Čekaj. Jesi li čula taj zvuk?",
      "Iz sjene se polako pojavljuje nepoznata figura."
    ]
  },
  {
    seedKey: "last-screening",
    title: "Posljednja projekcija",
    content: [
      "INT. KINO IMPERIJAL - NIGHT",
      "Prašina pleše u snopu projektora. U praznoj sali gori samo jedno crveno svjetlo.",
      "EMA",
      "Rekao si da je ova traka izgubljena prije trideset godina.",
      "VIKTOR",
      "Bila je. Sve do jutros.",
      "Ema podiže metalnu kutiju. Na poklopcu je njeno prezime ispisano izblijedjelom tintom.",
      "EMA",
      "Moj otac nikada nije radio u kinu.",
      "VIKTOR",
      "Onda ćeš možda htjeti sjesti prije nego što film počne.",
      "Projektor se sam pokreće. Na platnu se pojavljuje kuća koju Ema prepoznaje iz djetinjstva."
    ]
  },
  {
    seedKey: "night-shift",
    title: "Noćna smjena",
    content: [
      "INT. BOLNIČKI HODNIK - NIGHT",
      "Digitalni sat pokazuje 03:17. Lift se otvara, ali u njemu nema nikoga.",
      "LEJLA",
      "Treći put večeras.",
      "MARKO",
      "Stari senzor. Sutra ću prijaviti održavanju.",
      "Iz lifta dopire tih zvuk bolničkog monitora.",
      "LEJLA",
      "Na ovom spratu nema monitora koji tako zvuči.",
      "INT. LIFT - CONTINUOUS",
      "Lejla zakorači unutra. Na kontrolnoj ploči svijetli dugme za sprat koji ne postoji.",
      "MARKO",
      "Ne diraj to.",
      "Vrata se zatvaraju prije nego što se Lejla stigne okrenuti."
    ]
  },
  {
    seedKey: "signal-over-city",
    title: "Signal iznad grada",
    content: [
      "EXT. KROV RADIO-STANICE - DAWN",
      "Grad je još u mraku. Iznad antena lebdi pravilna linija bijelih svjetala.",
      "ARMIN",
      "Signal se ponavlja svakih četrdeset sedam sekundi.",
      "SARA",
      "Satelit?",
      "ARMIN",
      "Sateliti ne odgovaraju kada im postaviš pitanje.",
      "Sara stavlja slušalice. Kroz statiku se čuje njen vlastiti glas.",
      "SARA",
      "To je snimak od sutra.",
      "INT. RADIO-STANICA - MOMENTS LATER",
      "Svi ekrani odjednom prikazuju istu poruku: NE ODGOVARAJTE DRUGI PUT.",
      "Armin pogleda prema mikrofonu. Crveno svjetlo već gori."
    ]
  }
];

function toLinkedContent(lines) {
  return lines.map((text, index) => ({
    lineId: index + 1,
    nextLineId: index === lines.length - 1 ? null : index + 2,
    text
  }));
}

async function createDemoScenario(definition) {
  const content = toLinkedContent(definition.content);
  const scenario = await Scenario.create({
    title: definition.title,
    ownerId: null,
    isDemo: true,
    seedKey: definition.seedKey,
    initialSnapshot: JSON.stringify(content)
  });

  await Line.bulkCreate(content.map((line) => ({ ...line, scenarioId: scenario.id })));

  const timestamp = Math.floor(Date.now() / 1000);
  await Delta.bulkCreate(
    content.map((line, index) => ({
      scenarioId: scenario.id,
      type: "line_update",
      lineId: line.lineId,
      nextLineId: line.nextLineId,
      content: line.text,
      timestamp: timestamp + index
    }))
  );

  return scenario;
}

async function seedDatabase() {
  const seeded = [];

  for (const definition of demoScenarios) {
    let scenario = await Scenario.findOne({ where: { seedKey: definition.seedKey } });

    if (!scenario && definition.legacyTitle) {
      scenario = await Scenario.findOne({
        where: { title: definition.legacyTitle, ownerId: null }
      });

      if (scenario) {
        scenario.isDemo = true;
        scenario.seedKey = definition.seedKey;
        await scenario.save();
      }
    }

    if (!scenario) scenario = await createDemoScenario(definition);
    seeded.push(scenario);
  }

  return seeded;
}

module.exports = { demoScenarios, seedDatabase };
