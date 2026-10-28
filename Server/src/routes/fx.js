const express = require('express');
const { getUsdEgpRate, getEgpPerUnit } = require('../services/fx');

const router = express.Router();


router.get('/usd-egp', async (_req, res, next) => {
  try {
    const data = await getUsdEgpRate();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/egp/:currency', async (req, res, next) => {
  try {
    const data = await getEgpPerUnit(req.params.currency);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
