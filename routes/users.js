// routes/users.js
const express = require('express');
const User = require('../models/user');
const Task = require('../models/task');
const { buildMongooseQuery, ok, fail } = require('./_utils');

module.exports = function(router) {
  const r = express.Router();

  // GET /api/users  (with where/sort/select|filter/skip/limit/count)
  r.get('/', async (req, res) => {
    try {
      if (String(req.query.count).toLowerCase() === 'true') {
        const where = buildMongooseQuery(req, User).q.getQuery();
        const count = await User.countDocuments(where);
        return ok(res, count);
      }
      const { q } = buildMongooseQuery(req, User, undefined); // unlimited by default
      const users = await q.exec();
      return ok(res, users);
    } catch (e) {
      return fail(res, 500, 'Internal Server Error');
    }
  });

  // POST /api/users
  r.post('/', async (req, res) => {
    try {
      const { name, email, pendingTasks } = req.body;
      if (!name || !email) return fail(res, 400, 'Name and email are required');

      const user = await User.create({
        name, email,
        pendingTasks: Array.isArray(pendingTasks) ? pendingTasks : []
      });

      // If pendingTasks were provided on create, sync tasks->user
      if (Array.isArray(user.pendingTasks) && user.pendingTasks.length) {
        await Task.updateMany(
          { _id: { $in: user.pendingTasks } },
          { $set: { assignedUser: String(user._id), assignedUserName: user.name } }
        );
      }

      return ok(res, user, 201, 'Created');
    } catch (e) {
      if (e && e.code === 11000) return fail(res, 400, 'Email must be unique');
      return fail(res, 500, 'Internal Server Error');
    }
  });

  // GET /api/users/:id (support ?select= for this endpoint too)
  r.get('/:id', async (req, res) => {
    try {
      const selectRaw = req.query.select || req.query.filter;
      let select = undefined;
      if (selectRaw) {
        try { select = JSON.parse(selectRaw); } catch(_) {}
      }
      const user = await User.findById(req.params.id, select || undefined).exec();
      if (!user) return fail(res, 404, 'User Not Found', 'User not found.');
      return ok(res, user);
    } catch (_) {
      // Treat invalid ObjectId as 404 per FAQ guidance
      return fail(res, 404, 'User Not Found', 'User not found.');
    }
  });

  // PUT /api/users/:id (replace)
  r.put('/:id', async (req, res) => {
    try {
      const { name, email, pendingTasks } = req.body;
      if (!name || !email) return fail(res, 400, 'Name and email are required');

      const user = await User.findById(req.params.id).exec();
      if (!user) return fail(res, 404, 'User Not Found', 'User not found.');

      // If user is changing, we need to handle two-way references:
      // 1) Remove this user from tasks no longer in pendingTasks
      const newPending = Array.isArray(pendingTasks) ? pendingTasks.map(String) : [];
      const oldPending = user.pendingTasks.map(String);

      const removed = oldPending.filter(id => !newPending.includes(id));
      const added = newPending.filter(id => !oldPending.includes(id));

      // Remove user from removed tasks
      if (removed.length) {
        await Task.updateMany(
          { _id: { $in: removed }, assignedUser: String(user._id) },
          { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
        );
      }

      // Assign user on added tasks (only if not completed)
      if (added.length) {
        const tasks = await Task.find({ _id: { $in: added } }).exec();
        const updateOps = tasks.map(t => {
          if (t.completed) return null; // completed tasks are not pending
          return Task.updateOne(
            { _id: t._id },
            { $set: { assignedUser: String(user._id), assignedUserName: name } }
          );
        }).filter(Boolean);
        if (updateOps.length) await Promise.all(updateOps);
      }

      // Replace user
      user.name = name;
      user.email = email;
      user.pendingTasks = newPending;
      await user.save();

      return ok(res, user);
    } catch (e) {
      if (e && e.code === 11000) return fail(res, 400, 'Email must be unique');
      return fail(res, 500, 'Internal Server Error');
    }
  });

  // DELETE /api/users/:id (unassign their tasks)
  r.delete('/:id', async (req, res) => {
    try {
      const user = await User.findById(req.params.id).exec();
      if (!user) return fail(res, 404, 'User Not Found', 'User not found.');

      await Task.updateMany(
        { assignedUser: String(user._id) },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
      );

      await user.deleteOne();
      // 204 per spec is fine, but we’ll return 200 with message+data=null for consistency
      return ok(res, null, 200, 'Deleted');
    } catch (_) {
      return fail(res, 500, 'Internal Server Error');
    }
  });

  return r;
};
