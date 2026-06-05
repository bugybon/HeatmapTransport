const router = require('express').Router();
const pool = require('../db/pool');

router.use(async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async (body) => {
        const nodes = body.rows.map(r => r.node);
        const costMap = Object.fromEntries(
            body.rows.map(r => [r.node, r.agg_cost])
        );

        const result = await pool.query(`
            SELECT json_build_object(
                'type',     'FeatureCollection',
                'features', json_agg(ST_AsGeoJSON(t.*)::json)
            ) AS featurecollection
            FROM (
                SELECT
                    cost_band,
                    ST_Transform(
                        ST_Difference(
                            current_hull,
                            COALESCE(inner_hull,  ST_SetSRID('GEOMETRYCOLLECTION EMPTY'::geometry, 4326))
                        ),
                        4326
                    ) AS geometry
                FROM (
                    SELECT
                        cost_band,
                        min_cost,
                        ST_Transform(ST_ConcaveHull(ST_Collect(the_geom), 0.5, true),4326) AS current_hull,
                        LAG( ST_Transform(ST_ConcaveHull(ST_Collect(the_geom), 0.5, true),4326))
                            OVER (ORDER BY min_cost)                     AS inner_hull
                    FROM (
                        SELECT
                            pev.the_geom,
                            CASE
                                WHEN unnest_cost <= 10 THEN '0-10'
                                WHEN unnest_cost <= 20 THEN '10-20'
                                WHEN unnest_cost <= 30 THEN '20-30'
                                WHEN unnest_cost <= 45 THEN '30-45'
                                ELSE                        '45-60'
                            END AS cost_band,
                            MIN(unnest_cost) OVER (
                                PARTITION BY CASE
                                    WHEN unnest_cost <= 10 THEN '0-10'
                                    WHEN unnest_cost <= 20 THEN '10-20'
                                    WHEN unnest_cost <= 30 THEN '20-30'
                                    WHEN unnest_cost <= 45 THEN '30-45'
                                    ELSE                        '45-60'
                                END
                            ) AS min_cost
                        FROM UNNEST($1::int[], $2::float[]) AS t(node_id, unnest_cost)
                        JOIN ped_edges_vertices_pgr pev ON t.node_id = pev.id
                    ) t
                    GROUP BY cost_band, min_cost
                ) t
            ) t
        `, [
            nodes,
            nodes.map(n => costMap[n])
        ]);
    //     const result = await pool.query(`
            
    // SELECT json_build_object(
    //     'type',     'FeatureCollection',
    //     'features', json_agg(ST_AsGeoJSON(t.*)::json)
    // ) AS featurecollection
    // FROM (
    //     SELECT
    //         cost_band,
    //         ST_Transform(
    //             ST_ConcaveHull(ST_Collect(t.the_geom), 0.7, true),
    //             4326
    //         ) AS geometry
    //     FROM (
    //         SELECT
    //             pev.the_geom,
    //             CASE
    //                 WHEN unnest_cost <= 10 THEN '0-10'
    //                 WHEN unnest_cost <= 20 THEN '10-20'
    //                 WHEN unnest_cost <= 30 THEN '20-30'
    //                 WHEN unnest_cost <= 45 THEN '30-45'
    //                 ELSE                        '45-60'
    //             END AS cost_band
    //         FROM
    //             UNNEST($1::int[], $2::float[]) AS t(node_id, unnest_cost)
    //          JOIN ped_edges_vertices_pgr pev ON t.node_id = pev.id
    //     ) t
    //     GROUP BY cost_band
    // ) t`, [
    //         nodes,                          // $1 — array of node ids
    //         nodes.map(n => costMap[n])      // $2 — matching array of costs
    //     ]);
        return originalJson(result);
    };
    next();
});

router.use('/geo', require('./geo'));
router.use('/byfoot', require('./byfoot'))
router.use('/withtransport',require('./withtransport'))

module.exports = router;