import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faMicrophoneSlash, faFileAlt } from '@fortawesome/free-solid-svg-icons';
import './MicButton.css';
import webrtcTranscriptionService from '../services/webrtcTranscriptionService';

/**
 * MicButton component for controlling audio recording
 * @param {Object} props Component props
 * @param {Function} props.onStart Function to call when recording starts
 * @param {Function} props.onStop Function to call when recording stops
 * @param {Function} props.onPartialTranscription Function to call when a partial transcription is requested
 * @param {boolean} props.disabled Whether the button is disabled
 * @param {string} props.mode Recording mode ('webspeech', 'webrtc', or other)
 * @param {boolean} props.syncRecording Whether to sync recording state via Socket.IO
 * @param {string} props.sessionId Session ID for synchronization
 * @param {Object} props.socket Socket.IO instance for WebRTC
 */
const MicButton = ({ 
  onStart, 
  onStop, 
  onPartialTranscription,
  disabled = false, 
  mode = 'webspeech', 
  syncRecording = false,
  sessionId: propSessionId,
  socket
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [remoteTriggered, setRemoteTriggered] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [webrtcStatus, setWebrtcStatus] = useState({ initialized: false, connected: false });
  const [isRequesting, setIsRequesting] = useState(false);

  // Initialize WebRTC if mode is 'webrtc'
  useEffect(() => {
    if (mode === 'webrtc' && socket && propSessionId) {
      console.log('MicButton: Inicializando serviço WebRTC');
      
      // Initialize WebRTC service
      webrtcTranscriptionService.initialize(propSessionId, socket, (transcription, options = {}) => {
        console.log('MicButton: Transcrição recebida via WebRTC:', transcription);
        // If there's a callback for transcription, call it
        if (options.isPartial) {
          if (typeof onPartialTranscription === 'function') {
            onPartialTranscription(transcription, options);
          }
        } else if (typeof onStop === 'function') {
          onStop(transcription);
        }
      }).then(success => {
        console.log(`MicButton: Serviço WebRTC ${success ? 'inicializado com sucesso' : 'falhou ao inicializar'}`);
        setWebrtcStatus(prev => ({ ...prev, initialized: success, connected: success }));
      });
      
      // Cleanup when component unmounts or mode changes
      return () => {
        console.log('MicButton: Limpando serviço WebRTC');
        webrtcTranscriptionService.cleanup();
        setWebrtcStatus({ initialized: false, connected: false });
      };
    }
  }, [mode, socket, propSessionId, onStop, onPartialTranscription]);

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
      } else if (mode === 'webrtc' && webrtcStatus.initialized) {
        const status = webrtcTranscriptionService.getStatus();
        setParticipantCount(status.participantCount || 0);
      }
    };

    updateParticipantCount();
    
    // Set up interval to update participant count
    const interval = setInterval(updateParticipantCount, 2000);
    
    return () => {
      clearInterval(interval);
    };
  }, [mode, webrtcStatus.initialized]);

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
        
        if (mode === 'webrtc' && webrtcStatus.initialized) {
          webrtcTranscriptionService.startRecording();
        } else if (onStart) {
          onStart();
        }
      }
    };
    
    // Listen for recording stop event from other participants
    const handleStopRecording = (data) => {
      console.log('MicButton: Recebido evento recording-stop', data);
      if (isRecording) {
        console.log('MicButton: Parando gravação remotamente');
        setRemoteTriggered(true);
        setIsRecording(false);
        
        if (mode === 'webrtc' && webrtcStatus.initialized) {
          webrtcTranscriptionService.stopRecording();
        } else if (onStop) {
          onStop();
        }
      }
    };
    
    socket.on('recording-start', handleStartRecording);
    socket.on('recording-stop', handleStopRecording);
    
    return () => {
      console.log('MicButton: Removendo listeners de sincronização');
      socket.off('recording-start', handleStartRecording);
      socket.off('recording-stop', handleStopRecording);
    };
  }, [syncRecording, isRecording, disabled, onStart, onStop, mode, webrtcStatus.initialized]);

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
      
      // Handle WebRTC mode
      if (mode === 'webrtc' && webrtcStatus.initialized) {
        webrtcTranscriptionService.stopRecording()
          .then(result => {
            if (result && result.transcription && onStop) {
              onStop(result.transcription);
            }
          });
      } else if (onStop) {
        onStop();
      }
      
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
      
      // Handle WebRTC mode
      if (mode === 'webrtc' && webrtcStatus.initialized) {
        webrtcTranscriptionService.startRecording();
      } else if (onStart) {
        onStart();
      }
      
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
  }, [isRecording, onStart, onStop, syncRecording, remoteTriggered, propSessionId, mode, webrtcStatus.initialized]);

  const requestPartialTranscription = async () => {
    if (!isRecording || mode !== 'webrtc' || !webrtcStatus.initialized) {
      console.log('MicButton: Não é possível solicitar transcrição parcial');
      return;
    }

    try {
      setIsRequesting(true);
      console.log('MicButton: Solicitando transcrição parcial');
      
      const result = await webrtcTranscriptionService.transcribeCurrentAudio();
      
      if (result && result.transcription) {
        console.log('MicButton: Transcrição parcial recebida:', result.transcription);
        // O callback será tratado pelo serviço WebRTC através do callback registrado na inicialização
      } else {
        console.warn('MicButton: Nenhuma transcrição parcial recebida');
      }
    } catch (error) {
      console.error('MicButton: Erro ao solicitar transcrição parcial:', error);
    } finally {
      setIsRequesting(false);
    }
  };

  const getModeLabel = () => {
    switch (mode) {
      case 'daily':
        return 'conversa';
      case 'webrtc':
        return 'WebRTC';
      case 'webspeech':
        return 'microfone';
      default:
        return mode;
    }
  };

  const buttonText = isRecording 
    ? `Parar Gravação${(mode === 'daily' || mode === 'webrtc') ? ` (${participantCount} participantes)` : ''}` 
    : 'Iniciar Gravação';

  const showRTCStatus = mode === 'webrtc';
  const isRTCActive = webrtcStatus.initialized && webrtcStatus.connected;

  return (
    <div className="mic-button-container">
      <button
        className={`mic-button ${isRecording ? 'recording' : ''} ${syncRecording && socketConnected ? 'sync-enabled' : ''} ${showRTCStatus && isRTCActive ? 'webrtc-enabled' : ''}`}
        onClick={toggleRecording}
        disabled={disabled || (mode === 'webrtc' && !webrtcStatus.initialized)}
        aria-label={isRecording ? 'Parar gravação' : 'Iniciar gravação'}
        title={`${isRecording ? 'Parar' : 'Iniciar'} gravação de ${getModeLabel()}${syncRecording ? ' (sincronizada)' : ''}${mode === 'webrtc' ? ' (alta qualidade)' : ''}`}
      >
        {isRecording && <div className="recording-indicator" />}
        {syncRecording && socketConnected && (
          <div className="sync-indicator" title="Sincronização ativa" />
        )}
        {showRTCStatus && isRTCActive && (
          <div className="webrtc-indicator" title="WebRTC ativo (captura completa)" />
        )}
        <span className="mic-icon">
          <FontAwesomeIcon icon={isRecording ? faMicrophoneSlash : faMicrophone} />
        </span>
        {buttonText}
      </button>
      
      {isRecording && mode === 'webrtc' && webrtcStatus.initialized && (
        <button 
          className={`transcribe-now-button ${isRequesting ? 'requesting' : ''}`}
          onClick={requestPartialTranscription}
          disabled={isRequesting || !isRecording}
          title="Solicitar transcrição do áudio gravado até o momento"
        >
          <FontAwesomeIcon icon={faFileAlt} />
          {isRequesting ? 'Processando...' : 'Transcrever Agora'}
        </button>
      )}
    </div>
  );
};

export default MicButton; 