var Task = require('../models/task');
var h = require('./helpers');

module.exports = function (router) {
    router.route('/tasks')
        .get(function (req, res) { return h.getList(Task, req, res, 100); }); // default limit 100

    router.route('/tasks/:id')
        .get(function (req, res) { return h.getOne(Task, req, res, 'Task'); });

    return router;
};