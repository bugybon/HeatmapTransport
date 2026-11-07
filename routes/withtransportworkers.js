const router = require('express').Router();
const utils = require('./utils');

router.get('/', async (req, res,next) => {
    const { lat, lng, time, starttime,schedule } = req.query;
    const serviceDate = utils.SCHEDULE_DATES[schedule] ?? null;
    console.log('schedule:', schedule, '-> serviceDate:', serviceDate);
    
    if (!lat || !lng || !time || !starttime) {
        return res.status(400).json({ message: 'lat, lng, time and starttime are required' });
    }

    req.isoData = await utils.heatmapWithTransportWorkers(lat,lng,time,starttime,serviceDate);
    next();
});

module.exports = router;