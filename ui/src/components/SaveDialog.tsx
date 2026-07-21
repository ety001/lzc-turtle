import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}

export default function SaveDialog({ open, busy, onCancel, onSubmit }: Props) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const t = title.trim();
    if (t && !busy) onSubmit(t);
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>保存作品</h2>
        <label className="field">
          <span>标题</span>
          <input
            ref={inputRef}
            value={title}
            maxLength={60}
            placeholder="给这幅画起个名字"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
            }}
          />
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!title.trim() || busy}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
