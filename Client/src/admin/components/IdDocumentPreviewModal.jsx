import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, X } from 'lucide-react';
import api from '../api/axios';
import { idDocumentPagePreviewUrl, isPdfUrl } from '../utils/idDocuments';


export default function IdDocumentPreviewModal({
  urls = [],
  index = 0,
  onClose,
  onIndexChange,
  zClass = 'z-[220]',
}) {
  const [objectUrl, setObjectUrl] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [fallbackSrc, setFallbackSrc] = useState('');
  const imgRef = useRef(null);

  const list = (urls || []).filter(Boolean);
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, list.length - 1));
  const current = list[safeIndex] || '';
  const pdf = isPdfUrl(current);
  const pagePreview = pdf ? idDocumentPagePreviewUrl(current, 1) : null;
  const displaySrc = objectUrl || fallbackSrc || (!pdf ? current : pagePreview) || '';

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let created = '';

    async function loadDocument() {
      setObjectUrl('');
      setFallbackSrc('');
      setLoadError('');
      setImgLoaded(false);
      if (!current) return;

      setLoading(true);
      try {
        const res = await api.get('/id-documents/view', {
          params: { url: current },
          responseType: 'blob',
        });
        if (cancelled) return;

        const type = String(res.data?.type || res.headers?.['content-type'] || '').toLowerCase();
        if (type.includes('application/json') || type.includes('text/html') || type.includes('text/plain')) {
          
          if (pdf && pagePreview) {
            setFallbackSrc(pagePreview);
          } else if (!pdf) {
            setFallbackSrc(current);
          } else {
            let message = 'Could not load this document.';
            try {
              const text = await res.data.text();
              const parsed = JSON.parse(text);
              if (parsed?.error) message = parsed.error;
            } catch {
              
            }
            setLoadError(message);
          }
          return;
        }

        const blobType =
          type ||
          (pdf ? 'application/pdf' : 'image/jpeg');
        created = URL.createObjectURL(new Blob([res.data], { type: blobType }));
        setObjectUrl(created);
      } catch (e) {
        if (cancelled) return;
        
        if (pdf && pagePreview) {
          setFallbackSrc(pagePreview);
          setLoadError('');
        } else if (!pdf) {
          setFallbackSrc(current);
          setLoadError('');
        } else {
          let message = 'Could not open this document.';
          const data = e.response?.data;
          if (data instanceof Blob) {
            try {
              const text = await data.text();
              const parsed = JSON.parse(text);
              if (parsed?.error) message = parsed.error;
            } catch {
              
            }
          } else if (data?.error) {
            message = data.error;
          }
          setLoadError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDocument();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [current, pdf, pagePreview]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el || pdf || !displaySrc) return;
    if (el.complete && el.naturalWidth > 0) {
      setImgLoaded(true);
    }
  }, [displaySrc, pdf, safeIndex]);

  useEffect(() => {
    if (!list.length) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowLeft' && list.length > 1) {
        onIndexChange?.((safeIndex - 1 + list.length) % list.length);
      }
      if (e.key === 'ArrowRight' && list.length > 1) {
        onIndexChange?.((safeIndex + 1) % list.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list.length, safeIndex, onClose, onIndexChange]);

  if (!list.length || !current) return null;

  const goPrev = () => onIndexChange?.((safeIndex - 1 + list.length) % list.length);
  const goNext = () => onIndexChange?.((safeIndex + 1) % list.length);
  const title = pdf ? 'ID / Passport document' : 'ID / Passport photo';
  const openHref = objectUrl || current;

  const node = (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-slate-950/70 p-4 sm:p-6`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
            {list.length > 1 ? (
              <p className="text-xs text-slate-500">
                Document {safeIndex + 1} of {list.length}
              </p>
            ) : (
              <p className="text-xs text-slate-500">Guest identity document</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {openHref ? (
              <a
                href={openHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            ) : null}
            {pdf && objectUrl ? (
              <a
                href={objectUrl}
                download="id-document.pdf"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
              >
                <Download className="h-3.5 w-3.5" />
                Save
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative bg-slate-100">
          {list.length > 1 ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-2 top-1/2 z-10 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                aria-label="Previous"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={goNext}
                className="absolute right-2 top-1/2 z-10 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                aria-label="Next"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          ) : null}

          <div className="flex min-h-[240px] items-center justify-center p-4 sm:p-5">
            {loading && !displaySrc ? (
              <div className="flex flex-col items-center gap-2 py-16">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                <p className="text-xs text-slate-500">Loading document…</p>
              </div>
            ) : pdf && objectUrl && !fallbackSrc ? (
              <iframe
                title="ID PDF preview"
                src={`${objectUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                className="h-[min(70vh,640px)] w-full rounded-lg border border-slate-200 bg-white"
              />
            ) : displaySrc && !pdf ? (
              <div className="relative flex min-h-[200px] w-full items-center justify-center">
                {(loading || !imgLoaded) && !loadError && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                  </div>
                )}
                <img
                  ref={imgRef}
                  key={displaySrc}
                  src={displaySrc}
                  alt="ID preview"
                  onLoad={() => setImgLoaded(true)}
                  onError={() => {
                    if (displaySrc !== current) {
                      setFallbackSrc(current);
                      setObjectUrl('');
                      setImgLoaded(false);
                      return;
                    }
                    setLoadError('Could not display this photo. Try Open in a new tab.');
                    setImgLoaded(true);
                  }}
                  className={`max-h-[min(70vh,640px)] w-auto max-w-full object-contain ${
                    imgLoaded ? 'opacity-100' : 'opacity-0'
                  } transition-opacity duration-150`}
                />
                {loadError ? (
                  <p className="absolute bottom-3 left-1/2 w-[min(90%,22rem)] -translate-x-1/2 rounded-md bg-amber-50 px-2.5 py-1 text-center text-[11px] text-amber-800 ring-1 ring-amber-200">
                    {loadError}
                  </p>
                ) : null}
              </div>
            ) : displaySrc && pdf ? (
              <div className="relative flex items-center justify-center">
                {(loading || !imgLoaded) && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                  </div>
                )}
                <img
                  ref={imgRef}
                  key={displaySrc}
                  src={displaySrc}
                  alt="ID PDF page preview"
                  onLoad={() => setImgLoaded(true)}
                  onError={() => {
                    setLoadError(loadError || 'PDF preview failed. Try Open or Save.');
                    setImgLoaded(true);
                  }}
                  className={`max-h-[min(70vh,640px)] w-auto max-w-full object-contain ${
                    imgLoaded ? 'opacity-100' : 'opacity-0'
                  } transition-opacity duration-150`}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <FileText className="h-9 w-9 text-slate-400" />
                <p className="text-sm text-slate-600">{loadError || 'Unable to preview this document.'}</p>
                <a
                  href={current}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-sky-700 hover:underline"
                >
                  Open original file
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
