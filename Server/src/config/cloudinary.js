const { v2: cloudinary } = require('cloudinary');
const multer = require('multer');
const streamifier = require('streamifier');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


const FOLDER_ID_DOCS = 'cairo-homes/id-docs';

const FOLDER_UNITS = 'cairo-homes/units';

const FOLDER_PAYMENTS = 'cairo-homes/payments';

const FOLDER_SITE = 'cairo-homes/site';

const FOLDER_PROJECTS = 'cairo-homes/projects';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      /\.(jpe?g|png|gif|webp|pdf)$/i.test(name);
    if (!ok) {
      return cb(new Error('Only image or PDF uploads are allowed'));
    }
    return cb(null, true);
  },
});

/** Memory-only Excel uploads (attendance door reports). Not sent to Cloudinary. */
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      /\.xlsx?$/i.test(name) ||
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/octet-stream' ||
      /spreadsheet|excel/i.test(mime);
    if (!ok) {
      return cb(new Error('Upload an Excel Original Records Report (.xls or .xlsx) only'));
    }
    return cb(null, true);
  },
});

function isPdfUpload(filename = '', mimetype = '') {
  return /pdf/i.test(String(mimetype)) || /\.pdf$/i.test(String(filename));
}

function safeBaseName(filename = 'upload') {
  return (
    String(filename)
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'upload'
  );
}


function uploadBufferToCloudinary(buffer, filename = 'upload', mimetype = '', opts = {}) {
  const pdf = isPdfUpload(filename, mimetype);
  const folder = opts.folder || FOLDER_ID_DOCS;
  return new Promise((resolve, reject) => {
    const options = {
      folder,
      public_id: `${Date.now()}-${safeBaseName(filename)}`,
      resource_type: pdf ? 'image' : 'auto',
      type: 'upload',
    };
    if (pdf) {
      options.format = 'pdf';
    }
    const stream = cloudinary.uploader.upload_stream(options, (err, result) =>
      err ? reject(err) : resolve(result)
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

function setCloudinaryFolder(folder) {
  return (req, _res, next) => {
    req.cloudinaryFolder = folder;
    next();
  };
}


async function attachCloudinaryUrls(req, _res, next) {
  try {
    const files = [];
    if (req.file) files.push(req.file);
    if (Array.isArray(req.files)) {
      files.push(...req.files);
    } else if (req.files && typeof req.files === 'object') {
      for (const list of Object.values(req.files)) {
        if (Array.isArray(list)) files.push(...list);
      }
    }
    const folder = req.cloudinaryFolder || FOLDER_ID_DOCS;
    for (const file of files) {
      if (!file.buffer) continue;
      const result = await uploadBufferToCloudinary(file.buffer, file.originalname, file.mimetype, {
        folder,
      });
      file.path = result.secure_url;
      file.secure_url = result.secure_url;
      file.cloudinary_resource_type = result.resource_type;
      file.cloudinary_pages = result.pages;
      file.cloudinary_public_id = result.public_id;
    }
    next();
  } catch (err) {
    next(err);
  }
}


function parseCloudinaryDeliveryUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!parsed.hostname.includes('cloudinary.com')) return null;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (cloud && !raw.includes(`/${cloud}/`)) return null;

  
  const match = parsed.pathname.match(
    /\/(image|raw|video|auto)\/upload\/(.*)$/i
  );
  if (!match) return null;

  const resourceType = match[1].toLowerCase() === 'auto' ? 'image' : match[1].toLowerCase();
  let rest = match[2];
  
  const parts = rest.split('/');
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (/^v\d+$/.test(p)) {
      i += 1;
      break;
    }
    
    if (p.includes(',') || /^(f_|q_|w_|c_|h_|dpr_|pg_)/.test(p)) {
      i += 1;
      continue;
    }
    break;
  }
  let publicId = parts.slice(i).join('/');
  if (!publicId) return null;
  publicId = decodeURIComponent(publicId);

  return { resourceType, publicId, url: raw };
}


async function destroyCloudinaryUrl(url, { allowFolders = [FOLDER_ID_DOCS, FOLDER_PAYMENTS] } = {}) {
  const info = parseCloudinaryDeliveryUrl(url);
  if (!info) return { deleted: false, reason: 'not_cloudinary' };

  const idNoExt = info.publicId.replace(/\.[^.]+$/, '');
  const allowed = allowFolders.some(
    (folder) =>
      info.publicId === folder ||
      info.publicId.startsWith(`${folder}/`) ||
      idNoExt.startsWith(`${folder}/`)
  );
  if (!allowed) {
    return { deleted: false, reason: 'protected_folder' };
  }
  
  if (
    info.publicId.startsWith(`${FOLDER_UNITS}/`) ||
    idNoExt.startsWith(`${FOLDER_UNITS}/`)
  ) {
    return { deleted: false, reason: 'unit_media_protected' };
  }

  const tryIds = [idNoExt];
  if (info.publicId !== idNoExt) tryIds.push(info.publicId);

  for (const publicId of tryIds) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: info.resourceType === 'raw' ? 'raw' : 'image',
        invalidate: true,
      });
      if (result?.result === 'ok' || result?.result === 'not found') {
        return { deleted: result.result === 'ok', reason: result.result };
      }
    } catch (err) {
      
      try {
        const result = await cloudinary.uploader.destroy(publicId, {
          resource_type: 'raw',
          invalidate: true,
        });
        if (result?.result === 'ok' || result?.result === 'not found') {
          return { deleted: result.result === 'ok', reason: result.result };
        }
      } catch (_) {}
    }
  }
  return { deleted: false, reason: 'destroy_failed' };
}

module.exports = {
  cloudinary,
  upload,
  excelUpload,
  uploadBufferToCloudinary,
  attachCloudinaryUrls,
  setCloudinaryFolder,
  parseCloudinaryDeliveryUrl,
  destroyCloudinaryUrl,
  FOLDER_ID_DOCS,
  FOLDER_UNITS,
  FOLDER_PAYMENTS,
  FOLDER_SITE,
  FOLDER_PROJECTS,
};
