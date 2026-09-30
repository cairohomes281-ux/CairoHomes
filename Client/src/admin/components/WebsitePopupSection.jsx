import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import ConfirmDialog from './ui/ConfirmDialog';
import LoadingSpinner from './ui/LoadingSpinner';


export default function WebsitePopupSection() {
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [active, setActive] = useState(true);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: popup, isLoading } = useQuery({
    queryKey: ['site-popup'],
    queryFn: () => api.get('/site-popup').then((r) => r.data),
  });

  useEffect(() => {
    if (popup === undefined) return;
    if (!popup) {
      setLinkUrl('');
      setActive(true);
      return;
    }
    setLinkUrl(popup.link_url || '');
    setActive(popup.active !== false);
  }, [popup?.updated_at]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!previewFile && !popup?.image_url) {
        throw new Error('Upload a popup image first');
      }
      const fd = new FormData();
      if (previewFile) fd.append('image', previewFile);
      fd.append('link_url', linkUrl || '');
      fd.append('active', active ? '1' : '0');
      return api.put('/site-popup', fd);
    },
    onSuccess: () => {
      toast.success(popup?.image_url ? 'Popup updated' : 'Popup published');
      setPreviewFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
      qc.invalidateQueries({ queryKey: ['site-popup'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || e.message || 'Save failed'),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete('/site-popup'),
    onSuccess: () => {
      toast.success('Popup removed');
      setConfirmRemove(false);
      setLinkUrl('');
      setActive(true);
      setPreviewFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
      qc.invalidateQueries({ queryKey: ['site-popup'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Remove failed'),
  });

  const onPickFile = (file) => {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const displayUrl = previewUrl || popup?.image_url || '';

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Website popup</h2>
        <p className="mt-1 text-sm text-gray-500">
          One promotional image shown when guests open the site. Stored on Cloudinary — uploading a
          new image replaces the current one.
        </p>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-4">
            <div>
              <label className="label">Popup image *</label>
              <div
                className="mt-1 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-ch-line bg-slate-50 px-4 py-8 text-center cursor-pointer hover:border-[var(--pms-accent,#2f5d58)] hover:bg-slate-100/80"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onPickFile(e.dataTransfer.files?.[0]);
                }}
              >
                <ImagePlus className="h-7 w-7 text-slate-400" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {popup?.image_url || previewFile ? 'Replace image' : 'Upload image'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    JPG, PNG, or WebP. Put offer text and CTA in the artwork.
                  </p>
                </div>
                <button type="button" className="btn-secondary text-xs">
                  <Upload className="h-3.5 w-3.5" /> Choose file
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0])}
              />
            </div>

            <div>
              <label className="label">Click destination (optional)</label>
              <input
                className="input"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="/search or https://…"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                If set, clicking the popup opens this path or URL.
              </p>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-ch-line bg-slate-50 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--pms-accent,#2f5d58)]"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900">Show on website</span>
                <span className="block text-xs text-gray-500">
                  Turn off to hide without deleting the image.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="btn-primary"
                disabled={saveMutation.isPending || (!previewFile && !popup?.image_url)}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? 'Saving…' : popup?.image_url ? 'Save popup' : 'Publish popup'}
              </button>
              {popup?.image_url ? (
                <button
                  type="button"
                  className="btn-secondary text-rose-700 border-rose-200"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="h-4 w-4" /> Remove popup
                </button>
              ) : null}
            </div>
          </div>

          <div className="card">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Preview</p>
            {displayUrl ? (
              <div className="relative overflow-hidden rounded-2xl bg-slate-900 shadow-lg">
                <img src={displayUrl} alt="Popup preview" className="block w-full h-auto" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ch-line bg-slate-50 px-4 py-16 text-center">
                <ImagePlus className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">No popup image yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => removeMutation.mutate()}
        title="Remove website popup?"
        message="Guests will no longer see a popup when opening the site. The Cloudinary image will be deleted."
        confirmText="Remove"
        danger
        loading={removeMutation.isPending}
      />
    </section>
  );
}
