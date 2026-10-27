// WebRTC meeting signalling via the existing Socket.IO connection.
// The server (sockets.py) relays offer/answer/ICE between the two peers
// in a meeting:<roomId> room — it never inspects the payloads.
import { io } from 'socket.io-client'
import { API_BASE_URL } from './professorStatus'

let socket = null

function getSocket() {
  if (!socket) {
    socket = io(API_BASE_URL, { autoConnect: true, reconnection: true })
  }
  return socket
}

// Join the meeting room and wire up all signalling callbacks.
// Returns a cleanup function — call it on component unmount.
export function joinMeetingRoom(roomId, { onPeerJoined, onOffer, onAnswer, onIce, onPeerLeft }) {
  const s = getSocket()

  s.on('meeting:peer_joined', onPeerJoined)
  s.on('meeting:offer',       (d) => onOffer(d.sdp))
  s.on('meeting:answer',      (d) => onAnswer(d.sdp))
  s.on('meeting:ice',         (d) => onIce(d.candidate))
  s.on('meeting:peer_left',   onPeerLeft)

  s.emit('meeting:join', { roomId })

  return () => {
    s.off('meeting:peer_joined', onPeerJoined)
    s.off('meeting:offer')
    s.off('meeting:answer')
    s.off('meeting:ice')
    s.off('meeting:peer_left',  onPeerLeft)
    s.emit('meeting:leave', { roomId })
  }
}

export function sendOffer(roomId, sdp) {
  getSocket().emit('meeting:offer', { roomId, sdp })
}

export function sendAnswer(roomId, sdp) {
  getSocket().emit('meeting:answer', { roomId, sdp })
}

export function sendIce(roomId, candidate) {
  getSocket().emit('meeting:ice', { roomId, candidate })
}

export function leaveMeeting(roomId) {
  getSocket().emit('meeting:leave', { roomId })
}
