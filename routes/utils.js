const pool = require('../db/pool');

async function heatmapByFoot(lat, lng, time) {
    const ongrid = await pool.query(
        `SELECT *
        FROM ped_edges_vertices_pgr pe 
        ORDER BY pe.the_geom  <-> ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326),7801)
        LIMIT 1;`,
        [lng, lat]);

    // call your data source here — database, third-party API, etc.
    const result = await pool.query(
        `    
        SELECT
            dd.node,
            dd.agg_cost,
            ST_AsGeoJSON(ST_Transform(pev.the_geom, 4326)) AS geojson
        FROM pgr_drivingDistance(
            'Select id,source, target, minutes as cost, -1 as reverse_cost 
            from ped_edges'::text,
            $1::bigint,   -- now accessible via LATERAL
            $2::decimal,
            false
        ) dd
        JOIN ped_edges_vertices_pgr pev ON dd.node = pev.id
        WHERE dd.edge != -1
        `,
        // `select pev1.the_geom, pev1.id,
        //     st_asgeojson(st_concavehull(st_collect(st_transform(pev.the_geom,4326)),0.1, true)) as geojson
        // from ped_edges_vertices_pgr pev1,
        //     lateral(
        //     SELECT * FROM pgr_drivingDistance(
        //             'Select id,source, target, minutes as cost, -1 as reverse_cost 
        //             from ped_edges',
        //             pev1.id,   -- now accessible via LATERAL
        //             60.0,
        //             false
        //         )
        //     ) t
        // JOIN ped_edges_vertices_pgr pev ON t.node = pev.id
        // where pev1.id=$1
        // group by pev1.id;`,
        [ongrid.rows[0].id, time]);
    return result;
}

async function recursiveDrivingDistance(pool, startNode, maxCost, areaGeom, maxDepth = 5) {
    const visited = new Set();
    const results = new Map();
    
    // queue: [{ node, accumulatedCost, depth }]
    let queue = [{ node: startNode, accumulatedCost: 0, depth: 0 }];

    while (queue.length > 0 && queue[0].depth < maxDepth) {
        const nextQueue = [];

        for (const { node, accumulatedCost, depth } of queue) {
            if (visited.has(node)) continue;
            visited.add(node);

            // 1. Run drivingDistance from this node
            const { rows } = await pool.query(`
                SELECT
                    dd.node,
                    dd.edge,
                    dd.agg_cost,
                    ST_AsGeoJSON(s.wkb_geometry) AS geom,
                    ST_Within(s.wkb_geometry, ST_GeomFromGeoJSON($2)) AS in_area
                FROM pgr_drivingDistance(
                    'SELECT id, id_source AS source, id_target AS target,
                            EXTRACT(epoch FROM travel_time)/60.0 AS cost
                     FROM pt_edges',
                    $1, $3
                ) AS dd
                JOIN stops s ON dd.node = s.ogc_fid
                WHERE dd.edge != -1
            `, [node, areaGeom, maxCost]);

            for (const row of rows) {
                const totalCost = accumulatedCost + row.agg_cost;

                // Store cheapest path to each node
                if (!results.has(row.node) || results.get(row.node).totalCost > totalCost) {
                    results.set(row.node, { ...row, totalCost, depth });
                }

                // 2. Only expand further if node is within area
                if (row.in_area && !visited.has(row.node)) {
                    nextQueue.push({
                        node: row.node,
                        accumulatedCost: totalCost,
                        depth: depth + 1
                    });
                }
            }
        }

        queue = nextQueue;
    }

    return [...results.values()];
}

module.exports = {heatmapByFoot};