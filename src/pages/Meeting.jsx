import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getToken, getRole } from '../lib/auth'
import { joinMeetingRoom, sendOffer, sendAnswer, sendIce, leaveMeeting } from '../api/meeting'

// STUN servers — Google's public ones, good enough for most networks.
// For production behind symmetric NAT a TURN server would be needed.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export default function Meeting() {
  const { roomId }  = useParams()
  const navigate    = useNavigate()
  const role        = getRole()

  // Video element refs
  const localVideoRef  = useRef(null)
  const remoteVideoRef = useRef(null)

  // WebRTC refs — kept as refs (not state) so callbacks always see latest values
  const pcRef         = useRef(null)   // RTCPeerConnection
  const localStreamRef = useRef(null)  // local MediaStream
  const cleanupRef    = useRef(null)   // socket cleanup fn

  // UI state
  const [status,      setStatus]      = useState('waiting')  // waiting | connecting | connected | ended | error
  const [errorMsg,    setErrorMsg]    = useState('')
  const [micMuted,    setMicMuted]    = useState(false)
  const [camOff,      setCamOff]      = useState(false)
  const [peerLabel,   setPeerLabel]   = useState('')

  // ── Helpers ────────────────────────────────────────────────────────────

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
  }, [])

  const closePeer = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate    = null
      pcRef.current.ontrack           = null
      pcRef.current.onconnectionstatechange = null
      pcRef.current.close()
      pcRef.current = null
    }
  }, [])

  const endCall = useCallback((reason = 'ended') => {
    cleanupRef.current?.()
    closePeer()
    stopLocalStream()
    setStatus(reason)
  }, [closePeer, stopLocalStream])

  // ── Create RTCPeerConnection ────────────────────────────────────────────

  const createPeerConnection = useCallback((roomId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS)

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendIce(roomId, candidate)
    }

    pc.ontrack = ({ streams }) => {
      if (remoteVideoRef.current && streams[0]) {
        remoteVideoRef.current.srcObject = streams[0]
        setStatus('connected')
      }
    }

    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        endCall('ended')
      }
    }

    return pc
  }, [endCall])

  // ── Main effect — get media, join room, wire signalling ────────────────

  useEffect(() => {
    if (!getToken()) { navigate('/login'); return }
    if (!roomId)     { navigate('/appointments'); return }

    setPeerLabel(role === 'teacher' ? 'Student' : 'Professor')

    let cancelled = false

    async function start() {
      // 1. Get local camera + mic
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch {
        setStatus('error')
        setErrorMsg('Could not access your camera or microphone. Please allow access and try again.')
        return
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }

      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      // 2. Create peer connection and add local tracks
      const pc = createPeerConnection(roomId)
      pcRef.current = pc
      stream.getTracks().forEach((track) => pc.addTrack(track, stream))

      // 3. Join Socket.IO meeting room and wire signalling
      const cleanup = joinMeetingRoom(roomId, {
        // The second peer to join sends the offer
        onPeerJoined: async () => {
          if (cancelled) return
          setStatus('connecting')
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            sendOffer(roomId, pc.localDescription)
          } catch (e) {
            setErrorMsg('Failed to create offer: ' + e.message)
            setStatus('error')
          }
        },

        onOffer: async (sdp) => {
          if (cancelled) return
          setStatus('connecting')
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            sendAnswer(roomId, pc.localDescription)
          } catch (e) {
            setErrorMsg('Failed to handle offer: ' + e.message)
            setStatus('error')
          }
        },

        onAnswer: async (sdp) => {
          if (cancelled) return
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp))
          } catch (e) {
            setErrorMsg('Failed to handle answer: ' + e.message)
            setStatus('error')
          }
        },

        onIce: async (candidate) => {
          if (cancelled || !candidate) return
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate))
          } catch {
            // Non-fatal — stale candidates are normal
          }
        },

        onPeerLeft: () => {
          if (!cancelled) endCall('ended')
        },
      })

      cleanupRef.current = cleanup
    }

    start()

    return () => {
      cancelled = true
      cleanupRef.current?.()
      closePeer()
      stopLocalStream()
    }
  }, [roomId, role, navigate, createPeerConnection, closePeer, stopLocalStream, endCall])

  // ── Controls ────────────────────────────────────────────────────────────

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled
    })
    setMicMuted((m) => !m)
  }

  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled
    })
    setCamOff((c) => !c)
  }

  const handleLeave = () => {
    leaveMeeting(roomId)
    endCall('ended')
    navigate('/appointments')
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-4 text-center">
        <span className="material-symbols-outlined text-5xl text-error">videocam_off</span>
        <h2 className="text-2xl font-headline font-bold text-on-surface">Could not start call</h2>
        <p className="text-on-surface-variant text-sm max-w-sm">{errorMsg}</p>
        <button onClick={() => navigate('/appointments')} className="btn-primary px-6 py-3 rounded-xl">
          Back to Appointments
        </button>
      </div>
    )
  }

  if (status === 'ended') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-4 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">call_end</span>
        <h2 className="text-2xl font-headline font-bold text-on-surface">Call ended</h2>
        <p className="text-on-surface-variant text-sm">The meeting has ended.</p>
        <button onClick={() => navigate('/appointments')} className="btn-primary px-6 py-3 rounded-xl">
          Back to Appointments
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-bold text-white/80 tracking-wide">ProfConnect Meeting</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
          {status === 'waiting' && (
            <>
              <span className="material-symbols-outlined text-sm text-amber-400">hourglass_top</span>
              <span className="text-xs text-white/60">Waiting for {peerLabel}…</span>
            </>
          )}
          {status === 'connecting' && (
            <>
              <span className="material-symbols-outlined text-sm text-blue-400 animate-spin" style={{ animationDuration: '1.5s' }}>sync</span>
              <span className="text-xs text-white/60">Connecting…</span>
            </>
          )}
          {status === 'connected' && (
            <>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-white/60">Connected</span>
            </>
          )}
        </div>
      </header>

      {/* ── Video area ─────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden bg-[#0d0d14]">

        {/* Remote video — full size */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />

        {/* Waiting overlay when no remote stream yet */}
        {status !== 'connected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0d0d14]">
            <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-white/30">person</span>
            </div>
            <p className="text-white/40 text-sm">
              {status === 'waiting' ? `Waiting for ${peerLabel} to join…` : `Connecting to ${peerLabel}…`}
            </p>
          </div>
        )}

        {/* Local video — picture-in-picture corner */}
        <div className="absolute bottom-4 right-4 w-36 h-24 sm:w-48 sm:h-32 rounded-2xl overflow-hidden border-2 border-white/10 shadow-2xl bg-black">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${camOff ? 'opacity-0' : ''}`}
          />
          {camOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a24]">
              <span className="material-symbols-outlined text-white/30">videocam_off</span>
            </div>
          )}
          <div className="absolute bottom-1.5 left-2">
            <span className="text-[10px] text-white/50 font-medium">You</span>
          </div>
        </div>
      </div>

      {/* ── Controls bar ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-4 px-6 py-5 border-t border-white/5 bg-[#0a0a0f]">

        {/* Mic toggle */}
        <button
          onClick={toggleMic}
          title={micMuted ? 'Unmute' : 'Mute'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            micMuted
              ? 'bg-red-500/20 border border-red-500/40 text-red-400'
              : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
          }`}
        >
          <span className="material-symbols-outlined text-xl">
            {micMuted ? 'mic_off' : 'mic'}
          </span>
        </button>

        {/* Camera toggle */}
        <button
          onClick={toggleCam}
          title={camOff ? 'Turn camera on' : 'Turn camera off'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            camOff
              ? 'bg-red-500/20 border border-red-500/40 text-red-400'
              : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
          }`}
        >
          <span className="material-symbols-outlined text-xl">
            {camOff ? 'videocam_off' : 'videocam'}
          </span>
        </button>

        {/* End call */}
        <button
          onClick={handleLeave}
          title="End call"
          className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-red-900/40"
        >
          <span className="material-symbols-outlined text-white text-2xl">call_end</span>
        </button>
      </div>
    </div>
  )
}
