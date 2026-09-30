import { useRef, useState } from 'react';
import { CloudUpload, FileImage, FileText, X } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

const ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf';
const MAX_FILES = 10;
const MAX_MB = 10;

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isAllowedFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (/^image\/(png|jpe?g|webp)$/i.test(type)) return true;
  if (type === 'application/pdf' || name.endsWith('.pdf')) return true;
  return false;
}

function isPdfFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return type === 'application/pdf' || name.endsWith('.pdf');
}


export default function IdentityPhotoUpload({
  files = [],
  onChange,
  maxFiles = MAX_FILES,
  className = '',
}) {
  const { t } = useLocale();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  function takeFiles(fileList) {
    setError('');
    const incoming = Array.from(fileList || []).filter(isAllowedFile);
    if (!incoming.length) {
      setError(t('booking.badType'));
      return;
    }
    const tooBig = incoming.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig) {
      setError(t('booking.tooBig', { mb: MAX_MB }));
      return;
    }
    const next = [...files, ...incoming].slice(0, maxFiles);
    onChange?.(next);
  }

  function removeAt(index) {
    onChange?.(files.filter((_, i) => i !== index));
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <CloudUpload className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{t('booking.uploadTitle')}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {t('booking.uploadSubtitle')}
            </p>
          </div>
        </div>

        <div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            takeFiles(e.dataTransfer.files);
          }}
          className={`mt-4 rounded-2xl border border-dashed px-4 py-8 text-center transition ${
            dragging
              ? 'border-ch-pine bg-ch-pine/5'
              : 'border-slate-300 bg-slate-50/60'
          }`}
        >
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
            <CloudUpload className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">
            {t('booking.drop')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('booking.formats', { mb: MAX_MB, max: maxFiles })}
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
          >
            {t('booking.browse')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              takeFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.lastModified}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm">
                  {isPdfFile(file) ? <FileText className="h-5 w-5" /> : <FileImage className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(file.size)} · {t('booking.ready')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-rose-600"
                  aria-label={t('booking.removeFile', { name: file.name })}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
      </div>

      <p className="text-sm font-bold leading-5 text-red-600">{t('booking.idMandatory')}</p>
    </div>
  );
}
