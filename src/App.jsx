import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCircle2, ChevronRight,
  ClipboardList, Download, Dumbbell, Edit3, ExternalLink, Film, FolderOpen, Info,
  Layers3, Link2, LoaderCircle, LockKeyhole, LogOut, MapPin, Menu, Plus, QrCode,
  Save, Settings2, Share2, ShieldAlert, Smartphone, Sparkles, Trash2, UploadCloud,
  Video, X
} from 'lucide-react';
import QRCode from 'qrcode';

const EMPTY = { stores: [], areas: [], machines: [] };
const CONTENT_FIELDS = [
  ['overview', '概要', 'マシンの目的や鍛えられる部位などをご案内します。', Info],
  ['adjustment', '調整方法', 'シートの高さやパッドの位置などを調整してください。', Settings2],
  ['instructions', '操作手順', '開始姿勢から動作の流れを順番にご案内します。', ClipboardList],
  ['tips', 'ポイント', 'フォームや呼吸のコツを確認しましょう。', Sparkles],
  ['safety', '安全上の注意事項', '無理のない重量を設定し、周囲の安全を確認してください。', ShieldAlert],
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
function ViewerSection({ index, title, description, Icon, textValue }) {
  return <section className="manual-section"><div className="section-heading"><div className="section-icon"><Icon size={19}/></div><div><div className="eyebrow">STEP {num(index)}</div><h2 className="font-semibold text-[17px] text-white">{title}</h2></div></div><p className={`manual-text ${textValue ? '' : 'text-neutral-300'}`}>{textValue || '内容はまだ登録されていません。'}</p></section>;
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
  return <div className="min-h-screen"><header className="top-header"><div className="shell flex items-center justify-between"><Brand/><span className="top-label"><span className="tiny-dot"/> FREE ACCESS</span></div></header>
    <main className="shell pb-24">
      <div className="hero"><div className="mb-4">{(isMachinePage || isAreaPage || isStorePage) && <Back onClick={backAction}/>}</div>
        <div className="eyebrow tracking-[.24em]">{label}</div><h1 className="hero-title">{title}<span className="hero-period">.</span></h1>
        <p className="hero-sub">{isMachinePage ? [currentStore?.name, currentArea?.name, machine?.name].filter(Boolean).join(' / ') : isAreaPage ? `${currentStore?.name || '店舗'}のマシンを選択してください` : isStorePage ? `${store?.name || '店舗'}のエリアを選択してください` : 'ご利用中の店舗を選択してください'}</p>
      </div>
      {loading ? <Skeleton/> : error ? <div className="mt-6"><Alert>{error}</Alert><button onClick={refresh} className="btn btn-primary mt-4">再読み込み</button></div> : hasMissing ? <Empty title="対象が見つかりません" description="URLが変更されたか、マシンが削除された可能性があります。"/> : isMachinePage ? <div className="space-y-4">
        <section className="video-container"><div className="video-bar"><span className="flex items-center gap-2"><span className="live-marker"/> HOW TO USE</span><span>01 / 06</span></div>{machine.videoId ? <video className="w-full aspect-video bg-black" src={`/api/video/${machine.videoId}`} controls playsInline preload="metadata"/> : <div className="video-placeholder"><Film size={40} strokeWidth={1.4}/><span className="mt-3 text-base">動画は準備中です</span><span className="text-xs text-neutral-300 mt-2">下の文章から使い方をご確認ください</span></div>}</section>
        <div className="machine-summary"><span className="machine-summary-badge"><Dumbbell size={15}/> MACHINE GUIDE</span><h2 className="text-2xl font-bold tracking-tight mt-3">{machine.name}</h2><p className="text-sm text-neutral-200 mt-1">正しい使用方法と安全上の注意をご確認ください。</p></div>
        <div className="space-y-3">{CONTENT_FIELDS.map(([key, title, desc, Icon], i) => <ViewerSection key={key} index={i + 2} title={title} description={desc} Icon={Icon} textValue={machine[key]}/>)}</div>
        <button className="btn btn-secondary w-full" onClick={backAction}><ArrowLeft size={17}/> マシン一覧に戻る</button>
      </div> : list.length ? <div className="space-y-3 mt-6">
        <div className="list-caption"><span>{isAreaPage ? 'MACHINES' : isStorePage ? 'AREAS' : 'LOCATIONS'}</span><span>{list.length} ITEMS</span></div>
        {list.map((item, i) => <button className="selection-card group" key={item.id} onClick={() => navigate(`/${isAreaPage ? 'machine' : isStorePage ? 'area' : 'store'}/${item.id}`)}><span className="selection-index">{num(i)}</span><div className="selection-icon">{isAreaPage ? <Dumbbell size={24}/> : isStorePage ? <Layers3 size={24}/> : <MapPin size={24}/>}</div><div className="flex-1 text-left min-w-0"><div className="font-semibold text-white text-[17px] truncate">{item.name}</div><div className="text-xs text-neutral-300 mt-1">{isAreaPage ? '使い方を見る' : isStorePage ? 'マシン一覧を見る' : 'エリア一覧を見る'}</div></div><ChevronRight className="text-white shrink-0 group-hover:translate-x-1 transition-transform" size={22}/></button>)}
      </div> : <Empty title={isAreaPage ? 'マシンが登録されていません' : isStorePage ? 'エリアが登録されていません' : '店舗が登録されていません'} description="店舗スタッフによる登録をお待ちください。"/>}
    </main><div className="footer-note">FIT MANUAL <span className="px-2">•</span> TRAIN SMART. STAY SAFE.</div>
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
    if (!window.confirm(`「${s.name}」を削除しますか？所属するエリア・マシン・動画も削除されます。`)) return;
    try { await api(`/api/admin/stores/${s.id}`, { method: 'DELETE' }); await refresh(); await tidy(); if (editing === s.id) reset(); notify('店舗を削除しました。'); } catch (e) { notify(e.message, true); }
  }
  return <div className="space-y-4"><div className="admin-card"><h3 className="card-title">{editing ? '店舗を編集' : '店舗を追加'}</h3><Field title="店舗名"><input className={fieldInput} value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="例：江古田店"/></Field><div className="flex gap-2 mt-4"><Action onClick={save} pending={pending} className="flex-1">{editing ? '変更を保存' : '店舗を登録'}</Action>{editing && <button onClick={reset} className="btn btn-secondary"><X size={17}/>取消</button>}</div></div>
  <div className="admin-card"><h3 className="card-title">登録済み店舗 <span className="count">{catalog.stores.length}</span></h3>{catalog.stores.length ? catalog.stores.map(s => <div key={s.id} className="admin-row"><span className="row-icon"><MapPin size={18}/></span><div className="flex-1 min-w-0"><p className="font-medium text-white truncate">{s.name}</p><p className="text-xs text-neutral-300 mt-0.5">{catalog.areas.filter(a => a.storeId === s.id).length} エリア</p></div><SmallActions onEdit={() => { setEditing(s.id); setName(s.name); }} onDelete={() => remove(s)}/></div>) : <Empty title="店舗はまだありません" description="まず店舗を登録してください。"/>}</div></div>;
}
function AreasAdmin({ catalog, refresh, notify, tidy }) {
  const [editing, setEditing] = useState(null); const [name, setName] = useState(''); const [storeId, setStoreId] = useState(''); const [pending, setPending] = useState(false);
  const selectedStore = storeId || catalog.stores[0]?.id || '';
  function reset() { setEditing(null); setName(''); setStoreId(''); }
  async function save() {
    try { setPending(true); await send(editing ? `/api/admin/areas/${editing}` : '/api/admin/areas', editing ? 'PATCH' : 'POST', { name, storeId: selectedStore }); await refresh(); reset(); notify('エリアを保存しました。'); }
    catch (e) { notify(e.message, true); } finally { setPending(false); }
  }
  async function remove(a) {
    if (!window.confirm(`「${a.name}」を削除しますか？所属するマシンと動画も削除されます。`)) return;
    try { await api(`/api/admin/areas/${a.id}`, { method: 'DELETE' }); await refresh(); await tidy(); if (editing === a.id) reset(); notify('エリアを削除しました。'); } catch (e) { notify(e.message, true); }
  }
  return <div className="space-y-4"><div className="admin-card"><h3 className="card-title">{editing ? 'エリアを編集' : 'エリアを追加'}</h3><div className="space-y-4"><Field title="店舗"><select className={fieldInput} value={selectedStore} onChange={e => setStoreId(e.target.value)}><option value="">店舗を選択</option>{catalog.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field title="エリア名"><input className={fieldInput} value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="例：有酸素エリア"/></Field></div><div className="flex gap-2 mt-4"><Action pending={pending || !catalog.stores.length} onClick={save} className="flex-1">{editing ? '変更を保存' : 'エリアを登録'}</Action>{editing && <button className="btn btn-secondary" onClick={reset}>取消</button>}</div></div>
  <div className="admin-card"><h3 className="card-title">登録済みエリア <span className="count">{catalog.areas.length}</span></h3>{catalog.areas.length ? catalog.areas.map(a => <div className="admin-row" key={a.id}><span className="row-icon"><Layers3 size={18}/></span><div className="flex-1 min-w-0"><p className="font-medium text-white truncate">{a.name}</p><p className="text-xs text-neutral-300 mt-0.5">{catalog.stores.find(s => s.id === a.storeId)?.name || ''} ・ {catalog.machines.filter(m => m.areaId === a.id).length} 台</p></div><SmallActions onEdit={() => { setEditing(a.id); setName(a.name); setStoreId(a.storeId); }} onDelete={() => remove(a)}/></div>) : <Empty title="エリアはまだありません" description="店舗を登録した後、エリアを追加してください。"/>}</div></div>;
}
const initialFields = { overview: '', adjustment: '', instructions: '', tips: '', safety: '' };
function MachineEditor({ catalog, machine, initialAreaId, refresh, onSaved, onCancel, notify, tidy }) {
  const initialArea = catalog.areas.find(a => a.id === (machine?.areaId || initialAreaId)) || catalog.areas[0];
  const [storeId, setStoreId] = useState(initialArea?.storeId || '');
  const [areaId, setAreaId] = useState(initialArea?.id || '');
  const [name, setName] = useState(machine?.name || '');
  const [fields, setFields] = useState(Object.fromEntries(Object.keys(initialFields).map(k => [k, machine?.[k] || ''])));
  const [file, setFile] = useState(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const shownAreas = catalog.areas.filter(a => a.storeId === storeId);
  function onStoreChange(id) { setStoreId(id); setAreaId(catalog.areas.find(a => a.storeId === id)?.id || ''); }
  async function upload(machineId, sourceFile) {
    const mime = sourceFile.type || (sourceFile.name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : '');
    const { videoId, chunkSize, chunkCount } = await send(`/api/admin/machines/${machineId}/video/init`, 'POST', { filename: sourceFile.name, mimeType: mime, size: sourceFile.size });
    for (let i = 0; i < chunkCount; i++) {
      setProgress(`動画アップロード中 ${i + 1} / ${chunkCount}`);
      const chunk = sourceFile.slice(i * chunkSize, Math.min(sourceFile.size, (i + 1) * chunkSize));
      const response = await api(`/api/admin/videos/${videoId}/chunks/${i}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: chunk });
      if (!response?.ok) throw new Error('動画アップロードに失敗しました。');
    }
    setProgress('動画の登録を完了しています…');
    await send(`/api/admin/videos/${videoId}/finish`, 'POST', {});
  }
  async function save() {
    if (!name.trim() || !areaId) { notify('マシン名とエリアを入力してください。', true); return; }
    if (file && (file.size > 80 * 1024 * 1024 || !['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type || (file.name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : '')))) { notify('MP4・WebM・MOV、80MiB以内の動画を選択してください。', true); return; }
    try {
      setPending(true); setProgress('マシン情報を保存しています…');
      const result = await send(machine ? `/api/admin/machines/${machine.id}` : '/api/admin/machines', machine ? 'PATCH' : 'POST', { name: name.trim(), areaId, ...fields });
      const id = machine?.id || result.id;
      if (file) await upload(id, file);
      await refresh(); await tidy(); setFile(null); notify('マシンの情報を保存しました。'); onSaved(id);
    } catch (e) { notify(`${e.message}（情報だけ保存されている場合があります）`, true); await refresh(); }
    finally { setPending(false); setProgress(''); }
  }
  async function deleteVideo() {
    if (!machine?.videoId || !window.confirm('このマシンの動画を削除しますか？')) return;
    try { await api(`/api/admin/videos/${machine.videoId}`, { method: 'DELETE' }); await refresh(); await tidy(); notify('動画を削除しました。'); } catch (e) { notify(e.message, true); }
  }
  return <div className="space-y-4"><div className="admin-card"><div className="flex justify-between items-center mb-5"><h3 className="card-title !mb-0">{machine ? 'マシンを編集' : '新しいマシンを登録'}</h3><button onClick={onCancel} className="icon-button"><X size={19}/></button></div>
    <div className="space-y-4"><Field title="店舗"><select className={fieldInput} value={storeId} onChange={e => onStoreChange(e.target.value)}>{catalog.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field title="エリア"><select className={fieldInput} value={areaId} onChange={e => setAreaId(e.target.value)}>{shownAreas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field title="マシン名"><input className={fieldInput} value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="例：チェストプレス"/></Field>
    <div className="divider-line"/><Field title="動画ファイル（直接アップロード）" hint="MP4推奨 / 最大80MiB。動画がない場合は文章のみでも登録できます。"><label className="upload-zone"><UploadCloud size={25} className="text-white"/><span className="text-sm text-white">{file ? file.name : 'タップして動画を選ぶ'}</span><span className="text-xs text-neutral-300">MP4 / WebM / MOV</span><input type="file" className="sr-only" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" onChange={e => setFile(e.target.files?.[0] || null)}/></label></Field>
    {machine?.videoId && <div className="existing-video"><div className="flex gap-2 items-center text-sm text-white"><CheckCircle2 size={17} className="text-white"/>登録済み動画：{machine.videoFilename || '動画ファイル'}</div><div className="flex gap-2 mt-3"><a href={`/api/video/${machine.videoId}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-xs flex-1"><Video size={15}/> 動画を開く</a><button className="btn btn-danger text-xs" onClick={deleteVideo}><Trash2 size={15}/> 削除</button></div></div>}
    {CONTENT_FIELDS.map(([key, title], i) => <Field key={key} title={`${num(i + 1)} ${title}`}><textarea className={`${fieldInput} textarea`} rows={key === 'instructions' ? 5 : 3} value={fields[key]} onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))} maxLength={15000} placeholder={`${title}を入力してください`}/></Field>)}
    </div><div className="mt-5 space-y-2">{progress && <div className="text-white text-sm flex gap-2 items-center"><LoaderCircle size={16} className="animate-spin"/>{progress}</div>}<Action pending={pending} className="w-full" onClick={save}>{machine ? 'マシン情報を更新' : 'マシンを登録'}</Action></div></div>{machine && <QRPanel machine={machine}/>}</div>;
}
function MachinesAdmin({ catalog, refresh, notify, tidy }) {
  const [storeFilter, setStoreFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [selectedId, setSelectedId] = useState(undefined);
  const selectedStore = catalog.stores.find(s => s.id === storeFilter) || catalog.stores[0];
  const areas = catalog.areas.filter(a => a.storeId === selectedStore?.id);
  const selectedArea = areas.find(a => a.id === areaFilter) || areas[0];
  const machines = catalog.machines.filter(m => m.areaId === selectedArea?.id);
  const selectedMachine = catalog.machines.find(m => m.id === selectedId);
  const editing = selectedId !== undefined;
  async function move(machine, amount) {
    const current = machines.findIndex(m => m.id === machine.id); const next = current + amount;
    if (next < 0 || next >= machines.length) return;
    const ids = machines.map(m => m.id); [ids[current], ids[next]] = [ids[next], ids[current]];
    try { await send(`/api/admin/areas/${selectedArea.id}/reorder`, 'POST', { ids }); await refresh(); notify('並び順を変更しました。'); } catch (e) { notify(e.message, true); }
  }
  async function remove(m) {
    if (!window.confirm(`「${m.name}」を削除しますか？動画とQRコードの閲覧先も無効になります。`)) return;
    try { await api(`/api/admin/machines/${m.id}`, { method: 'DELETE' }); if (selectedId === m.id) setSelectedId(undefined); await refresh(); await tidy(); notify('マシンを削除しました。'); } catch (e) { notify(e.message, true); }
  }
  if (editing) return <div className="space-y-4"><button className="back-btn" onClick={() => setSelectedId(undefined)}><ArrowLeft size={18}/>マシン一覧</button><MachineEditor key={selectedId || 'new'} machine={selectedMachine} catalog={catalog} initialAreaId={selectedArea?.id} refresh={refresh} onSaved={id => setSelectedId(id)} onCancel={() => setSelectedId(undefined)} notify={notify} tidy={tidy}/></div>;
  return <div className="space-y-4"><div className="admin-card space-y-4"><div className="flex justify-between items-center"><h3 className="card-title !mb-0">マシン管理</h3><button className="btn btn-primary btn-sm" onClick={() => setSelectedId(null)} disabled={!selectedArea}><Plus size={17}/>追加</button></div>
    <Field title="店舗を選択"><select className={fieldInput} value={selectedStore?.id || ''} onChange={e => { setStoreFilter(e.target.value); setAreaFilter(''); }}>{catalog.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
    <Field title="エリアを選択"><select className={fieldInput} value={selectedArea?.id || ''} onChange={e => setAreaFilter(e.target.value)}>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field></div>
    <div className="admin-card"><div className="flex justify-between items-center mb-4"><h3 className="card-title !mb-0">表示順 <span className="count">{machines.length}</span></h3><span className="text-xs text-neutral-300">↑ ↓ で並び替え</span></div>
    {machines.length ? machines.map((m, i) => <div key={m.id} className="machine-row"><div className="flex flex-col gap-1.5"><button aria-label={`${m.name}を上へ`} disabled={i === 0} className="arrow-button" onClick={() => move(m,-1)}><ArrowUp size={17}/></button><button aria-label={`${m.name}を下へ`} disabled={i === machines.length - 1} className="arrow-button" onClick={() => move(m,1)}><ArrowDown size={17}/></button></div><span className="text-xs font-bold text-neutral-300 w-6 text-center">{num(i)}</span><div className="flex-1 min-w-0"><div className="font-semibold text-white truncate">{m.name}</div><div className="text-xs text-neutral-300 mt-1">{m.videoId ? '動画登録済み' : '動画なし'} ・ 取説あり</div></div><SmallActions onEdit={() => setSelectedId(m.id)} onDelete={() => remove(m)}/></div>) : <Empty title="マシンがありません" description="店舗・エリアを追加してからマシンを登録してください。"/>}
    </div></div>;
}
function Login({ onLogin, notify }) {
  const [password, setPassword] = useState(''); const [pending, setPending] = useState(false);
  async function submit(e) { e.preventDefault(); try { setPending(true); await send('/api/admin/login', 'POST', { password }); setPassword(''); onLogin(); } catch (err) { notify(err.message, true); } finally { setPending(false); } }
  return <div className="min-h-[75vh] flex items-center justify-center"><form className="login-card w-full" onSubmit={submit}><div className="mx-auto w-15 h-15 rounded-2xl flex items-center justify-center bg-white/10 text-white mb-6"><LockKeyhole size={28}/></div><div className="eyebrow text-center">STAFF ONLY</div><h1 className="text-2xl font-bold text-center mt-3 mb-3">管理者アクセス</h1><p className="text-sm text-neutral-200 text-center leading-relaxed mb-6">一般の利用者は認証不要です。<br/>編集には管理者パスワードが必要です。</p><Field title="管理者パスワード"><input type="password" autoComplete="current-password" className={fieldInput} value={password} onChange={e => setPassword(e.target.value)} placeholder="管理者パスワード" required /></Field><button className="btn btn-primary w-full mt-5" disabled={pending}>{pending ? <LoaderCircle size={18} className="animate-spin"/> : <LockKeyhole size={17}/>}管理画面を開く</button></form></div>;
}
function Admin({ catalog, refresh, error }) {
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
  return <div className="min-h-screen"><header className="top-header"><div className="shell flex justify-between items-center"><Brand admin/><a href="/" className="text-neutral-200 hover:text-white text-xs flex items-center gap-1"><ExternalLink size={15}/>視聴用</a></div></header>
    <main className="shell pb-22"><div className="hero admin-hero"><div className="eyebrow">STAFF CONTROL CENTER</div><h1 className="hero-title">管理画面<span className="hero-period">.</span></h1><p className="hero-sub">店舗・エリア・マシンとQRコードを一括管理</p></div>
      {notice && <div className="mb-4"><Alert kind={notice.isError ? 'error' : 'ok'}>{notice.message}</Alert><button className="text-xs text-neutral-300 mt-2" onClick={() => setNotice(null)}>閉じる</button></div>}
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {auth === 'checking' ? <Skeleton/> : auth === 'out' ? <Login onLogin={() => { setAuth('in'); refresh(); }} notify={notify}/> : <>
        <div className="flex items-center justify-between mb-5"><span className="staff-badge"><Check size={14}/> 管理者モード</span><button onClick={logout} className="text-xs text-neutral-200 flex items-center gap-1 hover:text-white"><LogOut size={15}/>ログアウト</button></div>
        <div className="tab-bar"><Chip active={tab==='machines'} onClick={() => setTab('machines')}><Dumbbell size={17}/>マシン</Chip><Chip active={tab==='areas'} onClick={() => setTab('areas')}><Layers3 size={17}/>エリア</Chip><Chip active={tab==='stores'} onClick={() => setTab('stores')}><MapPin size={17}/>店舗</Chip></div>
        {tab === 'machines' ? <MachinesAdmin catalog={catalog} refresh={refresh} notify={notify} tidy={tidy}/> : tab === 'areas' ? <AreasAdmin catalog={catalog} refresh={refresh} notify={notify} tidy={tidy}/> : <StoresAdmin catalog={catalog} refresh={refresh} notify={notify} tidy={tidy}/>}
        <div className="admin-footer"><ShieldAlert size={16}/> QRコードからの視聴にログインは不要です。<br/>管理者パスワードは第三者に共有しないでください。</div>
      </>}
    </main></div>;
}
export default function App() {
  const { catalog, loading, error, refresh } = useCatalog();
  const [route, navigate] = useRoute();
  return route === '/admin' || route.startsWith('/admin/') ? <Admin catalog={catalog} refresh={refresh} error={error}/> : <Viewer catalog={catalog} loading={loading} error={error} route={route} navigate={navigate} refresh={refresh}/>;
}
