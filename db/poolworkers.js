const { Pool } = require('pg');

const pool = new Pool({
    host:                    process.env.PGHOST,
    database:                process.env.PGDB,
    user:                    process.env.PGUSER,
    password:                process.env.PGPASS,
    port:                    process.env.PGPORT,
    ssl:                     { rejectUnauthorized: false },
    max:                     5,
    idleTimeoutMillis:       0,
    connectionTimeoutMillis: 0
});

pool.on('error', (err) => console.error('pg pool error', err));

module.exports = pool;