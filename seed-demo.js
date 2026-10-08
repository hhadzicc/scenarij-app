const { sequelize } = require("./models");
const { runMigrations } = require("./migrations");
const { seedDatabase } = require("./seed");

async function run() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    await runMigrations(sequelize);
    const scenarios = await seedDatabase();
    console.log(`Demo podaci su spremni (${scenarios.length} scenarija).`);
  } finally {
    await sequelize.close();
  }
}

run().catch((error) => {
  console.error("Demo podaci nisu dodani:", error.message);
  process.exitCode = 1;
});
