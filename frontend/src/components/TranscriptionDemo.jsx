import React, { useState } from 'react';
import TranscriptionControls from './TranscriptionControls';
import './AIComponents.css';

/**
 * Componente de demonstração do recurso de transcrição de áudio
 */
const TranscriptionDemo = () => {
  const [transcript, setTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState(`demo-${Date.now()}`);

  const handleTranscriptionComplete = (newTranscript) => {
    setTranscript(prev => {
      const updatedText = prev ? `${prev}\n\n${newTranscript}` : newTranscript;
      return updatedText;
    });
  };

  return (
    <div className="transcription-demo">
      <h2>Demonstração de Transcrição de Áudio</h2>
      
      <div className="demo-section">
        <h3>Controles</h3>
        <TranscriptionControls 
          sessionId={sessionId}
          onTranscriptionComplete={handleTranscriptionComplete}
          disabled={false}
        />
      </div>
      
      <div className="demo-section">
        <h3>Resultado da Transcrição</h3>
        <div className="transcript-result">
          {transcript ? (
            <pre>{transcript}</pre>
          ) : (
            <p className="no-transcript">Grave um áudio para ver o resultado da transcrição aqui.</p>
          )}
        </div>
      </div>
      
      <div className="demo-section">
        <h3>Instruções</h3>
        <ol className="instructions-list">
          <li>Clique no botão do microfone para iniciar a gravação</li>
          <li>Fale claramente próximo ao microfone</li>
          <li>Clique novamente para encerrar a gravação</li>
          <li>Aguarde enquanto o áudio é processado</li>
          <li>O texto transcrito aparecerá na seção de resultado</li>
        </ol>
      </div>
    </div>
  );
};

export default TranscriptionDemo; 