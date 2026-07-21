import { useCallback, useEffect, useState } from 'react';
import { api, type DrawingSummary } from '../api/client';

interface Props {
  open: boolean;
  /** 变化时若抽屉处于打开状态则重新拉取列表（保存后联动刷新） */
  refreshKey?: number;
  onClose: () => void;
  onLoad: (id: number) => void;
  onError: (message: string) => void;
}

export default function GalleryDrawer({ open, refreshKey = 0, onClose, onLoad, onError }: Props) {
  const [items, setItems] = useState<DrawingSummary[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listDrawings();
      setItems(list);
    } catch (e) {
      onError(e instanceof Error ? e.message : '加载作品列表失败');
      setItems([]);
    }
  }, [onError]);

  useEffect(() => {
    if (open) {
      setItems(null);
      void refresh();
    }
  }, [open, refresh, refreshKey]);

  const remove = async (item: DrawingSummary) => {
    if (!window.confirm(`确定删除作品「${item.title}」吗？此操作不可恢复。`)) return;
    setBusyId(item.id);
    try {
      await api.deleteDrawing(item.id);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <aside className={`drawer ${open ? 'drawer-open' : ''}`}>
        <div className="drawer-header">
          <h2>我的作品</h2>
          <button className="btn btn-icon" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {items === null && <p className="drawer-tip">加载中…</p>}
          {items !== null && items.length === 0 && (
            <p className="drawer-tip">还没有保存过作品，画一幅试试！</p>
          )}
          <div className="drawing-grid">
            {(items ?? []).map((d) => (
              <div key={d.id} className="drawing-card">
                <button
                  className="drawing-thumb"
                  onClick={() => onLoad(d.id)}
                  title={`加载「${d.title}」`}
                >
                  {d.thumbnail ? (
                    <img src={d.thumbnail} alt={d.title} />
                  ) : (
                    <span className="drawing-no-thumb">无缩略图</span>
                  )}
                </button>
                <div className="drawing-meta">
                  <span className="drawing-title" title={d.title}>
                    {d.title}
                  </span>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busyId === d.id}
                    onClick={() => void remove(d)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
