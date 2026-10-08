const { DataTypes } = require("sequelize");
const sequelize = require("./db");

// ============== MODELI ==============

const User = sequelize.define(
  "User",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false }
  },
  {
    tableName: "User",
    freezeTableName: true,
    timestamps: true
  }
);

const Scenario = sequelize.define(
  "Scenario",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING, allowNull: false },

    ownerId: { type: DataTypes.INTEGER, allowNull: true },
    isDemo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    seedKey: { type: DataTypes.STRING(80), allowNull: true },

    // DODATNO (Spirala 4): čuvamo početno stanje scenarija nakon kreiranja
    // da restore može početi od "baseline" stanja
    initialSnapshot: { type: DataTypes.TEXT, allowNull: true }
  },
  {
    tableName: "Scenario",
    freezeTableName: true,
    timestamps: false
  }
);

const Line = sequelize.define(
  "Line",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    lineId: { type: DataTypes.INTEGER, allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    nextLineId: { type: DataTypes.INTEGER, allowNull: true },
    scenarioId: { type: DataTypes.INTEGER, allowNull: false }
  },
  {
    tableName: "Line",
    freezeTableName: true,
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["scenarioId", "lineId"]
      }
    ]
  }
);

const Delta = sequelize.define(
  "Delta",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    scenarioId: { type: DataTypes.INTEGER, allowNull: false },

    type: { type: DataTypes.STRING, allowNull: false }, // "line_update" ili "char_rename"

    lineId: { type: DataTypes.INTEGER, allowNull: true },
    nextLineId: { type: DataTypes.INTEGER, allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: true },

    oldName: { type: DataTypes.STRING, allowNull: true },
    newName: { type: DataTypes.STRING, allowNull: true },

    timestamp: { type: DataTypes.INTEGER, allowNull: false }
  },
  {
    tableName: "Delta",
    freezeTableName: true,
    timestamps: false
  }
);

const Checkpoint = sequelize.define(
  "Checkpoint",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    scenarioId: { type: DataTypes.INTEGER, allowNull: false },
    timestamp: { type: DataTypes.INTEGER, allowNull: false }
  },
  {
    tableName: "Checkpoint",
    freezeTableName: true,
    timestamps: false
  }
);

// ============== RELACIJE ==============

User.hasMany(Scenario, { foreignKey: "ownerId", onDelete: "CASCADE" });
Scenario.belongsTo(User, { foreignKey: "ownerId" });

Scenario.hasMany(Line, { foreignKey: "scenarioId", onDelete: "CASCADE" });
Line.belongsTo(Scenario, { foreignKey: "scenarioId" });

Scenario.hasMany(Delta, { foreignKey: "scenarioId", onDelete: "CASCADE" });
Delta.belongsTo(Scenario, { foreignKey: "scenarioId" });

Scenario.hasMany(Checkpoint, { foreignKey: "scenarioId", onDelete: "CASCADE" });
Checkpoint.belongsTo(Scenario, { foreignKey: "scenarioId" });

module.exports = { sequelize, User, Scenario, Line, Delta, Checkpoint };
