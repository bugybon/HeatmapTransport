const router = require('express').Router();

router.use('/geo',   require('./geo'));
router.use('/byfoot', require('./byfoot'))


module.exports = router;