const router = require('express').Router();

router.get('/', async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ message: 'lat and lng are required' });
  }

  // call your data source here — database, third-party API, etc.
  const result = lat + " " + lng;
  res.json(result);
});

module.exports = router;