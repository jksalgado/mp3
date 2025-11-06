// routes/_utils.js
function safeJsonParse(str, fallback = {}) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

function buildMongooseQuery(req, Model, defaultLimit) {
  // Accept both ?select= and ?filter= because db scripts use "filter"
  const where = safeJsonParse(req.query.where);
  const sort = safeJsonParse(req.query.sort);
  const selectRaw = req.query.select || req.query.filter; // alias
  const select = safeJsonParse(selectRaw, typeof selectRaw === 'string' ? {} : undefined);

  let skip = parseInt(req.query.skip, 10);
  if (Number.isNaN(skip) || skip < 0) skip = undefined;

  let limit = parseInt(req.query.limit, 10);
  if (Number.isNaN(limit) || limit <= 0) limit = defaultLimit;

  let q = Model.find(where || {});
  if (sort) q = q.sort(sort);
  if (select && Object.keys(select).length) q = q.select(select);
  if (typeof skip === 'number') q = q.skip(skip);
  if (typeof limit === 'number') q = q.limit(limit);

  return { q, where, sort, select, skip, limit };
}

function ok(res, data, code = 200, message = 'OK') {
  return res.status(code).json({ message, data });
}

function fail(res, code, message, data = null) {
  // Avoid leaking raw Mongoose errors
  return res.status(code).json({ message, data });
}

module.exports = { safeJsonParse, buildMongooseQuery, ok, fail };
