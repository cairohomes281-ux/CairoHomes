const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const staffAuthRoutes = require('./routes/staffAuth');
const unitsRoutes = require('./routes/units');
const bookingsRoutes = require('./routes/bookings');
const paymentsRoutes = require('./routes/payments');
const inquiriesRoutes = require('./routes/inquiries');
const wishlistRoutes = require('./routes/wishlist');
const promoRoutes = require('./routes/promoCodes');
const recruitmentRoutes = require('./routes/recruitment');
const salesRoutes = require('./routes/sales');
const icalRoutes = require('./routes/ical');
const channelManagerRoutes = require('./routes/channelManager');
const pmsRoutes = require('./routes/pms');
const { runChannelSync } = require('./lib/channelManager');

function requireCronSecret(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET must be set to a strong value (32+ chars) in production');
  }

  const origins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAnyOrigin = origins.includes('*');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) => {
        // Non-browser clients (curl, server-to-server) often omit Origin.
        if (!origin) return cb(null, true);
        if (allowAnyOrigin) return cb(null, true);
        if (origins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    })
  );

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
      limit: '2mb',
    })
  );
  app.use(express.urlencoded({ extended: true }));

  app.use(
    '/api/',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 800,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' },
  });
  app.use('/api/staff/auth/login', authLimiter);
  app.use('/api/auth/sign-in', authLimiter);
  app.use('/api/auth/login', authLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'cairo-homes-backend',
      ts: new Date().toISOString(),
    });
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/staff/auth', staffAuthRoutes);
  app.use('/api/units', unitsRoutes);
  app.use('/api/projects', require('./routes/projects'));
  app.use('/api/bookings', bookingsRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/inquiries', inquiriesRoutes);
  app.use('/api/host-requests', require('./routes/hostRequests'));
  app.use('/api/wishlist', wishlistRoutes);
  app.use('/api/promo-codes', promoRoutes);
  app.use('/api/site-popup', require('./routes/sitePopup'));
  app.use('/api/recruitment', recruitmentRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/calendar', icalRoutes);
  app.use('/api/pms/channel-manager', channelManagerRoutes);
  app.use('/api/pms', pmsRoutes);
  app.use(
    '/api/partners',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    require('./routes/partners')
  );
  app.use('/api/fx', require('./routes/fx'));
  app.use('/api/reviews', require('./routes/reviews').router);
  app.use('/api/site-telemetry', require('./routes/siteTelemetry'));

  app.get('/api/cron/refresh-ical-blocks', async (req, res, next) => {
    try {
      if (!requireCronSecret(req, res)) return;
      const result = await runChannelSync();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/cron/data-retention', async (req, res, next) => {
    try {
      if (!requireCronSecret(req, res)) return;
      const { runDataRetentionCleanup } = require('./jobs/dataRetention');
      const result = await runDataRetentionCleanup();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/cron/monthly-salary-expenses', async (req, res, next) => {
    try {
      if (!requireCronSecret(req, res)) return;
      const { syncPaidPayrollExpenses } = require('./jobs/monthlySalaryExpenses');
      const year = req.body?.year || req.query?.year;
      const month = req.body?.month || req.query?.month;
      const result =
        year && month
          ? await syncPaidPayrollExpenses({ year: Number(year), month: Number(month) })
          : await syncPaidPayrollExpenses();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
