import React, { useState, useRef } from 'react';
import MicButton from './MicButton';
import './AIComponents.css';
import { aiService } from '../services/aiService';
import systemAudioCaptureService from '../services/systemAudioCapture.service';

/**
 * Componente que renderiza os controles de transcrição
 * 
 * @param {string} sessionId - ID da sessão
 * @param {function} onTranscriptionComplete - Função para completar a transcrição
 * @param {boolean} disabled - Se o componente está desabilitado
 * @param {string} captureMode - Modo de captura: 'mic' (padrão) ou 'system'
 */
const TranscriptionControls = ({ 
  sessionId, 
  onTranscriptionComplete, 
  disabled,
  captureMode = 'mic' 
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(captureMode);
  const systemCaptureRef = useRef(null);

  // Alternar entre os modos de captura
  const toggleCaptureMode = () => {
    const newMode = mode === 'mic' ? 'system' : 'mic';
    setMode(newMode);
    console.log(`Modo de captura alterado para: ${newMode}`);
  };

  const handleRecordingStart = async () => {
    try {
      setError(null);
      
      // Verificar o modo de captura
      if (mode === 'system') {
        // Iniciar captura de áudio do sistema
        const success = await systemAudioCaptureService.startCapture();
        if (!success) {
          throw new Error('Falha ao iniciar captura de áudio do sistema');
        }
        systemCaptureRef.current = systemAudioCaptureService;
      }
      
      setIsRecording(true);
    } catch (err) {
      console.error('Erro ao iniciar gravação:', err);
      setError(`Erro ao iniciar gravação: ${err.message}`);
    }
  };

  const handleRecordingStop = async (audioBlob) => {
    try {
      setIsRecording(false);
      setIsProcessing(true);
      
      // Se estiver no modo de sistema, obter o blob do serviço
      let blobToSend = audioBlob;
      
      if (mode === 'system' && systemCaptureRef.current) {
        blobToSend = await systemAudioCaptureService.stopCapture();
        if (!blobToSend) {
          throw new Error('Nenhum áudio capturado do sistema');
        }
      }
      
      // Create a FormData object to send the audio file
      const formData = new FormData();
      formData.append('audio', blobToSend, 'recording.webm');
      formData.append('sessionId', sessionId);
      formData.append('captureMode', mode);
      
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
      <div className="capture-mode-container">
        <button 
          onClick={toggleCaptureMode}
          className={`capture-mode-button ${disabled || isRecording ? 'disabled' : ''}`}
          disabled={disabled || isRecording}
        >
          {mode === 'mic' ? '🎙️ Microfone' : '🔊 Áudio do Sistema'}
        </button>
      </div>
      
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
      
      <div className="transcription-status">
        {isRecording ? (
          <span className="recording-status">
            {mode === 'system' ? 'Gravando áudio do sistema...' : 'Gravando microfone...'}
          </span>
        ) : (
          <span className="ready-status">
            {mode === 'system' 
              ? 'Clique no microfone para gravar o áudio do sistema' 
              : 'Clique no microfone para gravar'}
          </span>
        )}
      </div>
    </div>
  );
};

export default TranscriptionControls; 