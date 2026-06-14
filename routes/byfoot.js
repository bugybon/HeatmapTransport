const router = require('express').Router();
const utils = require('./utils');

router.get('/', async (req, res, next) => {
    const { lat, lng, time } = req.query;

    if (!lat || !lng || !time) {
        return res.status(400).json({ message: 'lat, lng and time are required' });
    }

    req.isoData = await utils.heatmapByFoot(lat,lng,time);
    next()
});

module.exports = router;