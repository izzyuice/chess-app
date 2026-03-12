import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import io from 'socket.io-client';

const socket = io('https://chess-app-production-3ddb.up.railway.app');

const PIECES = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

const FILES = ['a','b','c','d','e','f','g','h'];
const RANKS = ['8','7','6','5','4','3','2','1'];

function App() {
  const [game, setGame] = useState(new Chess());
  const [selected, setSelected] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [myColor, setMyColor] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [status, setStatus] = useState('Connecting...');

  const myVideo = useRef(null);
  const opponentVideo = useRef(null);
  const peerConnection = useRef(null);
  const myStream = useRef(null);
  const roomIdRef = useRef(null);

  const iceServers = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      myStream.current = stream;
      if (myVideo.current) myVideo.current.srcObject = stream;
      return stream;
    } catch (err) {
      console.log('Camera error:', err.message);
      return null;
    }
  }

  const createPeerConnection = useCallback(async (stream) => {
    const pc = new RTCPeerConnection(iceServers);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      if (opponentVideo.current) opponentVideo.current.srcObject = event.streams[0];
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice', { roomId: roomIdRef.current, candidate: event.candidate });
      }
    };
    return pc;
  }, []);

  useEffect(() => {
    socket.on('waiting', () => setStatus('Waiting for an opponent...'));

    socket.on('gameStart', async ({ color, roomId }) => {
      setMyColor(color);
      setRoomId(roomId);
      roomIdRef.current = roomId;
      setStatus("Game started! You are " + color + ". " + (color === 'white' ? "Your turn!" : "Opponent's turn."));
      setGame(new Chess());
      const stream = await startCamera();
      if (!stream) return;
      const pc = await createPeerConnection(stream);
      peerConnection.current = pc;
      if (color === 'white') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { roomId, offer });
      }
    });

    socket.on('webrtc-offer', async ({ offer }) => {
      if (!peerConnection.current) return;
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      socket.emit('webrtc-answer', { roomId: roomIdRef.current, answer });
    });

    socket.on('webrtc-answer', async ({ answer }) => {
      if (!peerConnection.current) return;
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('webrtc-ice', async ({ candidate }) => {
      if (!peerConnection.current) return;
      try {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.log('ICE error:', err);
      }
    });

    socket.on('opponentMove', (move) => {
      setGame(prev => {
        const copy = new Chess(prev.fen());
        copy.move(move);
        return copy;
      });
      setStatus('Your turn!');
    });

    socket.on('opponentLeft', () => {
      setStatus('Opponent disconnected. Waiting for new opponent...');
      setMyColor(null);
      setRoomId(null);
      setGame(new Chess());
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      if (opponentVideo.current) opponentVideo.current.srcObject = null;
    });

    return () => {
      socket.off('waiting');
      socket.off('gameStart');
      socket.off('opponentMove');
      socket.off('opponentLeft');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('webrtc-ice');
    };
  }, [createPeerConnection]);

  function handleClick(square) {
    if (!myColor) return;
    const currentTurn = game.turn() === 'w' ? 'white' : 'black';
    if (currentTurn !== myColor) return;
    const piece = game.get(square);

    if (!selected) {
      if (piece && piece.color === game.turn()) {
        setSelected(square);
        const moves = game.moves({ square, verbose: true }).map(m => m.to);
        setLegalMoves(moves);
      }
      return;
    }

    if (legalMoves.includes(square)) {
      const copy = new Chess(game.fen());
      const move = copy.move({ from: selected, to: square, promotion: 'q' });
      setGame(copy);
      setSelected(null);
      setLegalMoves([]);
      socket.emit('move', { roomId, move });
      setStatus("Opponent's turn...");
    } else if (piece && piece.color === game.turn()) {
      setSelected(square);
      const moves = game.moves({ square, verbose: true }).map(m => m.to);
      setLegalMoves(moves);
    } else {
      setSelected(null);
      setLegalMoves([]);
    }
  }

  function getSquareColor(file, rank) {
    const fileIdx = FILES.indexOf(file);
    const rankIdx = RANKS.indexOf(rank);
    return (fileIdx + rankIdx) % 2 === 0 ? '#f0d9b5' : '#b58863';
  }

  function renderSquare(file, rank) {
    const square = file + rank;
    const piece = game.get(square);
    const isSelected = selected === square;
    const isLegal = legalMoves.includes(square);
    const isCapture = isLegal && piece;
    let bg = getSquareColor(file, rank);
    if (isSelected) bg = '#f6f669';

    return (
      <div
        key={square}
        onClick={() => handleClick(square)}
        style={{
          width: '70px', height: '70px', backgroundColor: bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', position: 'relative', boxSizing: 'border-box',
          border: isCapture ? '3px solid rgba(255,0,0,0.6)' : 'none',
        }}
      >
        {isLegal && !isCapture && (
          <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.25)', position: 'absolute' }} />
        )}
        {piece && (
          <span style={{ fontSize: '52px', lineHeight: 1, userSelect: 'none', position: 'relative', zIndex: 1, filter: piece.color === 'w' ? 'drop-shadow(0px 1px 1px #000)' : 'none' }}>
            {PIECES[piece.color + piece.type.toUpperCase()]}
          </span>
        )}
      </div>
    );
  }

  const ranks = myColor === 'black' ? [...RANKS].reverse() : RANKS;
  const files = myColor === 'black' ? [...FILES].reverse() : FILES;
  const boardHeight = 70 * 8;
  const videoHeight = (boardHeight / 2) - 8;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#1a1a2e', padding: '20px' }}>
      <h1 style={{ color: 'white', marginBottom: '10px' }}>♟ Chess App</h1>
      <div style={{ marginBottom: '12px', padding: '8px 20px', backgroundColor: '#16213e', borderRadius: '8px' }}>
        <p style={{ color: '#eee', margin: 0, textAlign: 'center' }}>{status}</p>
      </div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ border: '3px solid #555' }}>
          {ranks.map(rank => (
            <div key={rank} style={{ display: 'flex' }}>
              {files.map(file => renderSquare(file, rank))}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <p style={{ color: '#aaa', margin: '0 0 4px 0', fontSize: '13px', fontWeight: 'bold' }}>Opponent</p>
            <video ref={opponentVideo} autoPlay playsInline
              style={{ width: '240px', height: videoHeight + 'px', backgroundColor: '#111', borderRadius: '8px', border: '2px solid #444', display: 'block', objectFit: 'cover' }} />
          </div>
          <div>
            <p style={{ color: '#aaa', margin: '0 0 4px 0', fontSize: '13px', fontWeight: 'bold' }}>You</p>
            <video ref={myVideo} autoPlay muted playsInline
              style={{ width: '240px', height: videoHeight + 'px', backgroundColor: '#111', borderRadius: '8px', border: '2px solid #444', display: 'block', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;