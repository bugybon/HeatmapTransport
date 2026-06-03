const router = require('express').Router();
const pool = require('../db/pool')

router.get('/', async (req, res) => {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
        return res.status(400).json({ message: 'lat and lng are required' });
    }

    // call your data source here — database, third-party API, etc.
    const result = await pool.query(
        `SELECT *
        FROM spt_stops
        ORDER BY wkb_geometry <-> ST_SetSRID(ST_MakePoint($1, $2), 4326) ASC
        LIMIT 1;`,
        [lng, lat]);
    res.json(result);
});

module.exports = router;