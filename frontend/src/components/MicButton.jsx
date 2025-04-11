import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faMicrophoneSlash } from '@fortawesome/free-solid-svg-icons';
import './MicButton.css';

/**
 * MicButton component for controlling audio recording
 * @param {Object} props Component props
 * @param {Function} props.onStart Function to call when recording starts
 * @param {Function} props.onStop Function to call when recording stops
 * @param {boolean} props.disabled Whether the button is disabled
 * @param {string} props.mode Recording mode ('daily' or 'local')
 * @param {boolean} props.syncRecording Whether to sync recording state via Socket.IO
 * @param {string} props.sessionId Session ID for synchronization
 */
const MicButton = ({ 
  onStart, 
  onStop, 
  disabled = false, 
  mode = 'daily', 
  syncRecording = false,
  sessionId: propSessionId
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [remoteTriggered, setRemoteTriggered] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);

  // Get the socket instance and monitor connection status
  useEffect(() => {
    if (!syncRecording) return;

    const socket = window.socket || window.constellationSocket;
    if (!socket) {
      console.warn('MicButton: Socket.IO não encontrado na janela. Sincronização não funcionará.');
      return;
    }

    // Check if socket is connected
    const isConnected = socket.connected;
    setSocketConnected(isConnected);
    console.log(`MicButton: Socket.IO ${isConnected ? 'conectado' : 'desconectado'} (ID: ${socket.id || 'não disponível'})`);

    // Set up connection event listeners
    const handleConnect = () => {
      console.log(`MicButton: Socket.IO conectado (ID: ${socket.id})`);
      setSocketConnected(true);
      
      // Re-join session room when reconnected
      const sessionId = propSessionId || window.sessionId || new URLSearchParams(window.location.search).get('sessionId');
      if (sessionId) {
        console.log(`MicButton: Re-entrando na sala da sessão ${sessionId}`);
        socket.emit('join-session', { sessionId });
      }
    };

    const handleDisconnect = () => {
      console.log('MicButton: Socket.IO desconectado');
      setSocketConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [syncRecording, propSessionId]);

  useEffect(() => {
    // If available, get the participant count from the window object
    const updateParticipantCount = () => {
      if (window.dailyAudioCapture && mode === 'daily') {
        setParticipantCount(window.dailyAudioCapture.getParticipantCount() || 0);
      }
    };

    updateParticipantCount();
    
    // Set up interval to update participant count
    const interval = setInterval(updateParticipantCount, 2000);
    
    return () => {
      clearInterval(interval);
    };
  }, [mode]);

  // Set up socket event listeners for recording synchronization
  useEffect(() => {
    if (!syncRecording) return;
    
    const socket = window.socket || window.constellationSocket;
    if (!socket) {
      console.warn('MicButton: Socket.IO não disponível para configurar sincronização');
      return;
    }
    
    console.log('MicButton: Configurando listeners para sincronização de gravação');
    
    // Listen for recording start event from other participants
    const handleStartRecording = (data) => {
      console.log('MicButton: Recebido evento recording-start', data);
      if (!isRecording && !disabled) {
        console.log('MicButton: Iniciando gravação remotamente');
        setRemoteTriggered(true);
        setIsRecording(true);
        if (onStart) onStart();
      }
    };
    
    // Listen for recording stop event from other participants
    const handleStopRecording = (data) => {
      console.log('MicButton: Recebido evento recording-stop', data);
      if (isRecording) {
        console.log('MicButton: Parando gravação remotamente');
        setRemoteTriggered(true);
        setIsRecording(false);
        if (onStop) onStop();
      }
    };
    
    socket.on('recording-start', handleStartRecording);
    socket.on('recording-stop', handleStopRecording);
    
    return () => {
      console.log('MicButton: Removendo listeners de sincronização');
      socket.off('recording-start', handleStartRecording);
      socket.off('recording-stop', handleStopRecording);
    };
  }, [syncRecording, isRecording, disabled, onStart, onStop]);

  const toggleRecording = useCallback(() => {
    // Prevent double-triggering when handling remote events
    if (remoteTriggered) {
      setRemoteTriggered(false);
      return;
    }

    const socket = window.socket || window.constellationSocket;
    const sessionId = propSessionId || window.sessionId || new URLSearchParams(window.location.search).get('sessionId');
    
    if (isRecording) {
      console.log('MicButton: Parando gravação localmente');
      setIsRecording(false);
      if (onStop) onStop();
      
      // Emit stop recording event via socket if syncing is enabled
      if (syncRecording && socket && socket.connected && sessionId) {
        console.log(`MicButton: Emitindo evento para parar gravação em outros dispositivos. Socket: ${socket.id}, Sessão: ${sessionId}`);
        socket.emit('recording-event', {
          type: 'stop',
          sessionId,
          timestamp: Date.now()
        });
      } else if (syncRecording) {
        console.warn(`MicButton: Não foi possível emitir evento de parada. Socket conectado: ${socket?.connected}, sessionId: ${sessionId}`);
      }
    } else {
      console.log('MicButton: Iniciando gravação localmente');
      setIsRecording(true);
      if (onStart) onStart();
      
      // Emit start recording event via socket if syncing is enabled
      if (syncRecording && socket && socket.connected && sessionId) {
        console.log(`MicButton: Emitindo evento para iniciar gravação em outros dispositivos. Socket: ${socket.id}, Sessão: ${sessionId}`);
        socket.emit('recording-event', {
          type: 'start',
          sessionId,
          timestamp: Date.now()
        });
      } else if (syncRecording) {
        console.warn(`MicButton: Não foi possível emitir evento de início. Socket conectado: ${socket?.connected}, sessionId: ${sessionId}`);
      }
    }
  }, [isRecording, onStart, onStop, syncRecording, remoteTriggered, propSessionId]);

  const buttonText = isRecording 
    ? `Parar Gravação${mode === 'daily' ? ` (${participantCount} participantes)` : ''}` 
    : 'Iniciar Gravação';

  return (
    <button
      className={`mic-button ${isRecording ? 'recording' : ''} ${syncRecording && socketConnected ? 'sync-enabled' : ''}`}
      onClick={toggleRecording}
      disabled={disabled}
      aria-label={isRecording ? 'Parar gravação' : 'Iniciar gravação'}
      title={`${isRecording ? 'Parar' : 'Iniciar'} gravação${syncRecording ? ' (sincronizada)' : ''}`}
    >
      {isRecording && <div className="recording-indicator" />}
      {syncRecording && socketConnected && (
        <div className="sync-indicator" title="Sincronização ativa" />
      )}
      <span className="mic-icon">
        <FontAwesomeIcon icon={isRecording ? faMicrophoneSlash : faMicrophone} />
      </span>
      {buttonText}
    </button>
  );
};

export default MicButton; 