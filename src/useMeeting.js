import { useEffect, useRef, useState } from 'react';
import { api, socketURL } from './api';

export function useMeeting(localRef, screenRef, onNotice) {
  const [session, setSession] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState('idle');
  const socket = useRef(null);
  const pcs = useRef(new Map());
  const sessionRef = useRef(null);
  const configRef = useRef(null);
  const states = useRef({ mic: false, camera: false, hand: false, sharing: false });
  const shuttingDown = useRef(false);
  const updates = useRef(Promise.resolve());

  function send(message) {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }
  function announce(patch = {}) {
    states.current = { ...states.current, ...patch };
    send({ type: 'state', ...states.current });
  }
  function removePeer(id) {
    const peer = pcs.current.get(id);
    peer?.pc.close();
    pcs.current.delete(id);
    setParticipants(list => list.filter(p => p.id !== id));
  }
  function clearPeers() {
    pcs.current.forEach(({ pc }) => pc.close());
    pcs.current.clear();
    setParticipants([]);
  }
  function makePeer(person, initiator = false) {
    if (pcs.current.has(person.id)) return pcs.current.get(person.id);
    const pc = new RTCPeerConnection({ iceServers: configRef.current.iceServers });
    const audio = localRef.current?.getAudioTracks()[0] || null;
    const video = screenRef.current?.getVideoTracks()[0] || localRef.current?.getVideoTracks()[0] || null;
    const stream = localRef.current || new MediaStream();
    // Only the offerer creates transceivers. The answerer must reuse the
    // remote offer's transceivers or its sending tracks can be left unbound.
    const audioTransceiver = initiator ? pc.addTransceiver(audio || 'audio', { direction: 'sendrecv', streams: [stream] }) : null;
    const videoTransceiver = initiator ? pc.addTransceiver(video || 'video', { direction: 'sendrecv', streams: [stream] }) : null;
    const remote = new MediaStream();
    const peer = { pc, queue: [], stream: remote, audioSender: audioTransceiver?.sender, videoSender: videoTransceiver?.sender };
    pcs.current.set(person.id, peer);
    setParticipants(list => list.some(p => p.id === person.id) ? list : [...list, { ...person, stream: remote, connection: 'connecting' }]);
    pc.onicecandidate = event => {
      if (event.candidate) send({ type: 'ice', to: person.id, candidate: event.candidate.toJSON() });
    };
    pc.ontrack = event => {
      remote.addTrack(event.track);
      setParticipants(list => list.map(p => p.id === person.id ? { ...p, stream: new MediaStream(remote.getTracks()) } : p));
    };
    pc.onconnectionstatechange = () => {
      setParticipants(list => list.map(p => p.id === person.id ? { ...p, connection: pc.connectionState } : p));
      if (pc.connectionState === 'failed') onNotice(`Connection to ${person.name} failed. Rejoin the room; the server may need TURN configured.`);
    };
    return peer;
  }
  async function signal(message) {
    if (message.type === 'welcome') {
      setLocked(message.locked);
      setStatus('connected');
      for (const person of message.participants) {
        const { pc } = makePeer(person, true);
        await pc.setLocalDescription(await pc.createOffer());
        send({ type: 'offer', to: person.id, sdp: pc.localDescription.sdp });
      }
      announce();
    } else if (message.type === 'joined') {
      makePeer(message.participant);
    } else if (['offer', 'answer', 'ice'].includes(message.type)) {
      const peer = pcs.current.get(message.from);
      if (!peer) return;
      if (message.type === 'ice') {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.candidate);
        else peer.queue.push(message.candidate);
      } else {
        await peer.pc.setRemoteDescription({ type: message.type, sdp: message.sdp });
        for (const candidate of peer.queue.splice(0)) await peer.pc.addIceCandidate(candidate);
        if (message.type === 'offer') {
          for (const transceiver of peer.pc.getTransceivers()) {
            const kind = transceiver.receiver.track.kind;
            transceiver.direction = 'sendrecv';
            const track = kind === 'audio'
              ? localRef.current?.getAudioTracks()[0]
              : screenRef.current?.getVideoTracks()[0] || localRef.current?.getVideoTracks()[0];
            await transceiver.sender.replaceTrack(track || null);
            if (kind === 'audio') peer.audioSender = transceiver.sender;
            else peer.videoSender = transceiver.sender;
          }
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          send({ type: 'answer', to: message.from, sdp: peer.pc.localDescription.sdp });
        }
      }
    } else if (message.type === 'state') {
      setParticipants(list => list.map(p => p.id === message.from ? { ...p, ...message.state } : p));
    } else if (message.type === 'left') {
      removePeer(message.id);
    } else if (message.type === 'chat') {
      setMessages(list => [...list.slice(-199), message]);
    } else if (message.type === 'locked') {
      setLocked(message.locked);
    } else if (message.type === 'ended') {
      leave();
      onNotice('The host ended this meeting.');
    } else if (message.type === 'error') {
      onNotice(message.detail);
    }
  }
  async function join(room, name, passcode, hostToken, config) {
    if (socket.current) throw new Error('Leave your current meeting before joining another.');
    const ticket = await api(`/api/rooms/${room}/join`, { name, passcode, host_token: hostToken || '' });
    configRef.current = { ...config, iceServers: ticket.iceServers };
    const next = { room, name, ...ticket };
    sessionRef.current = next;
    setSession(next);
    setMessages([]);
    setStatus('connecting');
    shuttingDown.current = false;
    updates.current = Promise.resolve();
    const ws = new WebSocket(socketURL(room));
    socket.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ token: ticket.token }));
    ws.onmessage = event => {
      // Serialize SDP handling so an ICE candidate cannot race its offer.
      updates.current = updates.current.then(() => {
        if (socket.current === ws) return signal(JSON.parse(event.data));
      }).catch(error => onNotice(`Media connection: ${error.message}`));
    };
    ws.onerror = () => onNotice('Could not reach the meeting server. Check your connection and rejoin.');
    ws.onclose = () => {
      if (socket.current !== ws) return;
      socket.current = null;
      clearPeers();
      if (!shuttingDown.current) {
        setStatus('disconnected');
        onNotice('You were disconnected. Leave and rejoin to reconnect.');
      }
    };
  }
  async function replaceTrack(kind, track) {
    await Promise.all([...pcs.current.values()].map(p => (kind === 'audio' ? p.audioSender : p.videoSender)?.replaceTrack(track)));
  }
  function leave() {
    shuttingDown.current = true;
    const ws = socket.current;
    socket.current = null;
    ws?.close();
    clearPeers();
    sessionRef.current = null;
    setSession(null);
    setStatus('idle');
  }
  useEffect(() => {
    const timer = setInterval(() => send({ type: 'ping' }), 20000);
    return () => { clearInterval(timer); socket.current?.close(); clearPeers(); };
  }, []);
  return { session, participants, messages, locked, status, join, leave, send, announce, replaceTrack };
}
