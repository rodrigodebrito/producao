import React, { useState, useEffect, useRef, useMemo } from 'react';
import MicButton from './MicButton';
import './AIComponents.css';
import { aiService } from '../services/aiService';

/**
 * Componente que renderiza os controles de transcrição
 * 
 * @param {string} sessionId - ID da sessão
 * @param {function} onTranscriptionComplete - Função para completar a transcrição
 * @param {boolean} disabled - Se o componente está desabilitado
 */
const TranscriptionControls = ({ sessionId, onTranscriptionComplete, disabled }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  const handleRecordingStart = () => {
    setError(null);
  };

  const handleRecordingStop = async (audioBlob) => {
    try {
      if (!audioBlob) {
        console.error('Erro: audioBlob é undefined ou null');
        setError('Erro ao processar áudio: Nenhum áudio foi capturado');
        return;
      }
      
      setIsProcessing(true);
      
      // Create a FormData object to send the audio file
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('sessionId', sessionId);
      
      // Send the audio to the server for transcription
      const response = await aiService.transcribeAudio(formData);
      
      if (response && response.transcript) {
        // Call the callback with the transcription result
        if (onTranscriptionComplete) {
          onTranscriptionComplete(response.transcript);
        }
      } else {
        throw new Error('No transcript received from the server');
      }
    } catch (err) {
      console.error('Transcription error:', err);
      setError('Failed to transcribe audio. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="transcription-controls">
      {/* Usamos apenas o MicButton que já contém o seletor de modo */}
      <MicButton 
        onRecordingStart={handleRecordingStart} 
        onRecordingStop={handleRecordingStop} 
        disabled={disabled || isProcessing} 
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