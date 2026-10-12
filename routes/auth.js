const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { User } = require("../models");
const { asyncRoute, currentUserId, requireAuth } = require("../middleware");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Previše pokušaja. Pokušaj ponovo za nekoliko minuta." }
});

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

router.get("/api/auth/me", asyncRoute(async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return res.status(200).json({ user: null });

  const user = await User.findByPk(userId);
  if (!user) {
    await destroySession(req);
    return res.status(200).json({ user: null });
  }

  return res.status(200).json({ user: publicUser(user) });
}));

router.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ message: "Ime mora imati između 2 i 80 znakova." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ message: "Unesi ispravnu email adresu." });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: "Lozinka mora imati najmanje 8 znakova." });
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    return res.status(409).json({ message: "Račun sa ovom email adresom već postoji." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash });
  await regenerateSession(req);
  req.session.userId = user.id;

  return res.status(201).json({ user: publicUser(user) });
}));

router.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const user = await User.findOne({ where: { email } });
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!valid) {
    return res.status(401).json({ message: "Email ili lozinka nisu ispravni." });
  }

  await regenerateSession(req);
  req.session.userId = user.id;
  return res.status(200).json({ user: publicUser(user) });
}));

router.post("/api/auth/logout", requireAuth, asyncRoute(async (req, res) => {
  await destroySession(req);
  res.clearCookie("scenarij.sid");
  return res.status(204).end();
}));

module.exports = router;
