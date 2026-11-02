var mongoose = require('mongoose');

function isId(v){
    return typeof v === 'string' && mongoose.isObjectIdOrHexString(v);
}

function send(res, status, messg, data){
    return res.status(status).json({message: messg, data: data});
}

function badRequest(msg){
    var e = new Error(msg);
    e.status = 400;
    return e;
}

function parseParam(q, name){
    if (q[name] === undefined) return undefined;
    try {
        return JSON.parse(q[name]);
    } catch (e) {
        throw badRequest("Invalid JSON in '" + name + "' parameter");
    }
}

function isPlainObject(v){
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonNegInt(v){
    return Number.isInteger(v) && v >= 0;
}

// Errors caused by a bad user-supplied query (not a server problem)
function isQueryError(err) {
    return err.status === 400 ||
        ['CastError', 'StrictModeError', 'MongoServerError'].includes(err.name) ||
        /sort/i.test(err.message || '');
}

async function getList(Model, req, res, defaultLimit) {
    try {
        var where  = parseParam(req.query, 'where');
        var sort   = parseParam(req.query, 'sort');
        var select = parseParam(req.query, 'select');
        var skip   = parseParam(req.query, 'skip');
        var limit  = parseParam(req.query, 'limit');
        var count  = parseParam(req.query, 'count');

        if (where === undefined) where = {};
        if (!isPlainObject(where)) throw badRequest("'where' must be a JSON object");
        if (sort !== undefined && !isPlainObject(sort)) throw badRequest("'sort' must be a JSON object");
        if (select !== undefined && !isPlainObject(select)) throw badRequest("'select' must be a JSON object");
        if (skip !== undefined && !isNonNegInt(skip)) throw badRequest("'skip' must be a non-negative integer");
        if (limit !== undefined && !isNonNegInt(limit)) throw badRequest("'limit' must be a non-negative integer");

        var wantCount = (count === true);
        var q = wantCount ? Model.countDocuments(where) : Model.find(where);

        if (!wantCount && sort) q.sort(sort);
        if (!wantCount && select) q.select(select);
        if (skip !== undefined) q.skip(skip);
        // Default limit applies to listing, not counting
        if (limit !== undefined) q.limit(limit);
        else if (!wantCount && defaultLimit !== undefined) q.limit(defaultLimit);

        var result = await q;
        return send(res, 200, 'OK', result);
    } catch (err) {
        if (isQueryError(err)) return send(res, 400, err.status === 400 ? err.message : 'Invalid query parameters', null);
        return send(res, 500, 'Server error', null);
    }
}

async function getOne(Model, req, res, label) {
    try {
        if (!isId(req.params.id)) return send(res, 404, label + ' not found', null);
        var select = parseParam(req.query, 'select');
        if (select !== undefined && !isPlainObject(select)) throw badRequest("'select' must be a JSON object");

        var q = Model.findById(req.params.id);
        if (select) q.select(select);
        var doc = await q;

        if (!doc) return send(res, 404, label + ' not found', null);
        return send(res, 200, 'OK', doc);
    } catch (err) {
        if (isQueryError(err)) return send(res, 400, err.status === 400 ? err.message : 'Invalid query parameters', null);
        return send(res, 500, 'Server error', null);
    }
}

module.exports = {
    isId: isId, send: send, badRequest: badRequest,
    getList: getList, getOne: getOne
};