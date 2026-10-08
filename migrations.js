const { DataTypes } = require("sequelize");

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const table = await queryInterface.describeTable(tableName);
    return Boolean(table[columnName]);
  } catch {
    return false;
  }
}

async function runMigrations(sequelize) {
  const queryInterface = sequelize.getQueryInterface();

  if (!(await columnExists(queryInterface, "Scenario", "ownerId"))) {
    await queryInterface.addColumn("Scenario", "ownerId", {
      type: DataTypes.INTEGER,
      allowNull: true
    });
  }

  if (!(await columnExists(queryInterface, "Scenario", "isDemo"))) {
    await queryInterface.addColumn("Scenario", "isDemo", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  }

  if (!(await columnExists(queryInterface, "Scenario", "seedKey"))) {
    await queryInterface.addColumn("Scenario", "seedKey", {
      type: DataTypes.STRING(80),
      allowNull: true
    });
  }
}

module.exports = { runMigrations };
