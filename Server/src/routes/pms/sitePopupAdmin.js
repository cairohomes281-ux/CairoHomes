const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const {
  upload,
  attachCloudinaryUrls,
  setCloudinaryFolder,
  destroyCloudinaryUrl,
  FOLDER_SITE,
} = require('../../config/cloudinary');

const router = express.Router();

async function getPopupRow() {
  const { rows } = await query(`SELECT * FROM site_popup WHERE id = 1`);
  return rows[0] || null;
}

router.get('/site-popup', requireRoles('admin'), async (_req, res, next) => {
  try {
    const row = await getPopupRow();
    res.json(row || null);
  } catch (e) {
    next(e);
  }
});


router.put(
  '/site-popup',
  requireRoles('admin'),
  setCloudinaryFolder(FOLDER_SITE),
  upload.single('image'),
  attachCloudinaryUrls,
  async (req, res, next) => {
    try {
      const existing = await getPopupRow();
      
      const uploaded = req.file?.secure_url || req.file?.path || null;
      if (uploaded && !String(uploaded).includes('res.cloudinary.com')) {
        return res.status(500).json({ error: 'Cloudinary upload failed' });
      }
      const imageUrl = uploaded || existing?.image_url || null;
      if (!imageUrl) {
        return res.status(400).json({ error: 'Upload a popup image' });
      }
      if (!uploaded && !existing?.image_url) {
        return res.status(400).json({ error: 'Upload a popup image to Cloudinary' });
      }

      const linkRaw = req.body?.link_url;
      const linkUrl =
        linkRaw === undefined
          ? existing?.link_url || null
          : String(linkRaw || '').trim() || null;

      let active = existing?.active !== false;
      if (req.body?.active !== undefined) {
        active = !(req.body.active === false || req.body.active === '0' || req.body.active === 'false');
      }

      const { rows } = await query(
        `INSERT INTO site_popup (id, image_url, link_url, active, updated_at, updated_by)
         VALUES (1, $1, $2, $3, now(), $4)
         ON CONFLICT (id) DO UPDATE SET
           image_url = EXCLUDED.image_url,
           link_url = EXCLUDED.link_url,
           active = EXCLUDED.active,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by
         RETURNING *`,
        [imageUrl, linkUrl, active, req.user?.id || null]
      );

      if (uploaded && existing?.image_url && existing.image_url !== uploaded) {
        try {
          await destroyCloudinaryUrl(existing.image_url, {
            allowFolders: [FOLDER_SITE],
          });
        } catch (_) {}
      }

      res.json(rows[0]);
    } catch (e) {
      next(e);
    }
  }
);

router.delete('/site-popup', requireRoles('admin'), async (req, res, next) => {
  try {
    const existing = await getPopupRow();
    if (!existing) return res.json({ ok: true });

    await query(`DELETE FROM site_popup WHERE id = 1`);
    if (existing.image_url) {
      try {
        await destroyCloudinaryUrl(existing.image_url, { allowFolders: [FOLDER_SITE] });
      } catch (_) {}
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
