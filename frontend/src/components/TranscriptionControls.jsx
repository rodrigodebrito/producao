import React, { useState, useEffect, useRef, useMemo } from 'react';
import MicButton from './MicButton';
import RecordingModeSelector from './RecordingModeSelector';
import './AIComponents.css';
import aiService from '../services/aiService';

/**
 * Componente que renderiza os controles de transcrição
 * 
 * @param {string} sessionId - ID da sessão
 * @param {function} onTranscriptionComplete - Função para completar a transcrição
 * @param {boolean} disabled - Se o componente está desabilitado
 * @param {boolean} syncRecording - Se deve sincronizar gravação com outros participantes
 * @param {Object} socket - Objeto Socket.IO para comunicação em tempo real
 */
const TranscriptionControls = ({ 
  sessionId, 
  onTranscriptionComplete, 
  disabled, 
  syncRecording = true,
  socket = null
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [recordingMode, setRecordingMode] = useState('webspeech'); // webspeech, webrtc, daily

  // Use socket provided as prop or try to get it from window
  const socketInstance = useMemo(() => {
    return socket || window.socket || window.constellationSocket;
  }, [socket]);

  useEffect(() => {
    // Armazenar o sessionId globalmente para uso nos componentes que emitem eventos
    if (sessionId) {
      window.sessionId = sessionId;
      console.log(`TranscriptionControls: Armazenando sessionId globalmente: ${sessionId}`);
    }
  }, [sessionId]);

  const handleRecordingStart = () => {
    console.log(`TranscriptionControls: Iniciando gravação no modo: ${recordingMode}`);
    setError(null);
  };

  const handleRecordingStop = async (audioBlob) => {
    console.log(`TranscriptionControls: Gravação finalizada (modo: ${recordingMode})`);
    
    // Se o modo for WebRTC, o próprio serviço já processa a transcrição
    // e o áudio pode ser null, porque o MicButton recebe a transcrição diretamente
    if (recordingMode === 'webrtc') {
      console.log('TranscriptionControls: Modo WebRTC, transcrição gerenciada pelo serviço WebRTC');
      
      // Se audioBlob for string, é a transcrição já processada
      if (typeof audioBlob === 'string') {
        console.log('TranscriptionControls: Transcrição recebida via WebRTC');
        if (onTranscriptionComplete) {
          onTranscriptionComplete(audioBlob, { isComplete: true });
        }
        return;
      }
    }
    
    // Para os outros modos, processa o audioBlob normalmente
    try {
      if (!audioBlob) {
        console.error('TranscriptionControls: Erro: audioBlob é undefined ou null');
        setError('Erro ao processar áudio: Nenhum áudio foi capturado');
        return;
      }
      
      setIsProcessing(true);
      
      // Create a FormData object to send the audio file
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('sessionId', sessionId);
      
      console.log(`TranscriptionControls: Enviando áudio para transcrição (sessão: ${sessionId})`);
      
      // Send the audio to the server for transcription
      const response = await aiService.transcribeAudio(formData);
      
      if (response && response.transcript) {
        console.log('TranscriptionControls: Transcrição recebida com sucesso');
        // Call the callback with the transcription result
        if (onTranscriptionComplete) {
          onTranscriptionComplete(response.transcript, { isComplete: true });
        }
      } else {
        throw new Error('No transcript received from the server');
      }
    } catch (err) {
      console.error('TranscriptionControls: Erro de transcrição:', err);
      setError('Failed to transcribe audio. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePartialTranscription = (transcription, options = {}) => {
    console.log(`TranscriptionControls: Transcrição parcial recebida (tempo: ${options.timestamp || 'desconhecido'})`);
    
    if (!transcription) {
      console.error('TranscriptionControls: Erro: transcrição parcial é undefined ou null');
      setError('Erro ao processar transcrição parcial: Nenhum texto foi recebido');
      return;
    }
    
    // Chamar o callback com a transcrição parcial
    if (onTranscriptionComplete) {
      onTranscriptionComplete(transcription, { 
        isPartial: true, 
        timestamp: options.timestamp,
        duration: options.duration 
      });
    }
  };

  // Verificar se o socket está disponível
  useEffect(() => {
    if (syncRecording) {
      if (!socketInstance) {
        console.warn('TranscriptionControls: Socket.IO não encontrado. A sincronização pode não funcionar.');
      } else {
        console.log(`TranscriptionControls: Socket.IO disponível (ID: ${socketInstance.id || 'não conectado'})`);
        
        // Garantir que o socket esteja na sala correta
        if (sessionId && socketInstance.connected) {
          console.log(`TranscriptionControls: Entrando na sala: ${sessionId}`);
          socketInstance.emit('join-session', { sessionId });
        }
      }
    }
  }, [syncRecording, sessionId, socketInstance]);

  // Função para mudar o modo de gravação
  const handleModeChange = (newMode) => {
    console.log(`TranscriptionControls: Mudando modo de gravação: ${recordingMode} -> ${newMode}`);
    setRecordingMode(newMode);
  };

  return (
    <div className="transcription-controls">
      {/* Seletor de modo de gravação */}
      <RecordingModeSelector 
        mode={recordingMode} 
        onChange={handleModeChange} 
        disabled={disabled || isProcessing}
      />
      
      {/* MicButton com sessionId explícito para garantir sincronização */}
      <MicButton 
        onStart={handleRecordingStart} 
        onStop={handleRecordingStop} 
        onPartialTranscription={handlePartialTranscription}
        disabled={disabled || isProcessing}
        syncRecording={syncRecording}
        sessionId={sessionId}
        mode={recordingMode}
        socket={socketInstance}
      />
      
      {isProcessing && (
        <div className="ai-processing">
          <div className="ai-processing-indicator"></div>
          <span>Processando áudio...</span>
        </div>
      )}
      
      {error && (
        <div className="ai-error">{error}</div>
      )}
    </div>
  );
};

export default TranscriptionControls; 