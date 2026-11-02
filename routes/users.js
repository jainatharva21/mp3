var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim() !== '';
}

// Validates the body and checks the database.
// Returns { error: {status, message} } on failure, or { pending: [...] } if OK.
async function checkUser(body, userId) {
    if (!isNonEmptyString(body.name))  return { error: { status: 400, message: 'User name is required' } };
    if (!isNonEmptyString(body.email)) return { error: { status: 400, message: 'User email is required' } };

    var pending = body.pendingTasks;
    if (pending === undefined || pending === null) pending = [];
    if (typeof pending === 'string') pending = [pending];
    if (!Array.isArray(pending)) return { error: { status: 400, message: 'pendingTasks must be a list of task ids' } };
    if (!pending.every(h.isId))  return { error: { status: 400, message: 'pendingTasks contains an invalid task id' } };
    pending = Array.from(new Set(pending)); // remove duplicates

    var emailQuery = { email: body.email };
    if (userId) emailQuery._id = { $ne: userId }; // keeping your own email is fine
    if (await User.exists(emailQuery)) return { error: { status: 400, message: 'A user with this email already exists' } };

    var tasks = await Task.find({ _id: { $in: pending } });
    if (tasks.length !== pending.length) return { error: { status: 404, message: 'One or more tasks in pendingTasks do not exist' } };
    if (tasks.some(function (t) { return t.completed; })) return { error: { status: 400, message: 'Completed tasks cannot be in pendingTasks' } };

    return { pending: pending };
}

// Makes the tasks match this user's pendingTasks list.
async function syncUser(user, pending) {
    var id = String(user._id);

    // 1. This user's pending tasks that are no longer in the list -> unassigned
    await Task.updateMany(
        { assignedUser: id, completed: false, _id: { $nin: pending } },
        { assignedUser: '', assignedUserName: 'unassigned' }
    );

    // 2. Tasks moving here from other users -> remove from those users' lists
    await User.updateMany(
        { _id: { $ne: user._id }, pendingTasks: { $in: pending } },
        { $pull: { pendingTasks: { $in: pending } } }
    );

    // 3. Assign the listed tasks to this user, and refresh the name on all of
    //    this user's tasks (completed ones too), in case the name changed
    await Task.updateMany(
        { $or: [{ _id: { $in: pending } }, { assignedUser: id }] },
        { assignedUser: id, assignedUserName: user.name }
    );
}

module.exports = function (router) {
    router.route('/users')
        .get(function (req, res) { return h.getList(User, req, res, undefined); })
        .post(async function (req, res) {
            try {
                var body = req.body || {};
                var check = await checkUser(body, null);
                if (check.error) return h.send(res, check.error.status, check.error.message, null);

                var user = new User({ name: body.name, email: body.email, pendingTasks: check.pending });
                await user.save();
                await syncUser(user, check.pending);

                return h.send(res, 201, 'User created', user);
            } catch (err) {
                if (err.code === 11000) return h.send(res, 400, 'A user with this email already exists', null);
                return h.send(res, 500, 'Server error', null);
            }
        });

        router.route('/users/:id')
            .get(function (req, res) { return h.getOne(User, req, res, 'User'); })
            .put(async function (req, res) {
                try {
                    if (!h.isId(req.params.id)) return h.send(res, 404, 'User not found', null);
                    var user = await User.findById(req.params.id);
                    if (!user) return h.send(res, 404, 'User not found', null);

                    var body = req.body || {};
                    var check = await checkUser(body, user._id);
                    if (check.error) return h.send(res, check.error.status, check.error.message, null);

                    user.name = body.name;
                    user.email = body.email;
                    user.pendingTasks = check.pending; // missing pendingTasks -> []
                    await user.save();                 // dateCreated is untouched
                    await syncUser(user, check.pending);

                    return h.send(res, 200, 'User updated', user);
                } catch (err) {
                    if (err.code === 11000) return h.send(res, 400, 'A user with this email already exists', null);
                    return h.send(res, 500, 'Server error', null);
                }
            })
            .delete(async function (req, res) {
                try {
                    if (!h.isId(req.params.id)) return h.send(res, 404, 'User not found', null);
                    var user = await User.findByIdAndDelete(req.params.id);
                    if (!user) return h.send(res, 404, 'User not found', null);
    
                    await Task.updateMany(
                        { assignedUser: String(user._id) },
                        { assignedUser: '', assignedUserName: 'unassigned' }
                    );
    
                    return res.status(204).end();
                } catch (err) {
                    return h.send(res, 500, 'Server error', null);
                }
            });
    
        return router;
};