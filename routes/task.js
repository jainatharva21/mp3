var Task = require('../models/task');
var User = require('../models/user');
var h = require('./helpers');

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim() !== '';
}

// Validates the body and checks the database.
// Returns { error: {status, message} } on failure, or { fields: {...} } if OK.
async function checkTask(body) {
    if (!isNonEmptyString(body.name)) return { error: { status: 400, message: 'Task name is required' } };

    var d = body.deadline;
    if (d === undefined || d === null || d === '' || (typeof d !== 'string' && typeof d !== 'number') || isNaN(new Date(d).getTime())) {
        return { error: { status: 400, message: 'A valid task deadline is required' } };
    }

    var description = body.description === undefined ? '' : body.description;
    if (typeof description !== 'string') return { error: { status: 400, message: 'Description must be a string' } };

    var completed = body.completed;
    if (completed === undefined) completed = false;
    else if (completed === 'true') completed = true;     // form-encoded bodies send strings
    else if (completed === 'false') completed = false;
    if (typeof completed !== 'boolean') return { error: { status: 400, message: 'completed must be true or false' } };

    var assignedUser = body.assignedUser === undefined || body.assignedUser === null ? '' : body.assignedUser;
    if (typeof assignedUser !== 'string') return { error: { status: 400, message: 'assignedUser must be a user id' } };
    if (assignedUser !== '' && !h.isId(assignedUser)) return { error: { status: 400, message: 'assignedUser is not a valid user id' } };

    var nameGiven = body.assignedUserName !== undefined && body.assignedUserName !== null;
    if (nameGiven && typeof body.assignedUserName !== 'string') return { error: { status: 400, message: 'assignedUserName must be a string' } };

    var assignedUserName = 'unassigned';
    if (assignedUser === '') {
        if (nameGiven && body.assignedUserName !== '' && body.assignedUserName !== 'unassigned') {
            return { error: { status: 400, message: 'assignedUserName does not match assignedUser' } };
        }
    } else {
        var user = await User.findById(assignedUser);
        if (!user) return { error: { status: 404, message: 'Assigned user does not exist' } };
        if (nameGiven && body.assignedUserName !== user.name) {
            return { error: { status: 400, message: 'assignedUserName does not match assignedUser' } };
        }
        assignedUserName = user.name;
    }

    return {
        fields: {
            name: body.name,
            description: description,
            deadline: new Date(d),
            completed: completed,
            assignedUser: assignedUser,
            assignedUserName: assignedUserName
        }
    };
}

// Makes users' pendingTasks match this task.
async function syncTask(task) {
    var id = String(task._id);
    // Remove it from everyone first (old owner, or because it is now completed)
    await User.updateMany({ pendingTasks: id }, { $pull: { pendingTasks: id } });
    // Then add it to its owner if it is still pending
    if (task.assignedUser !== '' && !task.completed) {
        await User.updateOne({ _id: task.assignedUser }, { $addToSet: { pendingTasks: id } });
    }
}

module.exports = function (router) {
    router.route('/tasks')
        .get(function (req, res) { return h.getList(Task, req, res, 100); }) // default limit 100
        .post(async function (req, res) {
            try {
                var check = await checkTask(req.body || {});
                if (check.error) return h.send(res, check.error.status, check.error.message, null);

                var task = new Task(check.fields);
                await task.save();
                await syncTask(task);

                return h.send(res, 201, 'Task created', task);
            } catch (err) {
                return h.send(res, 500, 'Server error', null);
            }
        });

    router.route('/tasks/:id')
        .get(function (req, res) { return h.getOne(Task, req, res, 'Task'); })
        .put(async function (req, res) {
            try {
                if (!h.isId(req.params.id)) return h.send(res, 404, 'Task not found', null);
                var task = await Task.findById(req.params.id);
                if (!task) return h.send(res, 404, 'Task not found', null);

                var check = await checkTask(req.body || {});
                if (check.error) return h.send(res, check.error.status, check.error.message, null);

                task.set(check.fields); // dateCreated is untouched
                await task.save();
                await syncTask(task);

                return h.send(res, 200, 'Task updated', task);
            } catch (err) {
                return h.send(res, 500, 'Server error', null);
            }
        })
        .delete(async function (req, res) {
            try {
                if (!h.isId(req.params.id)) return h.send(res, 404, 'Task not found', null);
                var task = await Task.findByIdAndDelete(req.params.id);
                if (!task) return h.send(res, 404, 'Task not found', null);

                var id = String(task._id);
                await User.updateMany({ pendingTasks: id }, { $pull: { pendingTasks: id } });

                return h.send(res, 200, 'Task deleted', task);
            } catch (err) {
                return h.send(res, 500, 'Server error', null);
            }
        });

    return router;
};