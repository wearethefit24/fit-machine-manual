import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCircle2, ChevronRight,
  ClipboardList, Download, Dumbbell, Edit3, ExternalLink, FolderOpen, ImagePlus, Info,
  Layers3, Link2, LoaderCircle, LockKeyhole, LogOut, MapPin, Menu, Plus, QrCode, ScanQrCode,
  Save, Settings2, Share2, ShieldAlert, Smartphone, Sparkles, TriangleAlert, Trash2, UploadCloud,
  X, ZoomIn
} from 'lucide-react';
import QRCode from 'qrcode';

const EMPTY = { stores: [], areas: [], machines: [] };
const CONTENT_FIELDS = [
  ['overview', '概要', 'マシンの目的や鍛えられる部位などをご案内します。', Info],
  ['adjustment', '調整方法', 'シートの高さやパッドの位置などを調整してください。', Settings2],
  ['instructions', '操作手順', '開始姿勢から動作の流れを順番にご案内します。', ClipboardList],
  ['tips', 'ポイント', 'フォームや呼吸のコツを確認しましょう。', Sparkles],
  ['safety', '安全上の注意事項', '無理のない重量を設定し、周囲の安全を確認してください。', TriangleAlert],
];

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `通信に失敗しました（${res.status}）。`);
  return data;
}
const send = (path, method, value) => api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const num = n => String(n + 1).padStart(2, '0');
const fieldInput = 'field';
function useRoute() {
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => { setRoute(window.location.pathname); window.scrollTo({ top: 0, behavior: 'instant' }); };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  function navigate(path) {
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setRoute(path); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return [route, navigate];
}
function useCatalog() {
  const [catalog, setCatalog] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function refresh() {
    try { const data = await api('/api/catalog'); setCatalog(data); setError(''); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    refresh();
    const update = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  return { catalog, loading, error, refresh };
}
function Brand({ admin = false }) {
  return <div className="brand"><div className="brand-icon"><Dumbbell size={20} strokeWidth={2.5} /></div><div className="leading-none"><div className="brand-word">FIT<span>MANUAL</span></div><div className="brand-sub">MACHINE GUIDE {admin ? '/ ADMIN' : '/ DIGITAL'}</div></div></div>;
}
function Skeleton() { return <div className="space-y-3 pt-6">{[1,2,3,4].map(i => <div key={i} className="skeleton h-23 rounded-2xl" />)}</div>; }
function Alert({ children, kind = 'error' }) { return <div className={`alert ${kind === 'ok' ? 'alert-ok' : ''}`}><Info size={18} className="shrink-0" />{children}</div>; }
function Empty({ title, description, icon: Icon = FolderOpen }) { return <div className="empty"><div className="empty-icon"><Icon size={28}/></div><div className="font-semibold text-white">{title}</div><p className="text-sm text-neutral-200 leading-relaxed mt-2">{description}</p></div>; }
function Back({ onClick, label = '戻る' }) { return <button className="back-btn" onClick={onClick}><ArrowLeft size={18}/>{label}</button>; }

function SiteHeader({ logoRevision }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [logoRevision]);
  return <header className="site-header" aria-label="ジムのロゴ">
    <div className="site-logo-box">
      <img src={String('/api/logo?rev=' + logoRevision)} alt="ジムのロゴ"
        className={loaded ? 'site-logo-img' : 'site-logo-img site-logo-loading'}
        onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />
      {!loaded && <span className="site-logo-fallback" aria-label="WE ARE THE FIT">WE ARE<br/>THE FIT</span>}
    </div>
  </header>;
}

// Only QR codes issued by this site can open a manual from the built-in camera.
function machineIdFromQr(value, machines) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== window.location.origin || url.search || url.hash) return null;
  const match = /^\/machine\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname);
  if (!match) return null;
  return machines.find(item => item.id.toLowerCase() === match[1].toLowerCase())?.id || null;
}

function QrScanner({ machines, cameraRequest, onClose, onFound, onRetry }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const finishedRef = useRef(false);
  const machinesRef = useRef(machines);
  const onFoundRef = useRef(onFound);
  machinesRef.current = machines;
  onFoundRef.current = onFound;
  const [message, setMessage] = useState('カメラを起動しています…');
  const [retryable, setRetryable] = useState(false);

  useEffect(() => {
    let disposed = false;
    let stream = null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    finishedRef.current = false;
    setMessage('カメラを起動しています…');
    setRetryable(false);
    const stopTracks = source => source?.getTracks().forEach(track => track.stop());
    (async () => {
      try {
        // Camera permission is requested directly by the launcher's tap handler.
        // Start the scanner only after that original request succeeds.
        if (!cameraRequest) throw new Error('カメラを起動できません。');
        stream = await cameraRequest;
        if (disposed) { stopTracks(stream); return; }
        if (!videoRef.current) throw new Error('カメラの表示先がありません。');
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (disposed) { stopTracks(stream); return; }
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromStream(stream, videoRef.current,
          (result, error, activeControls) => {
            if (disposed || finishedRef.current || !result) return;
            const id = machineIdFromQr(result.getText(), machinesRef.current);
            if (!id) {
              setMessage('FIT MANUALで発行したマシンのQRコードを読み取ってください。');
              return;
            }
            finishedRef.current = true;
            activeControls?.stop();
            onFoundRef.current(id);
          });
        if (disposed || finishedRef.current) controls.stop();
        else {
          scannerRef.current = controls;
          setMessage('');
        }
      } catch (error) {
        stopTracks(stream);
        if (disposed) return;
        const permissionDenied = ['NotAllowedError','PermissionDeniedError','SecurityError'].includes(error?.name);
        const notFound = ['NotFoundError','DevicesNotFoundError'].includes(error?.name);
        const unavailable = ['NotReadableError','TrackStartError'].includes(error?.name);
        setMessage(permissionDenied
          ? 'カメラが許可されていません。ブラウザのカメラ設定で「許可」を選択してください。'
          : notFound
            ? '利用できるカメラが見つかりません。端末のカメラを確認してください。'
            : unavailable
              ? 'ほかのアプリがカメラを使用中の可能性があります。閉じてから再試行してください。'
              : 'カメラを起動できませんでした。通信状態とカメラの使用許可をご確認ください。');
        setRetryable(true);
      }
    })();
    return () => {
      disposed = true;
      try { scannerRef.current?.stop(); } catch { /* Already stopped. */ }
      scannerRef.current = null;
      stopTracks(stream);
      document.body.style.overflow = previousOverflow;
    };
  }, [cameraRequest]);

  return <div className="qr-scanner-overlay" role="dialog" aria-modal="true" aria-label="マシンQRコード読み取り">
    <div className="qr-scanner-header">
      <strong>マシンのQRコードを読み取る</strong>
      <button type="button" className="qr-scanner-close" onClick={onClose} aria-label="カメラを閉じる"><X size={24}/></button>
    </div>
    <div className="qr-scanner-viewfinder">
      <video ref={videoRef} autoPlay playsInline muted className="qr-scanner-video"/>
      <div className="qr-scanner-corners" aria-hidden="true"><ScanQrCode size={100} strokeWidth={1}/></div>
    </div>
    <p className="qr-scanner-help" role="status">{message || 'マシンに貼られたQRコードをカメラの中央に合わせてください。'}</p>
    {retryable && <button type="button" className="btn btn-secondary qr-scanner-retry" onClick={onRetry}>カメラを再試行</button>}
    <button type="button" className="btn btn-secondary qr-scanner-done" onClick={onClose}>閉じる</button>
  </div>;
}

function LogoAdmin({ logoRevision, onLogoChanged, notify }) {
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(null);
  useEffect(() => {
    let active = true;
    fetch('/api/logo?rev=' + logoRevision, { method: 'HEAD', cache: 'no-store' })
      .then(response => { if (active) setExists(response.ok); })
      .catch(() => { if (active) setExists(null); });
    return () => { active = false; };
  }, [logoRevision]);
  async function save() {
    if (!file) return notify('ロゴ画像を選択してください。', true);
    if (file.size > 2 * 1024 * 1024) return notify('画像は2MiB以内にしてください。', true);
    try {
      setSaving(true);
      await api('/api/admin/logo', { method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
      setFile(null);
      onLogoChanged();
      notify('ロゴを保存しました。反映まで少し時間がかかる場合があります。');
    } catch (err) { notify(err.message, true); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!window.confirm('登録済みのロゴを削除しますか？')) return;
    try {
      setSaving(true);
      await api('/api/admin/logo', { method: 'DELETE' });
      setFile(null);
      onLogoChanged();
      notify('ロゴを削除しました。');
    } catch (err) { notify(err.message, true); }
    finally { setSaving(false); }
  }
  return <section className="admin-card space-y-4">
    <h2 className="card-title !mb-0">共通ロゴ画像</h2>
    <p className="text-sm text-neutral-200 leading-relaxed">登録した画像を、管理画面・店舗選択・エリア選択・マシン選択・説明画面の上部中央に固定表示します。</p>
    <div className="logo-admin-preview">
      {exists ? <img alt="現在のロゴ" src={'/api/logo?rev=' + logoRevision}/> : <span>{exists === false ? 'ロゴ画像は未登録です' : 'ロゴを確認しています…'}</span>}
    </div>
    <Field title="ロゴ画像を選択" hint="PNG・JPEG・WebP・GIF／2MiB以内。横幅の広い画像も枠内に収まるよう表示します。">
      <input className="field" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => setFile(event.target.files?.[0] || null)} />
    </Field>
    <button type="button" className="btn btn-primary w-full" disabled={saving || !file} onClick={save}>
      {saving ? <LoaderCircle className="animate-spin" size={18}/> : <UploadCloud size={18}/>}ロゴ画像を保存
    </button>
    <button type="button" className="btn btn-danger w-full" disabled={saving || exists !== true} onClick={remove}>
      <Trash2 size={17}/> 登録したロゴを削除
    </button>
    <p className="text-xs text-neutral-300">画像の保存には既存のCloudflare KVを使用します。更新の表示に時間がかかる場合があります。</p>
  </section>;
}

const MANUAL_IMAGE_PREFIX = '@FIT_IMG_V1:';
function readManualItems(value) {
  const raw = typeof value === 'string' ? value : '';
  if (raw.startsWith(MANUAL_IMAGE_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(MANUAL_IMAGE_PREFIX.length));
      if (Array.isArray(parsed)) return parsed.map(item => ({
        text: typeof item?.text === 'string' ? item.text : '',
        imageId: typeof item?.imageId === 'string' ? item.imageId : null
      }));
    } catch { /* Fall back to displaying the original text. */ }
  }
  return raw.split(/\r?\n/).map(text => ({ text, imageId: null }));
}
function writeManualItems(items) {
  const cleaned = items.map(item => ({
    text: String(item.text || '').replace(/\r?\n/g, ' '),
    imageId: item.imageId || null
  }));
  return cleaned.some(item => item.imageId)
    ? MANUAL_IMAGE_PREFIX + JSON.stringify(cleaned)
    : cleaned.map(item => item.text).join('\n');
}
// Legacy manuals continue to display without any data migration.
// Display already-saved text without inventing instructions: one newline = one numbered/bulleted item.
const GUIDE_SECTIONS = [
  { field: 'overview', title: '概要', kind: 'text', Icon: Info },
  { field: 'adjustment', title: 'マシン調整方法', kind: 'steps', Icon: Settings2 },
  { field: 'instructions', title: '実施手順', kind: 'steps', Icon: ClipboardList },
  { field: 'tips', title: 'ポイント', kind: 'bullets', Icon: Sparkles },
  { field: 'safety', title: '安全上の注意事項', kind: 'warning', Icon: TriangleAlert },
];

function ManualGuideSection({ field, title, kind, Icon, value, joined = false, machineId }) {
  const [previewImage, setPreviewImage] = useState(null);
  const text = typeof value === 'string' ? value.trim() : '';
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const stripPrefix = line => line.replace(/^(?:[0-9]{1,2}[.．、)]|[①-⑳]|[・●•\-])\s*/, '').trim();
  const stepItems = kind === 'steps'
    ? readManualItems(value).filter(item => item.text.trim() || item.imageId)
    : [];
  const hasContent = kind === 'steps' ? stepItems.length > 0 : !!text;
  const sectionClass = joined
    ? 'manual-exercise-part manual-exercise-part-' + field
    : 'manual-guide-section' + (field === 'overview' ? ' manual-guide-overview' : '') + (field === 'adjustment' ? ' manual-guide-adjustment' : '') + (field === 'instructions' ? ' manual-guide-instructions' : '') + (field === 'tips' ? ' manual-guide-tips' : '') + (kind === 'warning' ? ' manual-guide-warning' : '');
  return <><section className={sectionClass}
    aria-labelledby={'manual-' + field}>
    <div className="manual-guide-heading">
      {field !== 'overview' && field !== 'adjustment' && field !== 'tips' && <span className="manual-guide-icon" aria-hidden="true"><Icon size={21} strokeWidth={2}/></span>}
      <h2 id={'manual-' + field} className="manual-guide-title">{title}</h2>
    </div>
    {!hasContent ? <p className="manual-guide-empty">内容はまだ登録されていません。</p>
      : kind === 'steps' ? <ol className="manual-steps">
          {stepItems.map((item, i) => <li key={i}>
            <span className="manual-step-number" aria-hidden="true">{i + 1}</span>
            <div className="manual-step-body">
              {item.text.trim() && <span>{stripPrefix(item.text) || item.text}</span>}
              {item.imageId && machineId && <button type="button" className="manual-step-photo"
                aria-label={title + 'の画像' + (i + 1) + 'を拡大'}
                onClick={() => setPreviewImage('/api/manual-image/' + machineId + '/' + item.imageId)}>
                <img src={'/api/manual-image/' + machineId + '/' + item.imageId}
                  alt={title + ' ' + (i + 1) + ' の説明画像'} loading="lazy"/>
              </button>}
            </div>
          </li>)}
        </ol>
      : kind === 'bullets' || kind === 'warning' ? <ul className="manual-bullets">
          {lines.map((line, i) => <li key={i}><span className="manual-bullet-symbol" aria-hidden="true">・</span><span>{stripPrefix(line) || line}</span></li>)}
        </ul>
      : <p className="manual-guide-text">{text}</p>}
  </section>
  {previewImage && <div className="manual-image-lightbox" role="dialog" aria-modal="true" aria-label="手順画像の拡大表示"
    onClick={() => setPreviewImage(null)}>
    <button type="button" className="manual-image-lightbox-close" onClick={() => setPreviewImage(null)}
      aria-label="画像を閉じる"><X size={23}/></button>
    <img src={previewImage} alt="手順の拡大画像" onClick={event => event.stopPropagation()}/>
  </div>}
  </>;
}
function MachineChoiceImage({ machineId }) {
  const [loaded, setLoaded] = useState(false);
  return <span className="viewer-machine-placeholder" aria-hidden="true">
    <img className={'viewer-machine-thumbnail' + (loaded ? ' is-ready' : '')}
      src={'/api/machine-thumbnail/' + machineId} alt="" loading="lazy"
      onLoad={() => setLoaded(true)} onError={() => setLoaded(false)}/>
  </span>;
}
function Viewer({ catalog, loading, error, route, navigate, refresh }) {
  const ids = route.split('/').filter(Boolean);
  const store = ids[0] === 'store' ? catalog.stores.find(s => s.id === ids[1]) : null;
  const area = ids[0] === 'area' ? catalog.areas.find(a => a.id === ids[1]) : null;
  const machine = ids[0] === 'machine' ? catalog.machines.find(m => m.id === ids[1]) : null;
  const currentStore = store || (area ? catalog.stores.find(s => s.id === area.storeId) : null) || (machine ? catalog.stores.find(s => s.id === catalog.areas.find(a => a.id === machine.areaId)?.storeId) : null);
  const currentArea = area || (machine ? catalog.areas.find(a => a.id === machine.areaId) : null);
  const isMachinePage = ids[0] === 'machine';
  const isAreaPage = ids[0] === 'area';
  const isStorePage = ids[0] === 'store';
  const title = isMachinePage ? 'マシン取扱説明書' : isAreaPage ? 'マシン選択' : isStorePage ? 'エリア選択' : '店舗選択';
  const label = isMachinePage ? 'EXERCISE GUIDE' : isAreaPage ? 'SELECT MACHINE' : isStorePage ? 'SELECT AREA' : 'SELECT LOCATION';
  const list = isStorePage ? catalog.areas.filter(a => a.storeId === store?.id) : isAreaPage ? catalog.machines.filter(m => m.areaId === area?.id) : catalog.stores;
  const hasMissing = (isStorePage && !store) || (isAreaPage && !area) || (isMachinePage && !machine);
  const backAction = () => {
    if (isMachinePage && currentArea) navigate(`/area/${currentArea.id}`);
    else if (isAreaPage && currentStore) navigate(`/store/${currentStore.id}`);
    else navigate('/');
  };
  const [scanOpen, setScanOpen] = useState(false);
  const [cameraRequest, setCameraRequest] = useState(null);
  const cameraRequestRef = useRef(null);
  function requestCamera() {
    // Call getUserMedia synchronously during the tap, before any dynamic imports.
    // This also ensures iPhone Safari can prompt for access immediately.
    let request;
    try {
      request = navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia({
            audio: false, video: { facingMode: { ideal: 'environment' } }
          })
        : Promise.reject(new Error('このブラウザはカメラに対応していません。'));
    } catch(error) {
      request = Promise.reject(error);
    }
    request.catch(() => {}); // The scanner displays a human-readable error.
    cameraRequestRef.current = request;
    setCameraRequest(request);
    setScanOpen(true);
  }
  function closeCamera() {
    // A permission prompt can resolve after the dialog was closed.
    const request = cameraRequestRef.current;
    cameraRequestRef.current = null;
    if (request) request.then(stream => {
      stream.getTracks().forEach(track => track.stop());
    }).catch(() => {});
    setScanOpen(false);
    setCameraRequest(null);
  }
  const showScan = ids.length === 0 || isStorePage || isAreaPage;
  const scanControls = showScan ? <>
    <button type="button" className="qr-scan-launcher" aria-label="QRコードを読み取る" onClick={requestCamera}>
      <ScanQrCode size={44} strokeWidth={2.5}/>
    </button>
    {scanOpen && <QrScanner machines={catalog.machines} cameraRequest={cameraRequest}
      onClose={closeCamera} onRetry={requestCamera}
      onFound={id => { closeCamera(); navigate('/machine/' + id); }}/>}
  </> : null;
  // The viewer home keeps the logo at the top and QR scan fixed to the bottom.
  if (ids.length === 0) {
    return <div className="min-h-screen">
      <main className="viewer-home">
        <h1 className="viewer-home-title">店舗を選択してください</h1>
        {loading ? <div className="viewer-home-buttons"><Skeleton/></div>
          : error ? <div className="viewer-home-buttons"><Alert>{error}</Alert><button type="button" onClick={refresh} className="btn btn-primary w-full mt-4">再読み込み</button></div>
          : catalog.stores.length ? <div className="viewer-home-buttons">
              {catalog.stores.map(item => <button
                type="button"
                key={item.id}
                onClick={() => navigate('/store/' + item.id)}
                className="viewer-store-button"
              >{item.name}</button>)}
            </div>
          : <div className="viewer-home-buttons"><Empty title="店舗が登録されていません" description="店舗スタッフによる登録をお待ちください。"/></div>}
      </main>
      {scanControls}
    </div>;
  }
  // After choosing a store, show areas using the same large white vertical buttons as the home screen.
  if (isStorePage) {
    return <div className="min-h-screen">
      <main className="viewer-home viewer-category-home">
        <div className="viewer-selection-back"><Back onClick={backAction}/></div>
        <h1 className="viewer-home-title">エリアを選択してください</h1>
        {loading ? <div className="viewer-home-buttons"><Skeleton/></div>
          : error ? <div className="viewer-home-buttons"><Alert>{error}</Alert><button type="button" className="btn btn-primary mt-4" onClick={refresh}>再読み込み</button></div>
          : hasMissing ? <div className="viewer-home-buttons"><Empty title="店舗が見つかりません" description="店舗選択画面から選び直してください。"/></div>
          : list.length ? <div className="viewer-home-buttons">
              {list.map(item => <button type="button" key={item.id}
                onClick={() => navigate('/area/' + item.id)}
                className="viewer-store-button">{item.name}</button>)}
            </div>
          : <div className="viewer-home-buttons"><Empty title="エリアが登録されていません" description="店舗スタッフによる登録をお待ちください。"/></div>}
      </main>
      {scanControls}
    </div>;
  }

  // Machine choices show square thumbnails when available, otherwise the original white tile.
  if (isAreaPage) {
    return <div className="min-h-screen">
      <main className="viewer-machine-picker">
        <div className="viewer-selection-back"><Back onClick={backAction}/></div>
        <h1 className="viewer-machine-picker-title">マシンを選択してください</h1>
        {loading ? <Skeleton/>
          : error ? <div><Alert>{error}</Alert><button type="button" className="btn btn-primary mt-4" onClick={refresh}>再読み込み</button></div>
          : hasMissing ? <Empty title="エリアが見つかりません" description="エリア選択画面から選び直してください。"/>
          : list.length ? <div className="viewer-machine-grid">
              {list.map(item => <button type="button" className="viewer-machine-tile" key={item.id}
                onClick={() => navigate('/machine/' + item.id)}
                aria-label={item.name + 'の取扱説明書を開く'}>
                <MachineChoiceImage machineId={item.id}/>
                <span className="viewer-machine-name">{item.name}</span>
              </button>)}
            </div>
          : <Empty title="マシンが登録されていません" description="店舗スタッフによる登録をお待ちください。"/>}
      </main>
      {scanControls}
    </div>;
  }

  // Dedicated machine-manual layout; QR routes open here directly.
  if (isMachinePage) {
    return <div className="min-h-screen">
      <main className="shell manual-page">
        {loading ? <Skeleton/>
          : error ? <div className="mt-6"><Alert>{error}</Alert><button onClick={refresh} className="btn btn-primary mt-4">再読み込み</button></div>
          : !machine ? <Empty title="マシンが見つかりません" description="URLが変更されたか、マシンが削除された可能性があります。"/>
          : <>
            <header className="manual-title-area">
              <h1 className="manual-machine-name">{machine.name}</h1>
              <p className="manual-location">{[currentStore?.name, currentArea?.name].filter(Boolean).join(' / ')}</p>
            </header>
            <div className="manual-guide-sections">
              {GUIDE_SECTIONS.map(({ field, title, kind, Icon }) =>
                field === 'tips' ? null :
                field === 'instructions' ? <div className="manual-exercise-panel" role="group"
                  aria-label="実施手順とポイント" key="instructions-and-tips">
                  <ManualGuideSection joined field={field} title={title} kind={kind}
                    Icon={Icon} value={machine[field]} machineId={machine.id}/>
                  <ManualGuideSection joined field="tips" title="ポイント" kind="bullets"
                    Icon={Sparkles} value={machine.tips} machineId={machine.id}/>
                </div> :
                <ManualGuideSection key={field} field={field} title={title}
                  kind={kind} Icon={Icon} value={machine[field]} machineId={machine.id}/>)}
            </div>
            <button type="button" className="btn btn-secondary w-full manual-return" onClick={backAction}>
              <ArrowLeft size={18}/>マシン一覧に戻る
            </button>
          </>}
      </main>
    </div>;
  }

  return <div className="min-h-screen">
    <main className={isMachinePage ? 'shell pb-24' : 'shell pb-48'}>
      <div className="hero"><div className="mb-4">{(isMachinePage || isAreaPage || isStorePage) && <Back onClick={backAction}/>}</div>
        <div className="eyebrow tracking-[.24em]">{label}</div><h1 className="hero-title">{title}<span className="hero-period">.</span></h1>
        <p className="hero-sub">{isMachinePage ? [currentStore?.name, currentArea?.name, machine?.name].filter(Boolean).join(' / ') : isAreaPage ? `${currentStore?.name || '店舗'}のマシンを選択してください` : isStorePage ? `${store?.name || '店舗'}のエリアを選択してください` : 'ご利用中の店舗を選択してください'}</p>
      </div>
      {loading ? <Skeleton/> : error ? <div className="mt-6"><Alert>{error}</Alert><button onClick={refresh} className="btn btn-primary mt-4">再読み込み</button></div> : hasMissing ? <Empty title="対象が見つかりません" description="URLが変更されたか、マシンが削除された可能性があります。"/> : list.length ? <div className="space-y-3 mt-6">
        <div className="list-caption"><span>{isAreaPage ? 'MACHINES' : isStorePage ? 'AREAS' : 'LOCATIONS'}</span><span>{list.length} ITEMS</span></div>
        {list.map((item, i) => <button className="selection-card group" key={item.id} onClick={() => navigate(`/${isAreaPage ? 'machine' : isStorePage ? 'area' : 'store'}/${item.id}`)}><span className="selection-index">{num(i)}</span><div className="selection-icon">{isAreaPage ? <Dumbbell size={24}/> : isStorePage ? <Layers3 size={24}/> : <MapPin size={24}/>}</div><div className="flex-1 text-left min-w-0"><div className="font-semibold text-white text-[17px] truncate">{item.name}</div><div className="text-xs text-neutral-300 mt-1">{isAreaPage ? '使い方を見る' : isStorePage ? 'マシン一覧を見る' : 'エリア一覧を見る'}</div></div><ChevronRight className="text-white shrink-0 group-hover:translate-x-1 transition-transform" size={22}/></button>)}
      </div> : <Empty title={isAreaPage ? 'マシンが登録されていません' : isStorePage ? 'エリアが登録されていません' : '店舗が登録されていません'} description="店舗スタッフによる登録をお待ちください。"/>}
    </main>{scanControls}<div className="footer-note">FIT MANUAL <span className="px-2">•</span> TRAIN SMART. STAY SAFE.</div>
  </div>;
}
function Chip({ children, active, onClick }) { return <button className={`chip ${active ? 'chip-active' : ''}`} onClick={onClick}>{children}</button>; }
function Field({ title, children, hint }) { return <label className="block"><span className="field-label">{title}</span>{children}{hint && <span className="text-xs text-neutral-300 mt-1.5 block">{hint}</span>}</label>; }
function Action({ children, pending, className = '', ...props }) { return <button disabled={pending} className={`btn btn-primary ${className}`} {...props}>{pending ? <LoaderCircle size={18} className="animate-spin"/> : <Save size={17}/>} {children}</button>; }
function SmallActions({ onEdit, onDelete }) { return <div className="flex shrink-0 gap-2"><button title="編集" aria-label="編集" className="icon-button" onClick={onEdit}><Edit3 size={16}/></button><button title="削除" aria-label="削除" className="icon-button danger" onClick={onDelete}><Trash2 size={16}/></button></div>; }
function QRPanel({ machine }) {
  const [qr, setQr] = useState('');
  const [message, setMessage] = useState('');
  const url = `${window.location.origin}/machine/${machine.id}`;
  useEffect(() => { QRCode.toDataURL(url, { margin: 3, width: 720, errorCorrectionLevel: 'H', color: { dark: '#000000', light: '#FFFFFF' } }).then(setQr).catch(() => setQr('')); }, [url]);
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `${machine.name}の取扱説明書`, url });
      else { await navigator.clipboard.writeText(url); setMessage('URLをコピーしました。'); }
    } catch (e) { if (e.name !== 'AbortError') setMessage('共有できませんでした。'); }
  }
  return <div className="panel mt-5"><div className="flex items-center gap-2 text-white font-semibold"><QrCode size={20} className="text-white"/> 専用QRコード</div><p className="text-neutral-200 text-sm mt-1">印刷してマシンに貼り付けられます。</p><div className="qr-frame">{qr ? <img src={qr} alt={`${machine.name}のQRコード`} className="w-54 h-54"/> : <LoaderCircle className="animate-spin"/>}</div><p className="url-text">{url}</p><div className="grid grid-cols-2 gap-2 mt-4"><a className="btn btn-secondary text-sm" href={qr || '#'} download={`QR_${machine.name}.png`} onClick={e => !qr && e.preventDefault()}><Download size={17}/> 画像保存</a><button className="btn btn-secondary text-sm" onClick={share}><Share2 size={17}/> 共有する</button></div>{message && <p className="text-white text-xs mt-3">{message}</p>}<a href={`/machine/${machine.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-white flex gap-2 items-center mt-4 justify-center">視聴画面で開く <ExternalLink size={14}/></a></div>;
}
function StoresAdmin({ catalog, refresh, notify, tidy }) {
  const [editing, setEditing] = useState(null); const [name, setName] = useState(''); const [pending, setPending] = useState(false);
  function reset() { setEditing(null); setName(''); }
  async function save() {
    try { setPending(true); await send(editing ? `/api/admin/stores/${editing}` : '/api/admin/stores', editing ? 'PATCH' : 'POST', { name }); await refresh(); reset(); notify('店舗を保存しました。'); }
    catch (e) { notify(e.message, true); } finally { setPending(false); }
  }
  async function remove(s) {
    if (!window.confirm(`「${s.name}」を削除しますか？所属するエリア・マシンと説明画像も削除されます。`)) return;
    try { await api(`/api/admin/stores/${s.id}`, { method: 'DELETE' }); await refresh(); await tidy(); if (editing === s.id) reset(); notify('店舗を削除しました。'); } catch (e) { notify(e.message, true); }
  }
  return <div className="space-y-4"><div className="admin-card"><h3 className="card-title">{editing ? '店舗を編集' : '店舗を追加'}</h3><Field title="店舗名"><input className={fieldInput} value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="例：江古田店"/></Field><div className="flex gap-2 mt-4"><Action onClick={save} pending={pending} className="flex-1">{editing ? '変更を保存' : '店舗を登録'}</Action>{editing && <button onClick={reset} className="btn btn-secondary"><X size={17}/>取消</button>}</div></div>
  <div className="admin-card"><h3 className="card-title">登録済み店舗 <span className="count">{catalog.stores.length}</span></h3>{catalog.stores.length ? catalog.stores.map(s => <div key={s.id} className="admin-row"><span className="row-icon"><MapPin size={18}/></span><div className="flex-1 min-w-0"><p className="font-medium text-white truncate">{s.name}</p><p className="text-xs text-neutral-300 mt-0.5">{catalog.areas.filter(a => a.storeId === s.id).length} エリア</p></div><SmallActions onEdit={() => { setEditing(s.id); setName(s.name); }} onDelete={() => remove(s)}/></div>) : <Empty title="店舗はまだありません" description="まず店舗を登録してください。"/>}</div></div>;
}
function AreasAdmin({ catalog, refresh, notify, tidy }) {
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [storeId, setStoreId] = useState('');
  const [selectedStoreIds, setSelectedStoreIds] = useState([]);
  const [pending, setPending] = useState(false);
  const selectedStore = storeId || catalog.stores[0]?.id || '';
  function reset() {
    setEditing(null);
    setName('');
    setStoreId('');
    setSelectedStoreIds([]);
  }
  function toggleStore(id, checked) {
    setSelectedStoreIds(previous => checked
      ? previous.includes(id) || previous.length >= 20 ? previous : [...previous, id]
      : previous.filter(value => value !== id));
  }
  async function save() {
    if (!name.trim()) { notify('エリア名を入力してください。', true); return; }
    if (!editing && !selectedStoreIds.length) {
      notify('登録する店舗を1つ以上選択してください。', true);
      return;
    }
    try {
      setPending(true);
      if (editing) {
        await send(`/api/admin/areas/${editing}`, 'PATCH',
          { name: name.trim(), storeId: selectedStore });
        notify('エリアを更新しました。');
      } else {
        const result = await send('/api/admin/areas', 'POST',
          { name: name.trim(), storeIds: selectedStoreIds });
        if (!Array.isArray(result.ids) || result.ids.length !== selectedStoreIds.length) {
          throw new Error('エリア登録件数を確認できませんでした。再登録せず一覧をご確認ください。');
        }
        notify(result.ids.length + '店舗にエリアを登録しました。');
      }
      await refresh();
      reset();
    } catch (e) { notify(e.message, true); }
    finally { setPending(false); }
  }
  async function remove(a) {
    if (!window.confirm(`「${a.name}」を削除しますか？所属するマシンと説明画像も削除されます。`)) return;
    try {
      await api(`/api/admin/areas/${a.id}`, { method: 'DELETE' });
      await refresh();
      await tidy();
      if (editing === a.id) reset();
      notify('エリアを削除しました。');
    } catch (e) { notify(e.message, true); }
  }
  return <div className="space-y-4">
    <div className="admin-card">
      <h3 className="card-title">{editing ? 'エリアを編集' : 'エリアを追加'}</h3>
      <div className="space-y-4">
        {editing ? <Field title="店舗">
          <select className={fieldInput} value={selectedStore}
            disabled={pending} onChange={event => setStoreId(event.target.value)}>
            {catalog.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field> : <div className="manual-multistore">
          <div className="manual-multistore-heading">
            <div className="field-label">登録する店舗（複数選択可）</div>
            <button type="button" className="manual-multistore-select-all"
              disabled={pending || !catalog.stores.length}
              onClick={() => setSelectedStoreIds(catalog.stores.slice(0,20).map(s => s.id))}>すべて選択</button>
            <button type="button" className="manual-multistore-clear"
              disabled={pending || !selectedStoreIds.length}
              onClick={() => setSelectedStoreIds([])}>選択解除</button>
          </div>
          <div className="manual-multistore-list">
            {catalog.stores.map(store => <label key={store.id}
              className="manual-multistore-row manual-multistore-checkbox">
              <input type="checkbox"
                checked={selectedStoreIds.includes(store.id)}
                disabled={pending || (!selectedStoreIds.includes(store.id) && selectedStoreIds.length >= 20)}
                onChange={event => toggleStore(store.id, event.target.checked)}/>
              <span>{store.name}</span>
            </label>)}
          </div>
          <p className="manual-multistore-note">選択中：{selectedStoreIds.length}店舗（最大20店舗）。選んだ店舗に同じ名前のエリアを登録します。</p>
        </div>}
        <Field title="エリア名">
          <input className={fieldInput} value={name} disabled={pending}
            onChange={e => setName(e.target.value)} maxLength={80} placeholder="例：有酸素エリア"/>
        </Field>
      </div>
      <div className="flex gap-2 mt-4">
        <Action pending={pending || !catalog.stores.length} onClick={save} className="flex-1">
          {editing ? '変更を保存' : selectedStoreIds.length > 1
            ? selectedStoreIds.length + '店舗にエリアを登録' : 'エリアを登録'}
        </Action>
        {editing && <button className="btn btn-secondary" disabled={pending} onClick={reset}>取消</button>}
      </div>
    </div>
    <div className="admin-card">
      <h3 className="card-title">登録済みエリア <span className="count">{catalog.areas.length}</span></h3>
      {catalog.areas.length ? catalog.areas.map(a => <div className="admin-row" key={a.id}>
        <span className="row-icon"><Layers3 size={18}/></span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-white truncate">{a.name}</p>
          <p className="text-xs text-neutral-300 mt-0.5">
            {catalog.stores.find(s => s.id === a.storeId)?.name || ''} ・
            {' '}{catalog.machines.filter(m => m.areaId === a.id).length} 台
          </p>
        </div>
        <SmallActions onEdit={() => {
          setEditing(a.id); setName(a.name); setStoreId(a.storeId);
        }} onDelete={() => remove(a)}/>
      </div>) : <Empty title="エリアはまだありません"
        description="店舗を登録した後、エリアを追加してください。"/>}
    </div>
  </div>;
}
const initialFields = { overview: '', adjustment: '', instructions: '', tips: '', safety: '' };


function ManualImageCropper({ file, onApply, onCancel, square = false }) {
  const WIDTH = square ? 900 : 1200, HEIGHT = 900;
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function constrain(point, nextZoom) {
    const image = imageRef.current;
    if (!image) return point;
    const base = Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight) * nextZoom;
    const maxX = Math.max(0, (image.naturalWidth * base - WIDTH) / 2);
    const maxY = Math.max(0, (image.naturalHeight * base - HEIGHT) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, point.x)),
      y: Math.max(-maxY, Math.min(maxY, point.y))
    };
  }
  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      imageRef.current = image;
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setReady(true);
    };
    image.onerror = () => { if (alive) setError('この写真を読み込めません。JPEG・PNG・WebP画像をお試しください。'); };
    image.src = url;
    return () => { alive = false; URL.revokeObjectURL(url); };
  }, [file]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!ready || !canvas || !image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const base = Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight) * zoom;
    const w = image.naturalWidth * base;
    const h = image.naturalHeight * base;
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(image, (WIDTH - w) / 2 + offset.x, (HEIGHT - h) / 2 + offset.y, w, h);
  }, [ready, zoom, offset]);
  function pointerDown(e) {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function pointerMove(e) {
    if (!dragRef.current || dragRef.current.id !== e.pointerId) return;
    const dx = e.clientX - dragRef.current.x, dy = e.clientY - dragRef.current.y;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    const ratio = WIDTH / Math.max(1, canvasRef.current?.getBoundingClientRect().width || WIDTH);
    setOffset(prev => constrain({ x: prev.x + dx * ratio, y: prev.y + dy * ratio }, zoom));
  }
  async function confirm() {
    if (!ready || saving) return;
    setSaving(true);
    const blob = await new Promise(resolve => canvasRef.current?.toBlob(resolve, 'image/jpeg', .82));
    if (!blob) { setError('画像を切り取れませんでした。'); setSaving(false); return; }
    if (blob.size > 2 * 1024 * 1024) { setError('画像の容量が2MiBを超えました。'); setSaving(false); return; }
    onApply(blob);
  }
  return <div className="manual-crop-backdrop">
    <div className="manual-crop-dialog" role="dialog" aria-modal="true"
      aria-label={square ? '画像を正方形に切り取る' : '画像を4対3に切り取る'}>
      <div className="manual-crop-header">
        <h3>{square ? '画像を正方形（1:1）に切り取り' : '画像を4:3に切り取り'}</h3>
        <button type="button" className="manual-crop-close" onClick={onCancel} aria-label="切り取りをキャンセル"><X size={22}/></button>
      </div>
      <p className="manual-crop-help">写真を指で動かして位置を調整できます。スライダーで拡大できます。</p>
      <div className={'manual-crop-canvas-wrap' + (square ? ' manual-crop-square' : '')}>
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT}
          className="manual-crop-canvas"
          onPointerDown={pointerDown} onPointerMove={pointerMove}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}/>
        {!ready && !error && <span className="manual-crop-loading">画像を読み込んでいます…</span>}
      </div>
      <label className="manual-crop-zoom"><ZoomIn size={18}/> 拡大
        <input type="range" min="1" max="3" step=".05" value={zoom} disabled={!ready}
          onChange={e => {
            const next = Number(e.target.value);
            setOffset(prev => constrain(prev, next));
            setZoom(next);
          }}/>
      </label>
      {error && <p className="manual-crop-error" role="alert">{error}</p>}
      <div className="manual-crop-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>キャンセル</button>
        <button type="button" className="btn btn-primary" disabled={!ready || saving} onClick={confirm}>
          {saving ? '処理中…' : 'この範囲で決定'}
        </button>
      </div>
    </div>
  </div>;
}

function ManualItemsEditor({ title, field, value, onChange, onCrop, imagePreviews = {}, machineId }) {
  const items = readManualItems(value).map(item => ({
    ...item,
    text: item.text.replace(/^\s*(?:[①-⑳]|[・●•]|\d{1,2}[.．、)](?=\s))\s*/, '')
  }));
  const numbered = field === 'adjustment' || field === 'instructions';
  const marker = index => numbered
    ? index < 20 ? String.fromCodePoint(0x2460 + index) : String(index + 1) + '.'
    : '・';
  function update(index, text) {
    const next = items.slice();
    next[index] = { ...next[index], text: text.replace(/\r?\n/g, ' ') };
    onChange(writeManualItems(next));
  }
  function remove(index) {
    const next = items.filter((_, i) => i !== index);
    onChange(writeManualItems(next.length ? next : [{ text: '', imageId: null }]));
  }
  function changeImage(index, imageId) {
    const next = items.slice();
    next[index] = { ...next[index], imageId };
    onChange(writeManualItems(next));
  }
  return <div className="manual-items-editor">
    <div className="field-label">{title}</div>
    <div className="manual-items-rows">
      {items.map((item, index) => {
        const imageSrc = item.imageId && (imagePreviews[item.imageId]?.url ||
          (machineId ? '/api/manual-image/' + machineId + '/' + item.imageId : null));
        return <div className="manual-item-row" key={index}>
          <span className="manual-item-marker" aria-hidden="true">{marker(index)}</span>
          <div className="manual-item-body">
            <textarea rows={2} className="field manual-item-input"
              aria-label={title + ' ' + marker(index)}
              placeholder={title + 'を入力'}
              value={item.text}
              maxLength={15000}
              onChange={event => update(index, event.target.value)}/>
            {numbered && <div className="manual-item-photo-controls">
              {imageSrc && <img className="manual-item-photo-preview" src={imageSrc}
                alt={title + ' ' + marker(index) + ' に添付した画像'}/>}
              <div className="manual-item-photo-buttons">
                <label className="manual-image-pick">
                  <ImagePlus size={16}/>{item.imageId ? '画像を変更' : '画像を追加（4:3）'}
                  <input type="file" accept="image/*" className="sr-only"
                    onChange={e => {
                      const chosen = e.target.files?.[0];
                      if (chosen) onCrop(field, index, chosen);
                      e.target.value = '';
                    }}/>
                </label>
                {item.imageId && <button type="button" className="manual-image-remove"
                  onClick={() => changeImage(index, null)}>画像を外す</button>}
              </div>
            </div>}
          </div>
          <button type="button" className="icon-button manual-item-remove"
            aria-label={title + 'の' + marker(index) + 'を削除'}
            title="この項目を削除" disabled={items.length === 1}
            onClick={() => remove(index)}><X size={17}/></button>
        </div>;
      })}
    </div>
    <button type="button" className="btn btn-secondary manual-item-add"
      onClick={() => onChange(writeManualItems([...items, { text: '', imageId: null }]))}>
      <Plus size={18}/>追加
    </button>
  </div>;
}

function MachineEditor({ catalog, machine, initialAreaId, refresh, onSaved, onCancel, notify, tidy, inline = false }) {
  // A new registration always starts blank; only editing inherits a machine's area.
  const initialArea = machine
    ? catalog.areas.find(a => a.id === machine.areaId) || catalog.areas[0]
    : null;
  // One manual is edited for all of its store placements. Before the first
  // shared save, recover original identical multi-store copies conservatively.
  const areaNames = [...new Set(catalog.areas.map(area => area.name.trim()).filter(Boolean))];
  const relatedMachines = machine ? catalog.machines.filter(item => {
    if (machine.groupId) return item.groupId === machine.groupId;
    const area = catalog.areas.find(a => a.id === item.areaId);
    return !item.groupId && area &&
      item.name === machine.name &&
      ['overview','adjustment','instructions','tips','safety']
        .every(key => item[key] === machine[key]);
  }) : [];
  const initialRelatedStores = [...new Set(relatedMachines.map(item =>
    catalog.areas.find(area => area.id === item.areaId)?.storeId).filter(Boolean))];
  const [selectedAreaName, setSelectedAreaName] = useState(initialArea?.name.trim() || '');
  const [selectedStoreIds, setSelectedStoreIds] = useState(initialRelatedStores);
  // Placement is independent for each store, while the manual itself stays shared.
  const [storeAreaChoices, setStoreAreaChoices] = useState(() =>
    Object.fromEntries(relatedMachines.map(item => {
      const area = catalog.areas.find(entry => entry.id === item.areaId);
      return area ? [area.storeId,area.id] : null;
    }).filter(Boolean)));
  const groupIdRef = useRef(machine?.groupId || null);
  const createdTargetsRef = useRef(null);
  const [targetsLocked, setTargetsLocked] = useState(false);
  const [name, setName] = useState(machine?.name || '');
  const [fields, setFields] = useState(Object.fromEntries(Object.keys(initialFields).map(k => [k, machine?.[k] || ''])));
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [imagePreviews, setImagePreviews] = useState({});
  const imagePreviewsRef = useRef({});
  const [thumbnailBlob, setThumbnailBlob] = useState(null);
  const [thumbnailPreview, setThumbnailPreview] = useState('');
  const [thumbnailAvailable, setThumbnailAvailable] = useState(false);
  const [thumbnailRemoved, setThumbnailRemoved] = useState(false);
  const thumbnailPreviewRef = useRef(null);
  const workingMachineId = useRef(machine?.id || null);
  const [cropRequest, setCropRequest] = useState(null);
  useEffect(() => () => {
    Object.values(imagePreviewsRef.current).forEach(photo => URL.revokeObjectURL(photo.url));
    if (thumbnailPreviewRef.current) URL.revokeObjectURL(thumbnailPreviewRef.current);
  }, []);
  function beginCrop(field, index, chosenFile) {
    if (chosenFile.size > 20 * 1024 * 1024) {
      notify('元の画像は20MiB以内のものを選択してください。', true);
      return;
    }
    setCropRequest({ field, index, file: chosenFile });
  }
  function beginThumbnailCrop(file) {
    if (file.size > 20 * 1024 * 1024) {
      notify('元の画像は20MiB以内のものを選択してください。', true);
      return;
    }
    setCropRequest({ kind: 'thumbnail', file });
  }
  function acceptCrop(blob) {
    if (!cropRequest) return;
    if (cropRequest.kind === 'thumbnail') {
      if (thumbnailPreviewRef.current) URL.revokeObjectURL(thumbnailPreviewRef.current);
      const previewUrl = URL.createObjectURL(blob);
      thumbnailPreviewRef.current = previewUrl;
      setThumbnailPreview(previewUrl);
      setThumbnailBlob(blob);
      setThumbnailRemoved(false);
      setCropRequest(null);
      return;
    }
    const imageId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(blob);
    const next = { ...imagePreviewsRef.current, [imageId]: { blob, url: previewUrl } };
    imagePreviewsRef.current = next;
    setImagePreviews(next);
    setFields(previous => {
      const items = readManualItems(previous[cropRequest.field]);
      if (!items[cropRequest.index]) return previous;
      items[cropRequest.index] = { ...items[cropRequest.index], imageId };
      return { ...previous, [cropRequest.field]: writeManualItems(items) };
    });
    setCropRequest(null);
  }
  function defaultAreaChoice(storeId,areaName=selectedAreaName) {
    if(!areaName) return '';
    return catalog.areas.find(area =>
      area.storeId===storeId && area.name.trim()===areaName)?.id || 'new:'+areaName;
  }
  function toggleDestination(storeId, selected) {
    if(pending || targetsLocked) return;
    if(selected && (!selectedAreaName || selectedStoreIds.length>=20)) return;
    setSelectedStoreIds(previous => selected
      ? previous.includes(storeId) ? previous : [...previous,storeId]
      : previous.filter(id=>id!==storeId));
    setStoreAreaChoices(previous => {
      const next={...previous};
      if(selected) next[storeId]=defaultAreaChoice(storeId);
      else delete next[storeId];
      return next;
    });
  }
  const destinationSelections=catalog.stores
    .filter(store=>selectedStoreIds.includes(store.id))
    .map(store=>{
      const choice=storeAreaChoices[store.id] || defaultAreaChoice(store.id);
      return {
        storeId:store.id,
        areaId:choice && !choice.startsWith('new:') ? choice : null,
        areaName:choice.startsWith('new:') ? choice.slice(4) : null
      };
    });
  function selectEveryStore() {
    if(pending || targetsLocked || !selectedAreaName) return;
    const ids=catalog.stores.slice(0,20).map(store=>store.id);
    setSelectedStoreIds(ids);
    setStoreAreaChoices(previous=>Object.fromEntries(ids.map(storeId=>[
      storeId,previous[storeId] || defaultAreaChoice(storeId)
    ])));
  }
  async function save() {
    if (!name.trim() || !selectedAreaName || !selectedStoreIds.length ||
      destinationSelections.some(row=>!row.areaId && !row.areaName)) {
      notify('エリア・店舗・マシン名を指定してください。', true);
      return;
    }
    if (selectedStoreIds.length > 20) {
      notify('登録先は最大20店舗です。', true);
      return;
    }
    if (createdTargetsRef.current &&
      (createdTargetsRef.current.length !== destinationSelections.length ||
        createdTargetsRef.current.some((row,index) =>
          row.storeId !== destinationSelections[index]?.storeId ||
          row.areaChoice !== (destinationSelections[index]?.areaId ||
            'new:'+destinationSelections[index]?.areaName)))) {
      notify('保存途中のため、店舗を変更せずに再度保存してください。', true);
      return;
    }
    try {
      setPending(true);
      setProgress('共通のマシン情報を保存しています…');
      const uploadedPhotoIds = new Set(['adjustment','instructions'].flatMap(field =>
        readManualItems(fields[field]).map(item => item.imageId)
          .filter(imageId => imagePreviews[imageId])));
      // Never publish references to photos until their bytes have been uploaded.
      const staged = { ...fields };
      for (const field of ['adjustment','instructions']) {
        staged[field] = writeManualItems(readManualItems(fields[field]).map(item => ({
          ...item, imageId: uploadedPhotoIds.has(item.imageId) ? null : item.imageId
        })));
      }
      const data = {
        groupId: groupIdRef.current || undefined,
        seedMachineId: machine && !groupIdRef.current ? machine.id : undefined,
        name: name.trim(),areaName:selectedAreaName,
        storeIds:destinationSelections.map(item => item.storeId),
        storeSelections:destinationSelections
      };
      const first = await send('/api/admin/manual-groups','POST',{
        ...data,...(uploadedPhotoIds.size ? staged : fields)
      });
      if (!first.groupId || !Array.isArray(first.ids) ||
          first.ids.length !== destinationSelections.length) {
        throw new Error('保存結果を確認できませんでした。登録済み一覧をご確認ください。');
      }
      groupIdRef.current = first.groupId;
      createdTargetsRef.current = first.ids.map((id,index) => ({
        id,storeId:destinationSelections[index].storeId,areaId:first.areaIds[index],
        areaChoice:destinationSelections[index].areaId ||
          'new:'+destinationSelections[index].areaName
      }));
      workingMachineId.current = first.ids[0];
      setTargetsLocked(true);
      const photos=[...uploadedPhotoIds];
      for(let i=0;i<photos.length;i++){
        const imageId=photos[i];
        setProgress('共通画像を保存しています… '+(i+1)+' / '+photos.length);
        await api('/api/admin/manual-groups/'+first.groupId+'/images/'+imageId,{
          method:'PUT',headers:{'content-type':'image/jpeg'},
          body:imagePreviews[imageId].blob
        });
      }
      if(photos.length) {
        setProgress('取扱説明書を更新しています…');
        await send('/api/admin/manual-groups','POST',{
          ...data,groupId:first.groupId,seedMachineId:undefined,...fields
        });
      }
      if(thumbnailBlob){
        setProgress('選択画面の画像を保存しています…');
        await api('/api/admin/manual-groups/'+first.groupId+'/thumbnail',{
          method:'PUT',headers:{'content-type':'image/jpeg'},body:thumbnailBlob
        });
      } else if(thumbnailRemoved && machine) {
        await api('/api/admin/manual-groups/'+first.groupId+'/thumbnail',{method:'DELETE'});
      }
      await refresh();
      await tidy();
      const oldPreviews=imagePreviewsRef.current;
      imagePreviewsRef.current={};
      setImagePreviews({});
      Object.values(oldPreviews).forEach(photo=>URL.revokeObjectURL(photo.url));
      if(thumbnailPreviewRef.current) URL.revokeObjectURL(thumbnailPreviewRef.current);
      thumbnailPreviewRef.current=null;
      setThumbnailBlob(null);
      setThumbnailPreview('');
      setThumbnailRemoved(false);
      notify(machine ? '共通のマシン情報を更新しました。' :
        destinationSelections.length+'店舗に共通マシンを登録しました。');
      onSaved(first.ids[0]);
    } catch(error) {
      notify(error.message+'（保存状況を登録済み一覧でご確認ください）',true);
      await refresh();
    } finally {
      setPending(false);
      setProgress('');
    }
  }
  return <div className="space-y-4"><div className="admin-card"><div className="flex justify-between items-center mb-5"><h3 className="card-title !mb-0">{machine ? '共通マシンを編集' : 'マシンを追加'}</h3>{!inline && <button onClick={onCancel} className="icon-button" aria-label="編集画面を閉じる"><X size={19}/></button>}</div>
    <div className="space-y-4"><div className="manual-multistore">
      <Field title={machine ? '① 新しく選ぶ店舗の基本エリア' : '① 基本エリアを選択（1つ）'}>
        <select className={fieldInput} value={selectedAreaName}
          disabled={pending || targetsLocked}
          onChange={event => {
            const nextName=event.target.value;
            setSelectedAreaName(nextName);
            if(!machine) setStoreAreaChoices(Object.fromEntries(
              selectedStoreIds.map(storeId=>[storeId,defaultAreaChoice(storeId,nextName)])));
          }}>
          <option value="" disabled>{areaNames.length ? 'エリアを選択してください' : 'エリアを登録してください'}</option>
          {areaNames.map(areaName => <option key={areaName} value={areaName}>{areaName}</option>)}
        </select>
      </Field>
      {!areaNames.length && <p className="manual-multistore-note">
        先に「エリア」タブから、登録するエリアを作成してください。
      </p>}
      <div className="manual-multistore-heading manual-multistore-store-heading">
        <div className="field-label">② 店舗を選択（複数選択可）</div>
        <button type="button" className="manual-multistore-select-all"
          disabled={pending || targetsLocked || !selectedAreaName || !catalog.stores.length}
          onClick={selectEveryStore}>すべて選択</button>
        <button type="button" className="manual-multistore-clear"
          disabled={pending || targetsLocked || !selectedStoreIds.length}
          onClick={() => {setSelectedStoreIds([]);setStoreAreaChoices({});}}>選択解除</button>
      </div>
      <div className="manual-multistore-list">
        {catalog.stores.map(store => {
          const selected = selectedStoreIds.includes(store.id);
          const storeAreas=catalog.areas.filter(area=>area.storeId===store.id);
          const choice=storeAreaChoices[store.id] || defaultAreaChoice(store.id);
          return <div className="manual-multistore-row" key={store.id}>
            <label className="manual-multistore-checkbox">
              <input type="checkbox" checked={selected}
                disabled={pending || targetsLocked || !selectedAreaName ||
                  (!selected && selectedStoreIds.length >= 20)}
                onChange={event => toggleDestination(store.id,event.target.checked)}/>
              <span>{store.name}</span>
            </label>
            {selected && <label className="manual-multistore-area">
              <span>この店舗の配置エリア</span>
              <select className={fieldInput} value={choice}
                disabled={pending || targetsLocked}
                onChange={event=>setStoreAreaChoices(previous=>({
                  ...previous,[store.id]:event.target.value
                }))}>
                {storeAreas.map(area=><option key={area.id} value={area.id}>{area.name}</option>)}
                {areaNames.filter(areaName=>!storeAreas.some(area=>
                  area.name.trim()===areaName)).map(areaName=>
                  <option key={'new:'+areaName} value={'new:'+areaName}>
                    {areaName}（新規作成）
                  </option>)}
              </select>
            </label>}
          </div>;
        })}
      </div>
      <p className="manual-multistore-note">
        選択中：{destinationSelections.length}店舗。
        配置エリアは店舗ごとに設定できます。マシン情報と画像は全店舗共通です。
      </p>
    </div><Field title="マシン名"><input className={fieldInput} value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="例：チェストプレス"/></Field>
    <div className="divider-line"/>
    {CONTENT_FIELDS.map(([key, title], i) => key === 'overview'
      ? <Field key={key} title={`${num(i + 1)} ${title}`}><textarea className={`${fieldInput} textarea`} rows={3} value={fields[key]} onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))} maxLength={15000} placeholder={`${title}を入力してください`}/></Field>
      : <ManualItemsEditor key={key} title={`${num(i + 1)} ${title}`} field={key}
          value={fields[key]} onChange={value => setFields(prev => ({ ...prev, [key]: value }))}
          onCrop={beginCrop} imagePreviews={imagePreviews} machineId={workingMachineId.current}/>)}
      <div className="machine-thumbnail-settings">
        <div className="field-label">選択画面用画像（正方形・1:1）</div>
        <p className="machine-thumbnail-help">マシン選択画面の四角い画像です。写真を動かしたり拡大したりして正方形に切り抜けます。</p>
        <div className="machine-thumbnail-preview">
          {thumbnailPreview
            ? <img src={thumbnailPreview} alt="選択画面用画像のプレビュー"/>
            : machine && !thumbnailRemoved
              ? <img src={'/api/machine-thumbnail/' + machine.id} alt="登録済みの選択画面用画像"
                  onLoad={() => setThumbnailAvailable(true)}
                  onError={() => setThumbnailAvailable(false)}
                  style={{ display: thumbnailAvailable ? 'block' : 'none' }}/>
              : null}
          {!thumbnailPreview && (!machine || thumbnailRemoved || !thumbnailAvailable) &&
            <div className="machine-thumbnail-placeholder" aria-hidden="true">
              <ImagePlus size={24}/><span>画像未登録</span>
            </div>}
        </div>
        <div className="manual-item-photo-buttons">
          <label className="manual-image-pick">
            <ImagePlus size={16}/>{thumbnailPreview || (thumbnailAvailable && !thumbnailRemoved)
              ? '画像を変更' : '画像を追加（1:1）'}
            <input type="file" accept="image/*" className="sr-only"
              disabled={pending}
              onChange={e => {
                const selected = e.target.files?.[0];
                if (selected) beginThumbnailCrop(selected);
                e.target.value = '';
              }}/>
          </label>
          {(thumbnailPreview || (thumbnailAvailable && !thumbnailRemoved)) &&
            <button type="button" className="manual-image-remove" disabled={pending}
              onClick={() => {
                if (thumbnailPreviewRef.current) URL.revokeObjectURL(thumbnailPreviewRef.current);
                thumbnailPreviewRef.current = null;
                setThumbnailPreview('');
                setThumbnailBlob(null);
                setThumbnailRemoved(true);
                setThumbnailAvailable(false);
              }}>画像を削除</button>}
        </div>
      </div>
    </div><div className="mt-5 space-y-2">{progress && <div className="text-white text-sm flex gap-2 items-center"><LoaderCircle size={16} className="animate-spin"/>{progress}</div>}<Action pending={pending} className="w-full" onClick={save}>{machine ? 'すべての店舗に変更を保存' : destinationSelections.length > 1 ? destinationSelections.length + '店舗に共通マシンを登録' : 'マシンを登録'}</Action></div></div>{machine && <QRPanel machine={machine}/>}
    {cropRequest && <ManualImageCropper file={cropRequest.file} onApply={acceptCrop}
      square={cropRequest.kind === 'thumbnail'}
      onCancel={() => setCropRequest(null)}/>}
  </div>;
}
function MachinesAdmin({ catalog, refresh, notify, tidy }) {
  const [storeFilter, setStoreFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [selectedId, setSelectedId] = useState(undefined);
  const [createKey, setCreateKey] = useState(0);
  // Group shared manuals once; legacy independent copies are only grouped
  // when both their names and complete instructions are identical.
  const groupedMap=new Map();
  for(const entry of catalog.machines){
    const key=entry.groupId ? 'shared:'+entry.groupId :
      'legacy:'+JSON.stringify([entry.name,entry.overview,entry.adjustment,
        entry.instructions,entry.tips,entry.safety]);
    if(!groupedMap.has(key)) groupedMap.set(key,{key,machine:entry,members:[]});
    groupedMap.get(key).members.push(entry);
  }
  const groupedMachines=[...groupedMap.values()];
  const selectedStore = catalog.stores.find(s => s.id === storeFilter) || catalog.stores[0];
  const areas = catalog.areas.filter(a => a.storeId === selectedStore?.id);
  const selectedArea = areas.find(a => a.id === areaFilter) || areas[0];
  const machines = catalog.machines.filter(m => m.areaId === selectedArea?.id);
  const selectedMachine = catalog.machines.find(m => m.id === selectedId);
  const editing = selectedId !== undefined;
  async function move(machine, amount) {
    const current = machines.findIndex(m => m.id === machine.id);
    const next = current + amount;
    if (next < 0 || next >= machines.length) return;
    const ids = machines.map(m => m.id);
    [ids[current], ids[next]] = [ids[next], ids[current]];
    try {
      await send(`/api/admin/areas/${selectedArea.id}/reorder`, 'POST', { ids });
      await refresh();
      notify('並び順を変更しました。');
    } catch (e) { notify(e.message, true); }
  }
  async function remove(group) {
    const ids=group.members.map(item=>item.id);
    const stores=new Set(group.members.map(item=>
      catalog.areas.find(area=>area.id===item.areaId)?.storeId).filter(Boolean));
    const count=stores.size;
    if (!window.confirm(`「${group.machine.name}」を登録先${count}店舗すべてから削除しますか？
取扱説明書と画像が削除され、各店舗のQRコードも無効になります。`)) return;
    try {
      if(group.machine.groupId)
        await api('/api/admin/manual-groups/'+group.machine.groupId,{method:'DELETE'});
      else
        for(const id of ids) await api('/api/admin/machines/'+id,{method:'DELETE'});
      if(ids.includes(selectedId))setSelectedId(undefined);
      await refresh();
      await tidy();
      notify('全店舗のマシン登録を削除しました。');
    } catch(error) {
      await refresh();
      notify(error.message+'（削除状況を一覧で確認してください）',true);
    }
  }
  if (editing) return <div className="space-y-4">
    <button className="back-btn" onClick={() => setSelectedId(undefined)}>
      <ArrowLeft size={18}/>マシン一覧
    </button>
    <MachineEditor key={selectedId} machine={selectedMachine} catalog={catalog}
      initialAreaId={selectedArea?.id} refresh={refresh}
      onSaved={() => setSelectedId(undefined)} onCancel={() => setSelectedId(undefined)}
      notify={notify} tidy={tidy}/>
  </div>;
  return <div className="space-y-4">
    {catalog.stores.length
      ? <MachineEditor key={'create-' + createKey} inline catalog={catalog}
          refresh={refresh}
          onSaved={() => setCreateKey(key => key + 1)}
          onCancel={() => {}} notify={notify} tidy={tidy}/>
      : <div className="admin-card">
          <h3 className="card-title">マシンを追加</h3>
          <Empty title="店舗がありません" description="先に「店舗」タブから店舗を登録してください。"/>
        </div>}
    <div className="admin-card space-y-4">
      <h3 className="card-title">
        登録済みマシン <span className="count">{groupedMachines.length}</span>
      </h3>
      {groupedMachines.length ? groupedMachines.map(group=>{
        const areasByName=new Map();
        for(const item of group.members){
          const area=catalog.areas.find(entry=>entry.id===item.areaId);
          const store=catalog.stores.find(entry=>entry.id===area?.storeId);
          if(!area || !store) continue;
          if(!areasByName.has(area.name)) areasByName.set(area.name,[]);
          if(!areasByName.get(area.name).includes(store.name))
            areasByName.get(area.name).push(store.name);
        }
        return <div className="machine-group-row" key={group.key}>
          <div className="machine-group-content">
            <div className="machine-group-name">{group.machine.name}</div>
            <div className="machine-group-areas">
              {[...areasByName.entries()].map(([areaName,storeNames])=>
                <div className="machine-group-area-line" key={areaName}>
                  ｜{areaName} ・{storeNames.join('/')}｜
                </div>)}
            </div>
          </div>
          <SmallActions
            onEdit={()=>setSelectedId(group.machine.id)}
            onDelete={()=>remove(group)}/>
        </div>;
      }) : <Empty title="登録済みマシンがありません"
        description="上の登録画面からマシンを追加してください。"/>}
      <details className="machine-sort-details">
        <summary>店舗・エリア別の表示順を変更</summary>
        <div className="space-y-4 pt-4">
          <Field title="店舗を選択">
            <select className={fieldInput} value={selectedStore?.id || ''}
              onChange={e=>{setStoreFilter(e.target.value);setAreaFilter('');}}>
              {catalog.stores.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </Field>
          <Field title="エリアを選択">
            <select className={fieldInput} value={selectedArea?.id || ''}
              onChange={e=>setAreaFilter(e.target.value)}>
              {areas.map(area=><option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </Field>
          <p className="manual-multistore-note">
            店舗のマシン選択画面に表示する順番を調整します。
          </p>
          {machines.map((item,index)=><div className="machine-row" key={item.id}>
            <div className="flex flex-col gap-1.5">
              <button aria-label={item.name+'を上へ'} disabled={index===0}
                className="arrow-button" onClick={()=>move(item,-1)}>
                <ArrowUp size={17}/>
              </button>
              <button aria-label={item.name+'を下へ'} disabled={index===machines.length-1}
                className="arrow-button" onClick={()=>move(item,1)}>
                <ArrowDown size={17}/>
              </button>
            </div>
            <span className="text-xs font-bold text-neutral-300 w-6 text-center">{num(index)}</span>
            <span className="font-semibold text-white flex-1 min-w-0">{item.name}</span>
          </div>)}
          {!machines.length && <p className="manual-multistore-note">
            この店舗・エリアにはマシンが登録されていません。
          </p>}
        </div>
      </details>
    </div>
  </div>;
}
function Login({ onLogin, notify }) {
  const [password, setPassword] = useState(''); const [pending, setPending] = useState(false);
  async function submit(e) { e.preventDefault(); try { setPending(true); await send('/api/admin/login', 'POST', { password }); setPassword(''); onLogin(); } catch (err) { notify(err.message, true); } finally { setPending(false); } }
  return <div className="min-h-[75vh] flex items-center justify-center"><form className="login-card w-full" onSubmit={submit}><div className="mx-auto w-15 h-15 rounded-2xl flex items-center justify-center bg-white/10 text-white mb-6"><LockKeyhole size={28}/></div><div className="eyebrow text-center">STAFF ONLY</div><h1 className="text-2xl font-bold text-center mt-3 mb-3">管理者アクセス</h1><p className="text-sm text-neutral-200 text-center leading-relaxed mb-6">一般の利用者は認証不要です。<br/>編集には管理者パスワードが必要です。</p><Field title="管理者パスワード"><input type="password" autoComplete="current-password" className={fieldInput} value={password} onChange={e => setPassword(e.target.value)} placeholder="管理者パスワード" required /></Field><button className="btn btn-primary w-full mt-5" disabled={pending}>{pending ? <LoaderCircle size={18} className="animate-spin"/> : <LockKeyhole size={17}/>}管理画面を開く</button></form></div>;
}
function Admin({ catalog, refresh, error, logoRevision, onLogoChanged }) {
  const [auth, setAuth] = useState('checking');
  const [tab, setTab] = useState('machines');
  const [notice, setNotice] = useState(null);
  useEffect(() => { api('/api/admin/session').then(() => setAuth('in')).catch(() => setAuth('out')); }, []);
  async function tidy() {
    for (let i = 0; i < 20; i++) {
      const result = await api('/api/admin/maintenance', { method: 'POST' });
      if (!result.remaining) break;
    }
  }
  useEffect(() => { if (auth === 'in') tidy().catch(() => {}); }, [auth]);
  function notify(message, isError = false) { setNotice({ message, isError }); }
  async function logout() { try { await api('/api/admin/logout', { method: 'POST' }); } catch {} setAuth('out'); setNotice(null); }
  return <div className="min-h-screen">
    <main className="shell pb-22"><div className="hero admin-hero"><div className="eyebrow">STAFF CONTROL CENTER</div><h1 className="hero-title">管理画面<span className="hero-period">.</span></h1><p className="hero-sub">店舗・エリア・マシンとQRコードを一括管理</p></div>
      {notice && <div className="mb-4"><Alert kind={notice.isError ? 'error' : 'ok'}>{notice.message}</Alert><button className="text-xs text-neutral-300 mt-2" onClick={() => setNotice(null)}>閉じる</button></div>}
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {auth === 'checking' ? <Skeleton/> : auth === 'out' ? <Login onLogin={() => { setAuth('in'); refresh(); }} notify={notify}/> : <>
        <div className="flex items-center justify-between mb-5"><span className="staff-badge"><Check size={14}/> 管理者モード</span><button onClick={logout} className="text-xs text-neutral-200 flex items-center gap-1 hover:text-white"><LogOut size={15}/>ログアウト</button></div>
        <div className="tab-bar tab-bar-four"><Chip active={tab==='stores'} onClick={() => setTab('stores')}><MapPin size={17}/>店舗</Chip><Chip active={tab==='areas'} onClick={() => setTab('areas')}><Layers3 size={17}/>エリア</Chip><Chip active={tab==='machines'} onClick={() => setTab('machines')}><Dumbbell size={17}/>マシン</Chip><Chip active={tab==='logo'} onClick={() => setTab('logo')}><ImagePlus size={17}/>ロゴ</Chip></div>
        {tab === 'machines' ? <MachinesAdmin catalog={catalog} refresh={refresh} notify={notify} tidy={tidy}/> : tab === 'areas' ? <AreasAdmin catalog={catalog} refresh={refresh} notify={notify} tidy={tidy}/> : tab === 'stores' ? <StoresAdmin catalog={catalog} refresh={refresh} notify={notify} tidy={tidy}/> : <LogoAdmin logoRevision={logoRevision} onLogoChanged={onLogoChanged} notify={notify}/>} 
        <div className="admin-footer"><ShieldAlert size={16}/> QRコードからの視聴にログインは不要です。<br/>管理者パスワードは第三者に共有しないでください。</div>
      </>}
    </main></div>;
}
export default function App() {
  const { catalog, loading, error, refresh } = useCatalog();
  const [route, navigate] = useRoute();
  const [logoRevision, setLogoRevision] = useState(() => Date.now());
  const onLogoChanged = () => setLogoRevision(Date.now());
  const page = route === '/admin' || route.startsWith('/admin/')
    ? <Admin catalog={catalog} refresh={refresh} error={error} logoRevision={logoRevision} onLogoChanged={onLogoChanged}/>
    : <Viewer catalog={catalog} loading={loading} error={error} route={route} navigate={navigate} refresh={refresh}/>;
  return <><SiteHeader logoRevision={logoRevision}/><div className="page-under-header">{page}</div></>;
}
