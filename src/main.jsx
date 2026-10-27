import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight, ArrowUpRight, CheckCheck, ChevronDown, Copy, Hand,
  Headphones, HelpCircle, Link, Lock, MessageSquare, Mic, MicOff, MonitorUp,
  Moon, PhoneOff, Plus, Send, Settings, ShieldCheck, Sun, Users, Video,
  VideoOff, Volume2, X, AlertCircle, LogIn, Square, GraduationCap, BookOpen,
} from 'lucide-react';
import { api, inviteURL, roomFromInput } from './api';
import { useMeeting } from './useMeeting';
import './style.css';

function Logo() {
  return <span className="brand"><svg role="img" aria-label="Profconnect logo" width="38" height="38" viewBox="0 0 40 40" fill="none"><rect x="1" y="1" width="38" height="38" rx="12" stroke="currentColor" opacity=".3"/><path d="M12 14l8-5 8 5v12l-8 5-8-5V14zm0 0l8 6 8-6M20 20v11" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><circle cx="12" cy="14" r="3" fill="currentColor"/><circle cx="28" cy="14" r="3" fill="currentColor"/><circle cx="20" cy="30" r="3" fill="currentColor"/></svg><span className="brand-wordmark">PROFCONNECT<small>MEETING PLACE</small></span></span>;
}
function IconButton({ label, children, active, danger, onClick, disabled, ...rest }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled} {...rest}>{children}</button>;
}
function VideoTile({ stream, name, camera, mic, local, sharing, hand, connection, large = false }) {
  const video = useRef(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let cancelled = false;
    el.srcObject = stream || null;
    setBlocked(false);
    if (stream) el.play()
      .then(() => { if (!cancelled) setBlocked(false); })
      .catch(error => { if (!cancelled && error.name === 'NotAllowedError') setBlocked(true); });
    return () => { cancelled = true; };
  }, [stream]);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'Y';
  const visible = Boolean(stream && (camera || sharing));
  return <div className={`video-tile ${large ? 'large' : ''} ${sharing ? 'sharing' : ''}`} data-testid={`tile-${local ? 'self' : name}`}>
    <video ref={video} autoPlay playsInline muted={local} className={`${visible ? '' : 'video-hidden'} ${local && !sharing ? 'mirrored' : ''}`} />
    {!visible && <div className="camera-empty">{name ? <div className="initials">{initials}</div> : <div className="camera-symbol"><VideoOff size={30}/></div>}<span>{name ? 'Camera is off' : 'Your space, your pace.'}</span>{!name && <p>Check your camera before saying hello.</p>}</div>}
    {sharing && <span className="sharing-label"><MonitorUp size={14}/> Sharing a screen</span>}
    <div className="tile-bottom"><span>{name || 'You'}{local && name ? ' (you)' : ''}</span><span>{hand && <Hand size={17}/>} {!mic && <MicOff size={16}/>}</span></div>
    {connection && !['connected', 'new'].includes(connection) && <span className="connection-label">{connection === 'failed' ? 'Connection failed' : connection === 'disconnected' ? 'Reconnecting media…' : 'Connecting…'}</span>}
    {blocked && !local && (mic || camera || sharing) && <button className="play-audio" onClick={() => video.current.play().then(() => setBlocked(false)).catch(() => {})}><Volume2 size={16}/> Play audio</button>}
  </div>;
}
function Modal({ title, onClose, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
    return () => dialog.current?.close();
  }, []);
  return <dialog ref={dialog} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-heading"><h2>{title}</h2><IconButton label="Close dialog" onClick={onClose}><X size={20}/></IconButton></div>{children}</dialog>;
}

function App() {
  const [theme, setTheme] = useState('dark');
  const [config, setConfig] = useState(null);
  const [serverError, setServerError] = useState('');
  const [mode, setMode] = useState('join');
  const [role, setRole] = useState('student');
  const [code, setCode] = useState(roomFromInput(location.hash));
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [passcode, setPasscode] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [media, setMedia] = useState(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [hand, setHand] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [screen, setScreen] = useState(null);
  const [devices, setDevices] = useState([]);
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [panel, setPanel] = useState('people');
  const [chat, setChat] = useState('');
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [joinedAt, setJoinedAt] = useState(null);
  const [unread, setUnread] = useState(0);
  const [ended, setEnded] = useState(false);
  const localRef = useRef(null);
  const screenRef = useRef(null);
  const hostTokens = useRef({});
  const chatEnd = useRef(null);
  const meeting = useMeeting(localRef, screenRef, setNotice);
  const { session, participants, messages, locked, status } = meeting;

  async function loadConfig() {
    setServerError('');
    try { setConfig(await api('/api/config')); }
    catch { setServerError('The meeting server is unavailable. Try again in a moment.'); }
  }
  useEffect(() => { loadConfig(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    const handleHash = () => {
      if (location.hash.startsWith('#/room/')) { setMode('join'); setCode(roomFromInput(location.hash)); setEnded(false); }
    };
    window.addEventListener('hashchange', handleHash);
    return () => { clearInterval(timer); window.removeEventListener('hashchange', handleHash); };
  }, []);
  useEffect(() => {
    meeting.announce({ mic, camera, hand, sharing });
  }, [mic, camera, hand, sharing, status]);
  useEffect(() => {
    if (panel === 'chat') { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); setUnread(0); }
    else if (messages.length) setUnread(n => n + 1);
  }, [messages]);
  useEffect(() => {
    if (panel === 'chat') setUnread(0);
  }, [panel]);
  useEffect(() => {
    // Host-end and server closure should not leave capture devices running.
    if (!session && joinedAt) {
      stopMedia();
      setJoinedAt(null);
      setEnded(true);
    }
  }, [session]);
  useEffect(() => () => {
    localRef.current?.getTracks().forEach(t => t.stop());
    screenRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  async function acquire(kind = 'both', selected = {}) {
    if (mediaBusy) return;
    setMediaBusy(true); setMediaError('');
    const old = localRef.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone need HTTPS or localhost. Open your deployed app in its own browser tab.');
      const wantAudio = kind === 'both' || kind === 'audio';
      const wantVideo = kind === 'both' || kind === 'video';
      const cid = selected.cameraId ?? cameraId;
      const mid = selected.micId ?? micId;
      const fresh = await navigator.mediaDevices.getUserMedia({
        audio: wantAudio ? { echoCancellation: true, noiseSuppression: true, ...(mid ? { deviceId: { exact: mid } } : {}) } : false,
        video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 }, ...(cid ? { deviceId: { exact: cid } } : {}) } : false,
      });
      const replaced = fresh.getTracks().map(t => t.kind);
      const keep = (old?.getTracks() || []).filter(t => !replaced.includes(t.kind));
      const next = new MediaStream([...keep, ...fresh.getTracks()]);
      localRef.current = next;
      for (const track of fresh.getTracks()) {
        if (track.kind === 'audio') {
          await meeting.replaceTrack('audio', track); setMic(true);
        } else {
          if (!screenRef.current) await meeting.replaceTrack('video', track);
          setCamera(true);
        }
      }
      old?.getTracks().filter(t => replaced.includes(t.kind)).forEach(t => t.stop());
      setMedia(next);
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (error) {
      setMediaError(error.name === 'NotAllowedError' ? 'Permission was denied. Allow camera/microphone in your browser, or join without them.' : error.name === 'NotFoundError' ? 'No matching camera or microphone found. Try enabling each separately, or join without them.' : error.message);
    } finally { setMediaBusy(false); }
  }
  async function toggleMic() {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') return acquire('audio');
    track.enabled = !mic; setMic(!mic);
  }
  async function toggleCamera() {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') return acquire('video');
    track.enabled = !camera; setCamera(!camera);
  }
  async function stopScreen() {
    const old = screenRef.current;
    screenRef.current = null;
    setScreen(null); setSharing(false);
    old?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    try { await meeting.replaceTrack('video', localRef.current?.getVideoTracks()[0] || null); }
    catch { setNotice('Could not restore the camera. Leave and rejoin if video does not return.'); }
  }
  async function toggleScreen() {
    if (screenRef.current) return stopScreen();
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not available in this browser. Try desktop Chrome, Edge, or Firefox.');
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenRef.current = stream;
      await meeting.replaceTrack('video', stream.getVideoTracks()[0]);
      stream.getVideoTracks()[0].onended = stopScreen;
      setScreen(stream); setSharing(true);
    } catch (error) {
      if (screenRef.current) await stopScreen();
      if (error.name !== 'NotAllowedError') setNotice(error.message);
    }
  }
  function stopMedia() {
    screenRef.current?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    localRef.current?.getTracks().forEach(t => t.stop());
    screenRef.current = null; localRef.current = null;
    setMedia(null); setScreen(null); setMic(false); setCamera(false); setSharing(false); setHand(false);
  }
  function leave() {
    meeting.leave(); stopMedia(); setEnded(true); setModal(null); setNotice('');
  }
  async function enter(event) {
    event.preventDefault();
    if (!name.trim()) { setNotice('Add your name so everyone knows who is joining.'); return; }
    if (!config) { setNotice('Please wait for the server to connect.'); return; }
    setBusy(true); setNotice('');
    try {
      let room = roomFromInput(code);
      if (mode === 'create') {
        const created = await api('/api/rooms', { title: title.trim() || `${name.trim()}'s room`, passcode });
        room = created.id;
        hostTokens.current[room] = created.host_token;
        setCode(room);
      }
      if (!/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(room)) throw new Error('Enter a valid room code or paste a Profconnect invitation link.');
      await meeting.join(room, name.trim(), passcode, hostTokens.current[room], config);
      location.hash = `/room/${room}`;
      setJoinedAt(Date.now()); setEnded(false); setPanel(matchMedia('(max-width: 800px)').matches ? null : 'people');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  async function copyInvite() {
    const value = inviteURL(session?.room || code);
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2400); }
    catch { setModal('invite'); }
  }
  function sendChat(e) {
    e.preventDefault();
    if (!chat.trim() || status !== 'connected') return;
    meeting.send({ type: 'chat', text: chat.trim() });
    setChat('');
  }
  const elapsed = joinedAt ? Math.max(0, Math.floor((clock.getTime() - joinedAt) / 1000)) : 0;
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const connected = status === 'connected';

  return <div className={session ? 'app in-call' : 'app'}>
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main').focus(); }}>Skip to content</a>
    <header className="header">
      <button className="brand-button" aria-label="Profconnect Meeting Place home" onClick={() => { if (session) setModal('leave'); else { setEnded(false); setMode(role === 'professor' ? 'create' : 'join'); setCode(''); location.hash = ''; } }}><Logo/></button>
      {!session && <nav aria-label="Main navigation"><span className="nav-current">Meeting place</span><a href="https://profconnect-thapar.vercel.app/" target="_blank" rel="noopener noreferrer">ProfConnect portal <ArrowUpRight size={14}/></a><button onClick={() => setModal('how')}>How it works</button></nav>}
      {session && <div className="meeting-heading"><span>{session.title}</span><span className="live-pill"><i/> {connected ? 'In meeting' : status === 'connecting' ? 'Connecting' : 'Disconnected'}</span></div>}
      <div className="header-right">{!session && <span className="date-time">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<span> / </span>{clock.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
        <IconButton label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={19}/> : <Sun size={19}/>}</IconButton>
        <IconButton label="Help and privacy" onClick={() => setModal('help')}><HelpCircle size={20}/></IconButton>
        <span className="profile">{name.trim()[0]?.toUpperCase() || 'P'}</span>
      </div>
    </header>

    {!session ? <main id="main" tabIndex={-1} className="lobby">
      <div className="intro-line"><span className="eyebrow"><i/> CONNECTING MADE EASY</span><span className="version">STUDENTS. PROFESSORS. POSSIBILITIES.</span></div>
      {ended && <section className="ended-banner"><CheckCheck size={22}/><div><strong>Thanks for making time.</strong><p>Your call has ended and your camera and microphone are off.</p></div><button onClick={() => { setEnded(false); setMode('join'); }}>Rejoin room <ArrowRight size={16}/></button></section>}
      <section className="lobby-grid">
        <div className="welcome">
          <h1>Big questions.<br/><span>Better conversations.</span></h1>
          <p className="lede">A dedicated meeting place for students and professors.<br className="desktop-break"/> Connect for office hours, project reviews, and a little guidance.</p>
          <div className="role-picker" role="group" aria-label="Choose your meeting role">
            <button aria-pressed={role === 'student'} onClick={() => { setRole('student'); setMode('join'); setNotice(''); }}><GraduationCap size={21}/><span>I'm a student<small>Connect with your professor</small></span></button>
            <button aria-pressed={role === 'professor'} onClick={() => { setRole('professor'); setMode(code ? 'join' : 'create'); setNotice(''); }}><BookOpen size={21}/><span>I'm a professor<small>Make time for your students</small></span></button>
          </div>
          <div className="meeting-form">
            <p className="role-guidance">{mode === 'join' ? 'Have an invite? Enter the meeting code or link below.' : role === 'professor' ? 'Host a session and share the invitation with your students.' : 'Start a session and invite your professor to join.'}</p>
            <div className="tabs" role="tablist" aria-label="Meeting action">
              <button role="tab" aria-selected={mode === 'create'} onClick={() => { setMode('create'); setNotice(''); setPasscode(''); }}><Plus size={17}/>New meeting</button>
              <button role="tab" aria-selected={mode === 'join'} onClick={() => { setMode('join'); setNotice(''); setPasscode(''); }}><LogIn size={17}/>Join a meeting</button>
            </div>
            <form onSubmit={enter}>
              <label htmlFor="name">Your name</label>
              <input id="name" data-testid="input-name" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="What should we call you?" required autoComplete="given-name"/>
              {mode === 'join' && <><label htmlFor="code">Meeting code or invite link</label><input id="code" data-testid="input-code" value={code} onChange={e => setCode(e.target.value)} placeholder="xxxx-xxxx-xxxx" required autoComplete="off"/></>}
              {mode === 'create' && <button className="text-button options" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>Meeting options <ChevronDown size={15} className={advanced ? 'rotate' : ''}/></button>}
              {mode === 'create' && advanced && <><label htmlFor="title">Room name <span>(optional)</span></label><input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Office hours · Project review" maxLength={80}/></>}
              {(mode === 'join' || advanced) && <><label htmlFor="passcode">Room passcode <span>(if needed)</span></label><input id="passcode" type="password" value={passcode} onChange={e => setPasscode(e.target.value)} placeholder={mode === 'join' ? 'Ask your host' : 'Add a little extra privacy'} maxLength={64} autoComplete="off"/></>}
              {notice && <p className="error-message" role="alert"><AlertCircle size={16}/>{notice}</p>}
              {serverError && <div className="error-message" role="alert">{serverError}<button type="button" onClick={loadConfig}>Retry</button></div>}
              <button className="primary start-button" type="submit" disabled={busy || !config} data-testid="button-enter">{mode === 'create' ? <Video size={19}/> : <LogIn size={19}/>} {busy ? 'Getting your room ready…' : !config && !serverError ? 'Connecting to server…' : mode === 'create' ? 'Start a meeting' : 'Join meeting'}<ArrowRight size={19}/></button>
              <p className="form-note"><ShieldCheck size={14}/> Guest access. No downloads required.</p>
            </form>
          </div>
        </div>
        <div className="preview-section">
          <div className="preview-heading"><span>YOUR PRE-MEETING CHECK</span><span className="preview-pill"><i/> Only visible to you</span></div>
          <div className="preview-card">
            <VideoTile stream={media} name={name} camera={camera} mic={mic} local large/>
            <div className="preview-controls">
              <IconButton label={mic ? 'Mute microphone' : 'Enable microphone'} active={mic} onClick={toggleMic} disabled={mediaBusy}>{mic ? <Mic size={20}/> : <MicOff size={20}/>}</IconButton>
              <IconButton label={camera ? 'Turn camera off' : 'Enable camera'} active={camera} onClick={toggleCamera} disabled={mediaBusy}>{camera ? <Video size={20}/> : <VideoOff size={20}/>}</IconButton>
              <span className="control-divider"/>
              <button className="device-button" onClick={() => setModal('settings')}><Settings size={18}/> Device settings</button>
            </div>
          </div>
          {mediaError && <p role="alert" className="error-message">{mediaError}</p>}
          <div className="camera-note"><span><span className={`status-dot ${media ? 'ready' : ''}`}/>{media ? 'Looking good. Join whenever you’re ready.' : 'Your camera and microphone start off.'}</span>{!media && <button onClick={() => acquire()} disabled={mediaBusy}>{mediaBusy ? 'Checking…' : 'Enable both'}<ArrowUpRight size={14}/></button>}</div>
          <div className="session-guide">
            <div className="guide-heading"><GraduationCap size={22}/><div><h2>A little time. A lot of clarity.</h2><p>Space for the conversations that move you forward.</p></div></div>
            <div className="session-types"><span>Office hours</span><span>Project reviews</span><span>Mentoring</span></div>
            <p className="capacity-note"><Users size={15}/> One-to-one or a small group, up to {config?.maxParticipants || 4} people.</p>
          </div>
        </div>
      </section>
      <section className="bottom-strip" aria-label="Meeting features">
        <div className="strip-title">Beyond the classroom.<br/><strong>Closer to understanding.</strong></div>
        <div><MonitorUp size={21}/><span>Walk through your work.<small>Present a project or share your screen.</small></span></div>
        <div><MessageSquare size={21}/><span>Make every question count.<small>Raise your hand or send a message.</small></span></div>
        <button onClick={() => setModal('help')}><Lock size={20}/><span>A focused space to connect.<small>Passcodes and host controls.</small></span><ArrowUpRight size={15}/></button>
      </section>
      <footer><span>Profconnect Meeting Place · Connecting made easy.</span><a href="https://profconnect-thapar.vercel.app/" target="_blank" rel="noopener noreferrer">Back to ProfConnect <ArrowUpRight size={14}/></a></footer>
    </main> : <main id="main" tabIndex={-1} className="call-main">
      <div className="call-subheader"><div><span className="room-code">{session.room}</span><button className="text-button" onClick={copyInvite}><Copy size={14}/>{copied ? 'Copied!' : 'Copy invite'}</button></div><span><Users size={15}/>{participants.length + 1} / {config?.maxParticipants}<span className="timer">{timer}</span></span></div>
      {notice && <div className="call-notice" role="alert">{notice}<IconButton label="Dismiss notice" onClick={() => setNotice('')}><X size={16}/></IconButton></div>}
      <div className={`call-body ${panel ? 'with-panel' : ''}`}>
        <section className={`video-grid count-${participants.length + 1}`} aria-label="Meeting participants">
          <VideoTile stream={screen || media} name={name} camera={camera} mic={mic} hand={hand} sharing={sharing} local/>
          {participants.map(p => <VideoTile key={p.id} {...p}/>)}
          {!participants.length && <div className="invite-tile"><GraduationCap size={30}/><h2>Your next conversation starts here.</h2><p>Invite your professor or students<br/>to join this session.</p><button className="primary" onClick={copyInvite}><Link size={17}/>{copied ? 'Invitation copied' : 'Copy invitation'}</button><span>Keep this tab open while you wait.</span></div>}
        </section>
        {panel && <aside className="meeting-panel">
          <div className="panel-tabs"><button className={panel === 'people' ? 'selected' : ''} onClick={() => setPanel('people')}>People <span>{participants.length + 1}</span></button><button className={panel === 'chat' ? 'selected' : ''} onClick={() => setPanel('chat')}>Chat{unread > 0 && <i className="unread-dot"/>}</button><IconButton label="Close side panel" onClick={() => setPanel(null)}><X size={18}/></IconButton></div>
          {panel === 'people' ? <div className="people-panel"><h2>In this room</h2>{[{ id: session.id, name, host: session.host, mic, hand }, ...participants].map(p => <div className="person-row" key={p.id}><span className="person-avatar">{p.name[0]?.toUpperCase()}</span><div><strong>{p.name}{p.id === session.id ? ' (you)' : ''}</strong><small>{p.host ? 'Host' : 'Guest'}</small></div>{p.hand && <Hand size={16}/>} {!p.mic && <MicOff size={16}/>}</div>)}<button className="invite-outline" onClick={copyInvite}><Plus size={17}/> {copied ? 'Copied!' : 'Invite someone'}</button><div className="room-privacy"><ShieldCheck size={21}/><h3>{locked ? 'The room is locked' : 'Make yourself at home'}</h3><p>{locked ? 'New guests cannot join until the host unlocks this room.' : 'Only people with your room link and any required passcode can join.'}</p>{session.host && <button className="text-button" disabled={!connected} onClick={() => meeting.send({ type: 'lock', locked: !locked })}><Lock size={14}/>{locked ? 'Unlock room' : 'Lock room'}</button>}</div>{session.host && <button className="end-all" disabled={!connected} onClick={() => setModal('end')}>End meeting for everyone</button>}</div> : <div className="chat-panel"><div className="chat-messages" role="log" aria-live="polite">{messages.length === 0 && <div className="chat-empty"><MessageSquare size={25}/><strong>A thought worth sharing?</strong><p>Send a note or a link to everyone in the room. Messages disappear when you leave.</p></div>}{messages.map(m => <article key={m.id} className={`chat-message ${m.from === session.id ? 'own' : ''}`}><div><strong>{m.name}</strong><time>{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{m.text}</p></article>)}<div ref={chatEnd}/></div><form onSubmit={sendChat} className="chat-form"><label className="sr-only" htmlFor="chat">Message everyone</label><input id="chat" value={chat} onChange={e => setChat(e.target.value)} maxLength={2000} placeholder="Message everyone…" autoComplete="off"/><IconButton label="Send message" disabled={!chat.trim() || !connected} onClick={sendChat}><Send size={18}/></IconButton></form><small className="chat-privacy">Visible to everyone in this meeting</small></div>}
        </aside>}
      </div>
      <div className="call-toolbar">
        <span className="call-security"><ShieldCheck size={17}/><span>WebRTC connection</span></span>
        <div className="main-controls">
          <div><IconButton label={mic ? 'Mute microphone' : 'Enable microphone'} active={mic} onClick={toggleMic} disabled={mediaBusy}>{mic ? <Mic size={21}/> : <MicOff size={21}/>}</IconButton><small>Microphone</small></div>
          <div><IconButton label={camera ? 'Turn camera off' : 'Enable camera'} active={camera} onClick={toggleCamera} disabled={mediaBusy}>{camera ? <Video size={21}/> : <VideoOff size={21}/>}</IconButton><small>Camera</small></div>
          <div><IconButton label={sharing ? 'Stop sharing' : 'Share screen'} active={sharing} onClick={toggleScreen} disabled={!connected}>{sharing ? <Square size={21}/> : <MonitorUp size={21}/>}</IconButton><small>{sharing ? 'Stop sharing' : 'Share screen'}</small></div>
          <div><IconButton label={hand ? 'Lower hand' : 'Raise hand'} active={hand} onClick={() => setHand(!hand)} disabled={!connected}><Hand size={21}/></IconButton><small>Raise hand</small></div>
          <div className="settings-control"><IconButton label="Device settings" onClick={() => setModal('settings')}><Settings size={21}/></IconButton><small>Settings</small></div>
          <div><IconButton label="Leave meeting" danger onClick={() => setModal('leave')}><PhoneOff size={21}/></IconButton><small>Leave</small></div>
        </div>
        <div className="panel-controls"><IconButton label="Show participants" active={panel === 'people'} onClick={() => setPanel(panel === 'people' ? null : 'people')}><Users size={21}/></IconButton><IconButton label="Show chat" active={panel === 'chat'} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><MessageSquare size={21}/>{unread > 0 && <i className="unread-dot"/>}</IconButton></div>
      </div>
      {mediaError && <p className="call-media-error" role="alert">{mediaError}<button onClick={() => setMediaError('')}>Dismiss</button></p>}
    </main>}

    {modal === 'settings' && <Modal title="Make yourself comfortable" onClose={() => setModal(null)}><p className="modal-description">Choose your camera and microphone. Device names appear after you allow access.</p><div className="settings-form"><label htmlFor="camera-device"><Video size={16}/> Camera</label><select id="camera-device" value={cameraId} onChange={e => setCameraId(e.target.value)}><option value="">System default camera</option>{devices.filter(d => d.kind === 'videoinput').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}</select><label htmlFor="mic-device"><Mic size={16}/> Microphone</label><select id="mic-device" value={micId} onChange={e => setMicId(e.target.value)}><option value="">System default microphone</option>{devices.filter(d => d.kind === 'audioinput').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}</select><div className="settings-actions"><button className="primary" disabled={mediaBusy} onClick={() => acquire()}>{mediaBusy ? 'Checking devices…' : 'Apply & enable devices'}</button><button className="secondary" onClick={() => { const audio = new (window.AudioContext || window.webkitAudioContext)(); const oscillator = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0.06; oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .3); oscillator.onended = () => audio.close(); }}><Headphones size={17}/> Test speaker</button></div>{mediaError && <p className="error-message">{mediaError}</p>}<small>Speaker output uses your system’s default device. Screen sharing replaces your camera while active; system audio is not shared.</small></div></Modal>}
    {modal === 'how' && <Modal title="A conversation in three small steps." onClose={() => setModal(null)}><ol className="how-list"><li><span>01</span><div><h3>Make a little room.</h3><p>Add your name and start a meeting. Choose a room name or a passcode if you like.</p></div></li><li><span>02</span><div><h3>Send a simple invitation.</h3><p>Copy the room link and share it with up to three other people. No account needed.</p></div></li><li><span>03</span><div><h3>Be there, from anywhere.</h3><p>Turn on your mic and camera, share your screen, or drop a thought in the chat.</p></div></li></ol><button className="primary full-width" onClick={() => setModal(null)}>Let’s get together <ArrowRight size={17}/></button></Modal>}
    {modal === 'help' && <Modal title="A few things worth knowing" onClose={() => setModal(null)}><div className="help-content"><h3>Small rooms, real conversations.</h3><p>Profconnect Meeting Place is designed for up to {config?.maxParticipants || 4} people. For best results, use a current browser and headphones.</p><h3>Your camera is your choice.</h3><p>Nothing is captured until you enable a device. You can join with both camera and microphone off. If this preview blocks permissions, use the app deployed on your own HTTPS domain.</p><h3>Privacy, without the fine-print feeling.</h3><p>Audio and video use encrypted WebRTC transport. Profconnect Meeting Place does not record calls. Chat passes through the server but is not saved to the database. Hosts can lock a room or end a meeting.</p><h3>Links are invitations.</h3><p>Anyone with a link and any required passcode can join an unlocked room. Room links expire after {config?.roomTTLHours || 24} hours. Host controls belong to the creating tab; refreshing it loses your host access.</p><h3>Having trouble connecting?</h3><p>{config?.turnConfigured ? 'A TURN relay is configured. Check browser permissions and your connection, then leave and rejoin.' : 'A TURN relay is not configured on this server. Calls on some networks may fail until the operator configures TURN.'}</p></div></Modal>}
    {modal === 'invite' && <Modal title="Bring your people together" onClose={() => setModal(null)}><p className="modal-description">Copy this link and send it to someone you’d like to see. Share any passcode separately.</p><label htmlFor="invite-link">Invitation link</label><input id="invite-link" readOnly value={inviteURL(session?.room || code)} onFocus={e => e.target.select()}/><small>Your browser blocked automatic copying. Select the link and copy it manually.</small></Modal>}
    {['leave', 'end'].includes(modal) && <Modal title={modal === 'end' ? 'End this meeting for everyone?' : 'Time to say goodbye?'} onClose={() => setModal(null)}><p className="modal-description">{modal === 'end' ? 'Everyone will be disconnected and this room link will stop working.' : 'You’ll leave the room and turn off your camera and microphone. Other people can keep talking.'}</p><div className="modal-actions"><button className="secondary" onClick={() => setModal(null)}>Stay a little longer</button><button className="danger-button" onClick={() => { if (modal === 'end') { meeting.send({ type: 'end' }); setModal(null); } else leave(); }}>{modal === 'end' ? 'End for everyone' : 'Leave meeting'}</button></div></Modal>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
