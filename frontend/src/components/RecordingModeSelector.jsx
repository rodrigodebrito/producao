import React from 'react';
import './RecordingModeSelector.css';

/**
 * Componente para selecionar o modo de gravação
 * @param {Object} props Component props
 * @param {string} props.selectedMode Modo selecionado ('webspeech', 'webrtc', 'daily')
 * @param {Function} props.onModeChange Função para tratar mudança de modo
 * @param {boolean} props.disabled Se o seletor está desabilitado
 */
const RecordingModeSelector = ({ selectedMode, onModeChange, disabled = false }) => {
  const handleModeChange = (e) => {
    if (onModeChange) {
      onModeChange(e.target.value);
    }
  };

  return (
    <div className="recording-mode-selector">
      <label htmlFor="recording-mode">Modo de Transcrição:</label>
      <select 
        id="recording-mode" 
        value={selectedMode} 
        onChange={handleModeChange}
        disabled={disabled}
        className="recording-mode-select"
      >
        <option value="webspeech">Browser (Tempo real)</option>
        <option value="webrtc">WebRTC (Conversa completa)</option>
        <option value="daily">Daily (Legado)</option>
      </select>
    </div>
  );
};

export default RecordingModeSelector; 