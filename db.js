const { Sequelize } = require("sequelize");

const sequelize = new Sequelize("wt26", "root", "password", {
  host: "localhost",
  dialect: "mysql",
  logging: false
});

module.exports = sequelize;
