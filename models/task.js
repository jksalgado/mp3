// models/Task.js
const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Task name is required'] },
  description: { type: String, default: '' },
  deadline: { type: Date, required: [true, 'Task deadline is required'] },
  completed: { type: Boolean, default: false },
  assignedUser: { type: String, default: '' },        // user _id or ''
  assignedUserName: { type: String, default: 'unassigned' },
  dateCreated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Task', TaskSchema);
