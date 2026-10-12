function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve().then(() => handler(req, res, next)).catch(next);
  };
}

function currentUserId(req) {
  const userId = Number(req.session?.userId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function requireAuth(req, res, next) {
  if (!currentUserId(req)) {
    return res.status(401).json({ message: "Prijavi se da nastaviš." });
  }
  return next();
}

module.exports = { asyncRoute, currentUserId, requireAuth };
