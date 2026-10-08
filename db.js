require("dotenv").config({ quiet: true });

const { Sequelize } = require("sequelize");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required.");
}

const connectionUrl = new URL(databaseUrl);
if (connectionUrl.searchParams.get("sslmode") === "require") {
  connectionUrl.searchParams.set("sslmode", "verify-full");
}

const sequelize = new Sequelize(connectionUrl.toString(), {
  dialect: "postgres",
  logging: false
});

module.exports = sequelize;
