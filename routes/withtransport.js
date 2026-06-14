const router = require('express').Router();
const utils = require('./utils');

router.get('/', async (req, res,next) => {
    const { lat, lng, time, starttime } = req.query;

    if (!lat || !lng || !time || !starttime) {
        return res.status(400).json({ message: 'lat, lng, time and starttime are required' });
    }

    req.isoData = await utils.heatmapWithTransport(lat,lng,time,starttime);
    next()
});

module.exports = router;