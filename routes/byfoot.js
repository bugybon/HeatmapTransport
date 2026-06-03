const router = require('express').Router();
const pool = require('../db/pool')

router.get('/', async (req, res) => {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
        return res.status(400).json({ message: 'lat and lng are required' });
    }

    const ongrid = await pool.query(
        `SELECT *
        FROM ped_edges_vertices_pgr pe 
        ORDER BY pe.the_geom  <-> ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326),7801)
        LIMIT 1;`,
        [lng, lat]);

    // call your data source here — database, third-party API, etc.
    const result = await pool.query(
        `select pev1.the_geom, pev1.id,
            st_asgeojson(st_concavehull(st_collect(st_transform(pev.the_geom,4326)),0.1)) as geojson
        from ped_edges_vertices_pgr pev1,
            lateral(
            SELECT * FROM pgr_drivingDistance(
                    'Select id,source, target, minutes as cost, -1 as reverse_cost 
                    from ped_edges',
                    pev1.id,   -- now accessible via LATERAL
                    60.0,
                    false
                )
            ) t
        JOIN ped_edges_vertices_pgr pev ON t.node = pev.id
        where pev1.id=$1
        group by pev1.id;`,
        [ongrid.rows[0].id]);
    res.json(result);
});

module.exports = router;