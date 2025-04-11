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
  const [diagnosticInfo, setDiagnosticInfo] = useState(null);
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);

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
  const showTranscribeNowButton = isRecording && mode === 'webrtc' && webrtcStatus.initialized;

  // Função para diagnosticar problemas de WebRTC
  const runWebRTCDiagnostic = async () => {
    try {
      console.log('MicButton: Iniciando diagnóstico WebRTC');
      setDiagnosticInfo({ status: 'running', details: [] });
      
      // Verificar a existência do serviço
      const info = {
        status: 'incomplete',
        details: [],
        browser: {
          name: navigator.userAgent,
          webRTCSupport: !!window.RTCPeerConnection
        },
        permissions: {},
        devices: [],
        webrtcStatus: { ...webrtcStatus },
        session: {
          id: propSessionId,
          socket: !!socket,
          socketId: socket?.id
        }
      };
      
      // Adicionar mensagem de diagnóstico
      const addInfo = (message, status = 'info') => {
        console.log(`WebRTC Diagnóstico: ${message}`);
        info.details.push({ message, status, timestamp: new Date().toISOString() });
        setDiagnosticInfo({ ...info });
      };
      
      addInfo('Iniciando diagnóstico WebRTC');
      
      // Verificar suporte a WebRTC
      if (!window.RTCPeerConnection) {
        addInfo('Este navegador não suporta WebRTC!', 'error');
      } else {
        addInfo('Navegador com suporte a WebRTC', 'success');
      }
      
      // Verificar se o WebRTC está inicializado
      if (!window.webrtcTranscriptionService) {
        addInfo('Serviço WebRTC não está disponível!', 'error');
      } else {
        const status = window.webrtcTranscriptionService.getStatus();
        addInfo(`Serviço WebRTC status: ${JSON.stringify(status)}`);
        
        if (!status.isInitialized) {
          addInfo('Serviço WebRTC não está inicializado!', 'warning');
        } else {
          addInfo('Serviço WebRTC inicializado com sucesso', 'success');
        }
        
        // Obter diagnóstico detalhado
        try {
          const diagnosticResults = window.webrtcTranscriptionService.diagnoseConnections();
          info.webrtcDiagnostic = diagnosticResults;
          
          addInfo(`Diagnóstico de conexões: ${diagnosticResults.connections} conexões, ${diagnosticResults.active} ativas`);
          
          if (diagnosticResults.errors && diagnosticResults.errors.length > 0) {
            diagnosticResults.errors.forEach(error => {
              addInfo(`Erro de conexão: ${error.message}`, 'error');
            });
          }
          
          if (diagnosticResults.warnings && diagnosticResults.warnings.length > 0) {
            diagnosticResults.warnings.forEach(warning => {
              addInfo(`Alerta: ${warning.message}`, 'warning');
            });
          }
          
          if (diagnosticResults.active === 0) {
            addInfo('Nenhuma conexão WebRTC ativa!', 'error');
          }
        } catch (diagError) {
          addInfo(`Erro ao executar diagnóstico: ${diagError.message}`, 'error');
        }
      }
      
      // Verificar permissões de microfone
      addInfo('Verificando permissões de microfone...');
      
      try {
        // Verificar permissão
        if (navigator.permissions && navigator.permissions.query) {
          const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
          info.permissions.microphone = permissionStatus.state;
          
          if (permissionStatus.state === 'granted') {
            addInfo('Permissão de microfone concedida!', 'success');
          } else if (permissionStatus.state === 'denied') {
            addInfo('Permissão de microfone negada! Você precisa permitir o acesso nas configurações do navegador.', 'error');
          } else if (permissionStatus.state === 'prompt') {
            addInfo('O navegador vai solicitar permissão de microfone quando necessário', 'warning');
          }
        } else {
          addInfo('API de permissões não suportada neste navegador', 'warning');
        }
      } catch (permError) {
        addInfo(`Erro ao verificar permissões: ${permError.message}`, 'error');
      }
      
      // Tentar obter dispositivos de áudio
      addInfo('Verificando dispositivos de áudio...');
      
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(device => device.kind === 'audioinput');
        
        info.devices = audioDevices.map(device => ({
          id: device.deviceId,
          label: device.label || 'Dispositivo sem nome (permissão não concedida)',
          kind: device.kind
        }));
        
        if (audioDevices.length === 0) {
          addInfo('Nenhum dispositivo de áudio encontrado!', 'error');
        } else {
          addInfo(`Encontrados ${audioDevices.length} dispositivos de áudio`, 'success');
          
          audioDevices.forEach((device, index) => {
            addInfo(`Dispositivo ${index + 1}: ${device.label || 'Sem nome (permissão não concedida)'}`);
          });
        }
      } catch (devicesError) {
        addInfo(`Erro ao enumerar dispositivos: ${devicesError.message}`, 'error');
      }
      
      // Tentar obter áudio para teste
      addInfo('Tentando obter stream de áudio para teste...');
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        info.audioTest = { success: true };
        
        // Verificar tracks de áudio
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          const track = audioTracks[0];
          info.audioTest.track = {
            id: track.id,
            label: track.label,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState
          };
          
          addInfo(`Stream de áudio obtido com sucesso: ${track.label}`, 'success');
          
          // Testar nível de áudio se possível
          if (window.AudioContext || window.webkitAudioContext) {
            addInfo('Analisando nível de áudio...');
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContextClass();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            
            info.audioTest.level = average;
            
            if (average < 1) {
              addInfo('Nível de áudio muito baixo! Seu microfone parece estar mudo ou não está captando som.', 'warning');
            } else {
              addInfo(`Nível de áudio detectado: ${average.toFixed(2)}`, 'success');
            }
            
            // Limpar recursos
            setTimeout(() => {
              audioContext.close();
            }, 1000);
          }
        } else {
          addInfo('Stream obtido, mas sem tracks de áudio!', 'warning');
        }
        
        // Parar a stream de teste
        stream.getTracks().forEach(track => track.stop());
      } catch (streamError) {
        info.audioTest = { 
          success: false, 
          error: streamError.name, 
          message: streamError.message 
        };
        
        if (streamError.name === 'NotAllowedError' || streamError.name === 'PermissionDeniedError') {
          addInfo('Permissão de microfone negada pelo usuário!', 'error');
          addInfo('Você precisa permitir o acesso ao microfone nas configurações do navegador.', 'error');
        } else if (streamError.name === 'NotFoundError' || streamError.name === 'DevicesNotFoundError') {
          addInfo('Nenhum dispositivo de áudio encontrado!', 'error');
          addInfo('Verifique se seu microfone está conectado e funcionando.', 'error');
        } else if (streamError.name === 'NotReadableError' || streamError.name === 'TrackStartError') {
          addInfo('Não foi possível acessar o microfone! Ele pode estar sendo usado por outro aplicativo.', 'error');
        } else {
          addInfo(`Erro ao acessar microfone: ${streamError.message}`, 'error');
        }
      }
      
      // Status final
      if (info.details.some(d => d.status === 'error')) {
        info.status = 'error';
        addInfo('Diagnóstico concluído com erros!', 'error');
      } else if (info.details.some(d => d.status === 'warning')) {
        info.status = 'warning';
        addInfo('Diagnóstico concluído com avisos.', 'warning');
      } else {
        info.status = 'success';
        addInfo('Diagnóstico concluído com sucesso!', 'success');
      }
      
      // Tentar corrigir problemas automaticamente
      if (info.status !== 'success' && window.webrtcTranscriptionService) {
        addInfo('Tentando reparar conexões WebRTC automaticamente...');
        try {
          const repairResult = await window.webrtcTranscriptionService.repairConnections();
          addInfo(`Tentativa de reparo: ${repairResult.success ? 'Sucesso' : 'Falha'}`);
          
          if (repairResult.reconnected && repairResult.reconnected > 0) {
            addInfo(`${repairResult.reconnected} conexões reconectadas com sucesso!`, 'success');
          }
          
          info.repairAttempt = repairResult;
        } catch (repairError) {
          addInfo(`Erro na tentativa de reparo: ${repairError.message}`, 'error');
        }
      }
      
      // Salvar informações completas
      setDiagnosticInfo(info);
      setShowDiagnosticModal(true);
    } catch (error) {
      console.error('MicButton: Erro ao executar diagnóstico:', error);
      setDiagnosticInfo({
        status: 'error',
        details: [{ message: `Erro no diagnóstico: ${error.message}`, status: 'error', timestamp: new Date().toISOString() }]
      });
    }
  };

  // Renderizar modal de diagnóstico
  const renderDiagnosticModal = () => {
    if (!showDiagnosticModal) return null;
    
    return (
      <div className="diagnostic-modal">
        <div className="diagnostic-modal-content">
          <h3>Diagnóstico de Conexão WebRTC</h3>
          <div className="diagnostic-status">
            Status: 
            <span className={`status-${diagnosticInfo.status}`}>
              {diagnosticInfo.status === 'success' ? 'Sucesso' : 
               diagnosticInfo.status === 'warning' ? 'Avisos' : 
               diagnosticInfo.status === 'error' ? 'Erros' : 
               diagnosticInfo.status === 'running' ? 'Em Andamento' : 'Desconhecido'}
            </span>
          </div>
          
          <div className="diagnostic-details">
            {diagnosticInfo.details.map((detail, index) => (
              <div key={index} className={`detail-item detail-${detail.status}`}>
                {detail.message}
              </div>
            ))}
          </div>
          
          {diagnosticInfo.status === 'error' && (
            <div className="diagnostic-help">
              <h4>Como resolver:</h4>
              <ul>
                <li>Verifique se o microfone está conectado e funcionando</li>
                <li>Permita o acesso ao microfone nas configurações do navegador</li>
                <li>Feche outros aplicativos que possam estar usando o microfone</li>
                <li>Tente atualizar a página</li>
                <li>Tente usar outro navegador (Chrome é recomendado)</li>
              </ul>
            </div>
          )}
          
          <div className="diagnostic-actions">
            <button 
              className="diagnostic-retry-btn" 
              onClick={runWebRTCDiagnostic}
              disabled={diagnosticInfo.status === 'running'}
            >
              Testar Novamente
            </button>
            <button 
              className="diagnostic-close-btn" 
              onClick={() => setShowDiagnosticModal(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Renderizar botão de diagnóstico quando houver problemas
  const renderDiagnosticButton = () => {
    // Mostrar botão apenas no modo webrtc e quando houver problemas
    const showButton = mode === 'webrtc' && (!webrtcStatus.initialized || !webrtcStatus.connected);
    
    if (!showButton) return null;
    
    return (
      <button 
        className="diagnostic-button"
        onClick={runWebRTCDiagnostic}
        title="Diagnosticar problemas de conexão WebRTC"
      >
        🔍 Diagnosticar Conexão
      </button>
    );
  };

  return (
    <div className={`mic-button-container ${mode}`}>
      {buttonText && (
        <button
          className={`mic-button ${isRecording ? 'recording' : ''} ${(isRecording && isRequesting) ? 'transcribing' : ''}`}
          onClick={toggleRecording}
          disabled={isRequesting || (syncRecording && !socketConnected)}
          data-mic="true"
        >
          <span className="mic-icon">{isRecording ? '⏹️' : '🎙️'}</span>
          <span className="mic-text">{buttonText}</span>
          {(showRTCStatus && !isRTCActive) && <span className="rtc-status-indicator disabled" title="WebRTC inativo"></span>}
          {(showRTCStatus && isRTCActive) && <span className="rtc-status-indicator active" title="WebRTC ativo"></span>}
        </button>
      )}
      
      {showTranscribeNowButton && (
        <button
          className={`transcribe-now-button ${isRequesting ? 'requesting' : ''}`}
          onClick={requestPartialTranscription}
          disabled={isRequesting}
        >
          {isRequesting ? 'Transcrevendo...' : 'Transcrever Agora'}
        </button>
      )}
      
      {renderDiagnosticButton()}
      {renderDiagnosticModal()}
      
      <style jsx>{`
        .mic-button-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        
        .mic-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 8px 16px;
          cursor: pointer;
          transition: all 0.3s;
          position: relative;
        }
        
        .mic-button.recording {
          background-color: #ffebee;
          border-color: #f44336;
          color: #f44336;
        }
        
        .mic-icon {
          font-size: 1.2em;
        }
        
        .transcribe-now-button {
          background-color: #e3f2fd;
          border: 1px solid #2196f3;
          border-radius: 4px;
          padding: 6px 12px;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .transcribe-now-button:hover {
          background-color: #bbdefb;
        }
        
        .transcribe-now-button.requesting {
          background-color: #bbdefb;
          cursor: not-allowed;
        }
        
        .rtc-status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          position: absolute;
          right: 8px;
          top: 8px;
        }
        
        .rtc-status-indicator.active {
          background-color: #4caf50;
        }
        
        .rtc-status-indicator.disabled {
          background-color: #f44336;
        }
        
        .diagnostic-button {
          background-color: #fff3e0;
          border: 1px solid #ff9800;
          border-radius: 4px;
          padding: 6px 12px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.3s;
        }
        
        .diagnostic-button:hover {
          background-color: #ffe0b2;
        }
        
        .diagnostic-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        
        .diagnostic-modal-content {
          background-color: white;
          padding: 20px;
          border-radius: 8px;
          max-width: 90%;
          width: 600px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        .diagnostic-status {
          margin: 10px 0;
          padding: 8px;
          background-color: #f5f5f5;
          border-radius: 4px;
        }
        
        .status-success {
          color: #4caf50;
          font-weight: bold;
          margin-left: 8px;
        }
        
        .status-warning {
          color: #ff9800;
          font-weight: bold;
          margin-left: 8px;
        }
        
        .status-error {
          color: #f44336;
          font-weight: bold;
          margin-left: 8px;
        }
        
        .status-running {
          color: #2196f3;
          font-weight: bold;
          margin-left: 8px;
        }
        
        .diagnostic-details {
          margin: 15px 0;
          max-height: 300px;
          overflow-y: auto;
          border: 1px solid #ddd;
          padding: 10px;
          border-radius: 4px;
        }
        
        .detail-item {
          padding: 6px;
          margin-bottom: 4px;
          border-radius: 4px;
        }
        
        .detail-info {
          background-color: #e3f2fd;
        }
        
        .detail-success {
          background-color: #e8f5e9;
        }
        
        .detail-warning {
          background-color: #fff3e0;
        }
        
        .detail-error {
          background-color: #ffebee;
        }
        
        .diagnostic-help {
          margin: 15px 0;
          padding: 10px;
          background-color: #f5f5f5;
          border-radius: 4px;
        }
        
        .diagnostic-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 15px;
        }
        
        .diagnostic-retry-btn {
          background-color: #2196f3;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
        }
        
        .diagnostic-close-btn {
          background-color: #f5f5f5;
          border: 1px solid #ddd;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

export default MicButton; 