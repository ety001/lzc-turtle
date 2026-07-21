import { useCallback, useMemo, useRef, useState } from 'react';
import TurtleCanvas, { type TurtleCanvasHandle } from '../components/TurtleCanvas';
import SaveDialog from '../components/SaveDialog';
import GalleryDrawer from '../components/GalleryDrawer';
import { api, type Me } from '../api/client';
import { run, type ParseError } from '../turtle';
import { EXAMPLES } from '../examples';

const DEFAULT_CODE = `; 欢迎来到小海龟画图！
; 从「示例」下拉框里挑一个模板，或者直接写命令：
CS
SETPW 3
SETPC #f2b950
REPEAT 5 [
  FD 200
  RT 144
]`;

const SPEED_OPTIONS = [
  { label: '1x', value: 1 },
  { label: '5x', value: 5 },
  { label: '20x', value: 20 },
  { label: '瞬时', value: 0 },
];

interface Props {
  user: Me;
}

export default function EditorPage({ user }: Props) {
  const canvasRef = useRef<TurtleCanvasHandle>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [errors, setErrors] = useState<ParseError[]>([]);
  const [speed, setSpeed] = useState(5);
  const [running, setRunning] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerVersion, setDrawerVersion] = useState(0);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const errorLines = useMemo(() => new Set(errors.map((e) => e.line)), [errors]);

  const handleRun = () => {
    const result = run(code);
    setErrors(result.errors);
    if (result.errors.length > 0) {
      canvasRef.current?.stop();
      return;
    }
    canvasRef.current?.play(result.commands);
  };

  const handleStop = () => canvasRef.current?.stop();

  const handleClear = () => {
    canvasRef.current?.reset();
    setCurrentId(null);
    setCurrentTitle(null);
  };

  const handleNew = () => {
    canvasRef.current?.stop();
    canvasRef.current?.reset();
    setCode('');
    setErrors([]);
    setCurrentId(null);
    setCurrentTitle(null);
    showToast('已新建空白作品');
  };

  // 点「保存」：已加载作品 → PUT 更新（标题沿用）；否则弹窗输标题 → POST 新建
  const handleSaveClick = () => {
    if (currentId !== null) {
      void handleUpdate();
    } else {
      setSaveOpen(true);
    }
  };

  const handleUpdate = async () => {
    if (currentId === null) return;
    setSaving(true);
    try {
      const thumbnail = canvasRef.current?.getThumbnail() ?? '';
      await api.updateDrawing(currentId, { code, thumbnail });
      setDrawerVersion((v) => v + 1);
      showToast('已保存');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (title: string) => {
    setSaving(true);
    try {
      const thumbnail = canvasRef.current?.getThumbnail() ?? '';
      const { id } = await api.createDrawing({ title, code, thumbnail });
      setCurrentId(id);
      setCurrentTitle(title);
      setSaveOpen(false);
      setDrawerVersion((v) => v + 1);
      showToast('已保存');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDrawing = async (id: number) => {
    try {
      const d = await api.getDrawing(id);
      canvasRef.current?.stop();
      setCode(d.code);
      setErrors([]);
      setCurrentId(d.id);
      setCurrentTitle(d.title);
      setDrawerOpen(false);
      showToast(`已加载「${d.title}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '加载失败');
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      /* 即使接口失败也回登录页 */
    }
    window.location.href = '/#/';
    window.location.reload();
  };

  const onEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">🐢</span>
          <span className="brand-name">小海龟画图</span>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={handleNew}>
            新建
          </button>
          <button className="btn" onClick={handleSaveClick} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          {currentTitle && (
            <span className="current-title" title={`当前作品：${currentTitle}`}>
              {currentTitle}
            </span>
          )}
          <button className="btn" onClick={() => setDrawerOpen(true)}>
            我的作品
          </button>
          <div className="user-chip" title={user.id}>
            {user.avatar ? (
              <img className="user-avatar" src={user.avatar} alt={user.name} />
            ) : (
              <span className="user-avatar user-avatar-fallback">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="user-name">{user.name}</span>
          </div>
          {user.auth_mode === 'oidc' && (
            <button className="btn btn-sm" onClick={() => void handleLogout()}>
              登出
            </button>
          )}
        </div>
      </header>

      <main className="workspace">
        <section className="editor-pane">
          <div className="pane-toolbar">
            <label className="example-picker">
              <span>示例</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const ex = EXAMPLES[Number(e.target.value)];
                  if (ex) {
                    canvasRef.current?.stop();
                    setCode(ex.code);
                    setErrors([]);
                  }
                  e.target.value = '';
                }}
              >
                <option value="" disabled>
                  选择示例…
                </option>
                {EXAMPLES.map((ex, i) => (
                  <option key={ex.name} value={i}>
                    {ex.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="editor-wrap">
            <div className="gutter" ref={gutterRef} aria-hidden>
              {Array.from({ length: lineCount }, (_, i) => (
                <div
                  key={i}
                  className={`gutter-line ${errorLines.has(i + 1) ? 'gutter-line-error' : ''}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <textarea
              className="code-editor"
              value={code}
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
              onScroll={onEditorScroll}
            />
          </div>

          {errors.length > 0 && (
            <div className="error-panel">
              {errors.slice(0, 8).map((err, i) => (
                <div key={i} className="error-item">
                  <span className="error-line-badge">第 {err.line} 行</span>
                  {err.message}
                </div>
              ))}
              {errors.length > 8 && (
                <div className="error-item">… 共 {errors.length} 个错误</div>
              )}
            </div>
          )}
        </section>

        <section className="canvas-pane">
          <div className="pane-toolbar canvas-toolbar">
            <div className="run-buttons">
              {running ? (
                <button className="btn btn-danger" onClick={handleStop}>
                  ■ 停止
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleRun}>
                  ▶ 运行
                </button>
              )}
              <button className="btn" onClick={handleClear} disabled={running}>
                清屏
              </button>
            </div>
            <div className="speed-picker">
              <span>速度</span>
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  className={`btn btn-sm ${speed === opt.value ? 'btn-active' : ''}`}
                  onClick={() => setSpeed(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="canvas-wrap">
            <TurtleCanvas
              ref={canvasRef}
              speed={speed}
              onRunningChange={setRunning}
            />
          </div>
        </section>
      </main>

      <SaveDialog
        open={saveOpen}
        busy={saving}
        onCancel={() => setSaveOpen(false)}
        onSubmit={(t) => void handleSave(t)}
      />
      <GalleryDrawer
        open={drawerOpen}
        refreshKey={drawerVersion}
        onClose={() => setDrawerOpen(false)}
        onLoad={(id) => void handleLoadDrawing(id)}
        onError={showToast}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
