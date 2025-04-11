import React, { useState, useEffect, useRef, useMemo } from 'react';
import MicButton from './MicButton';
import './AIComponents.css';
import aiService from '../services/aiService';

/**
 * Componente que renderiza os controles de transcrição
 * 
 * @param {string} sessionId - ID da sessão
 * @param {function} onTranscriptionComplete - Função para completar a transcrição
 * @param {boolean} disabled - Se o componente está desabilitado
 * @param {boolean} syncRecording - Se deve sincronizar gravação com outros participantes
 */
const TranscriptionControls = ({ sessionId, onTranscriptionComplete, disabled, syncRecording = true }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Armazenar o sessionId globalmente para uso nos componentes que emitem eventos
    if (sessionId) {
      window.sessionId = sessionId;
      console.log(`TranscriptionControls: Armazenando sessionId globalmente: ${sessionId}`);
    }
  }, [sessionId]);

  const handleRecordingStart = () => {
    console.log('TranscriptionControls: Iniciando gravação');
    setError(null);
  };

  const handleRecordingStop = async (audioBlob) => {
    console.log('TranscriptionControls: Gravação finalizada, processando áudio');
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
          onTranscriptionComplete(response.transcript);
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

  // Verificar se o socket está disponível
  useEffect(() => {
    if (syncRecording) {
      const socket = window.socket || window.constellationSocket;
      if (!socket) {
        console.warn('TranscriptionControls: Socket.IO não encontrado na janela. A sincronização pode não funcionar.');
      } else {
        console.log(`TranscriptionControls: Socket.IO disponível (ID: ${socket.id || 'não conectado'})`);
        
        // Garantir que o socket esteja na sala correta
        if (sessionId && socket.connected) {
          console.log(`TranscriptionControls: Entrando na sala: ${sessionId}`);
          socket.emit('join-session', { sessionId });
        }
      }
    }
  }, [syncRecording, sessionId]);

  return (
    <div className="transcription-controls">
      {/* MicButton com sessionId explícito para garantir sincronização */}
      <MicButton 
        onStart={handleRecordingStart} 
        onStop={handleRecordingStop} 
        disabled={disabled || isProcessing}
        syncRecording={syncRecording}
        sessionId={sessionId}
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