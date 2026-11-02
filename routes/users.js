var User = require('../models/user');
var Task = require('../models/task')
var h = require('./helpers')

module.exports = function (router) {
    router.route('/users')
        .get(function (req, res) {return h.getList(User, req, res, undefined); })
    
    router.route('/users/:id')
        .get(function (req, res) { return h.getOne(User, req, res, 'User'); });

    return router;
}