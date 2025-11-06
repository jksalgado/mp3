// routes/tasks.js
const express = require('express');
const Task = require('../models/Task');
const User = require('../models/User');
const { buildMongooseQuery, ok, fail } = require('./_utils');

module.exports = function (_router) {
  const r = express.Router();

  // GET /api/tasks (default limit 100)
  r.get('/', async (req, res) => {
    try {
      if (String(req.query.count).toLowerCase() === 'true') {
        const where = buildMongooseQuery(req, Task).q.getQuery();
        const count = await Task.countDocuments(where);
        return ok(res, count);
      }
      const { q } = buildMongooseQuery(req, Task, 100);
      const tasks = await q.exec();
      return ok(res, tasks);
    } catch (_) {
      return fail(res, 500, 'Internal Server Error');
    }
  });

  // POST /api/tasks
  r.post('/', async (req, res) => {
    try {
      let { name, description, deadline, completed, assignedUser, assignedUserName } = req.body;
      if (!name || !deadline) return fail(res, 400, 'Task name and deadline are required');

      completed = String(completed).toLowerCase() === 'true';

      // If assignedUser provided, hydrate name if missing
      let userDoc = null;
      if (assignedUser) {
        userDoc = await User.findById(assignedUser).exec();
        if (userDoc) {
          assignedUserName = assignedUserName || userDoc.name;
        } else {
          assignedUser = '';
          assignedUserName = 'unassigned';
        }
      } else {
        assignedUser = '';
        assignedUserName = 'unassigned';
      }

      const task = await Task.create({
        name,
        description,
        deadline: new Date(Number(deadline) || deadline),
        completed: !!completed,
        assignedUser,
        assignedUserName
      });

      // Add to user.pendingTasks if assigned & not completed
      if (!task.completed && task.assignedUser && userDoc) {
        userDoc.pendingTasks = Array.from(new Set([...(userDoc.pendingTasks || []).map(String), String(task._id)]));
        await userDoc.save();
      }

      return ok(res, task, 201, 'Created');
    } catch (_) {
      return fail(res, 500, 'Internal Server Error');
    }
  });

  // GET /api/tasks/:id (support ?select=)
  r.get('/:id', async (req, res) => {
    try {
      const selectRaw = req.query.select || req.query.filter;
      let select = undefined;
      if (selectRaw) { try { select = JSON.parse(selectRaw); } catch (_) {} }
      const task = await Task.findById(req.params.id, select || undefined).exec();
      if (!task) return fail(res, 404, 'Task Not Found', 'Task not found.');
      return ok(res, task);
    } catch (_) {
      return fail(res, 404, 'Task Not Found', 'Task not found.');
    }
  });

  // PUT /api/tasks/:id (replace)
  r.put('/:id', async (req, res) => {
    try {
      const task = await Task.findById(req.params.id).exec();
      if (!task) return fail(res, 404, 'Task Not Found', 'Task not found.');

      let { name, description, deadline, completed, assignedUser, assignedUserName } = req.body;
      if (!name || !deadline) return fail(res, 400, 'Task name and deadline are required');

      completed = String(completed).toLowerCase() === 'true';
      let newAssignedUserDoc = null;
      let newAssignedUser = '';

      if (assignedUser) {
        newAssignedUserDoc = await User.findById(assignedUser).exec();
        if (newAssignedUserDoc) {
          newAssignedUser = String(newAssignedUserDoc._id);
          assignedUserName = assignedUserName || newAssignedUserDoc.name;
        } else {
          assignedUserName = 'unassigned';
        }
      } else {
        assignedUserName = 'unassigned';
      }

      const oldAssignedUser = task.assignedUser;

      // Replace fields
      task.name = name;
      task.description = description || '';
      task.deadline = new Date(Number(deadline) || deadline);
      task.completed = !!completed;
      task.assignedUser = newAssignedUser; // '' if none/invalid
      task.assignedUserName = assignedUserName;

      await task.save();

      // Two-way sync
      if (oldAssignedUser && (oldAssignedUser !== task.assignedUser || task.completed)) {
        await User.updateOne(
          { _id: oldAssignedUser },
          { $pull: { pendingTasks: String(task._id) } }
        );
      }
      if (task.assignedUser && !task.completed) {
        await User.updateOne(
          { _id: task.assignedUser },
          { $addToSet: { pendingTasks: String(task._id) } }
        );
      }
      if (task.completed) {
        await User.updateMany({}, { $pull: { pendingTasks: String(task._id) } });
      }

      return ok(res, task);
    } catch (_) {
      return fail(res, 500, 'Internal Server Error');
    }
  });

  // DELETE /api/tasks/:id
  r.delete('/:id', async (req, res) => {
    try {
      const task = await Task.findById(req.params.id).exec();
      if (!task) return fail(res, 404, 'Task Not Found', 'Task not found.');

      const assignedUser = task.assignedUser;
      await task.deleteOne();

      if (assignedUser) {
        await User.updateOne(
          { _id: assignedUser },
          { $pull: { pendingTasks: String(task._id) } }
        );
      }

      return ok(res, null, 200, 'Deleted');
    } catch (_) {
      return fail(res, 500, 'Internal Server Error');
    }
  });

  return r;
};
