const express = require('express');
const { getUsdEgpRate } = require('../services/fx');

const router = express.Router();


router.get('/usd-egp', async (_req, res, next) => {
  try {
    const data = await getUsdEgpRate();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
