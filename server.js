const express = require("express");
const path = require("path");
const session = require("express-session");
const SequelizeStoreFactory = require("connect-session-sequelize");
const helmet = require("helmet");

const { sequelize } = require("./models");
const { runMigrations } = require("./migrations");
const { seedDatabase } = require("./seed");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || "scenarijpro-local-development-only";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required in production.");
}

if (isProduction) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://unpkg.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"]
      }
    }
  })
);
app.use(express.json({ limit: "256kb" }));

const SequelizeStore = SequelizeStoreFactory(session.Store);
const sessionStore = new SequelizeStore({
  db: sequelize,
  tableName: "Session",
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 7 * 24 * 60 * 60 * 1000
});

app.use(
  session({
    name: "scenarij.sid",
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

app.get("/health", async (_req, res) => {
  try {
    await sequelize.authenticate();
    return res.status(200).json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "unavailable" });
  }
});

// Public frontend assets only. Server source, logs and local configuration stay private.
app.use("/css", express.static(path.join(__dirname, "css"), { index: false }));
app.use("/js", express.static(path.join(__dirname, "js"), { index: false }));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "projects.html"));
});
app.get("/editor", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "writing.html"));
});
app.get("/auth", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "auth.html"));
});

app.use(require("./routes/auth"));
app.use(require("./routes/scenarios"));
app.use(require("./routes/versions"));

app.use((error, _req, res, next) => {
  console.error("Request failed:", error);
  if (res.headersSent) return next(error);

  const status = Number(error.status || error.statusCode);
  const clientError = Number.isInteger(status) && status >= 400 && status < 500;
  return res.status(clientError ? status : 500).json({
    message: clientError ? "Neispravan zahtjev." : "Greska na serveru. Pokusaj ponovo."
  });
});

// =================== START ===================
async function start() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    await runMigrations(sequelize);
    await sessionStore.sync();
    await seedDatabase();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
  } catch (e) {
    console.error("Ne mogu pokrenuti server / bazu:", e);
    process.exit(1);
  }
}

start();
