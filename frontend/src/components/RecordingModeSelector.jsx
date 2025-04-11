import React from 'react';
import './MicButton.css';

/**
 * Componente para seleção do modo de gravação de áudio
 * @param {Object} props Propriedades do componente
 * @param {string} props.mode Modo de gravação atual
 * @param {Function} props.onChange Função chamada quando o modo é alterado
 * @param {boolean} props.disabled Se o seletor está desabilitado
 */
const RecordingModeSelector = ({ mode, onChange, disabled = false }) => {
  const handleChange = (e) => {
    if (onChange) {
      onChange(e.target.value);
    }
  };
  
  return (
    <div className="mic-mode-selector">
      <div className="mic-mode-title">Modo de Gravação:</div>
      
      <label className="mic-mode-option">
        <input
          type="radio"
          name="recording-mode"
          value="webspeech"
          checked={mode === 'webspeech'}
          onChange={handleChange}
          disabled={disabled}
        />
        <span className="mode-indicator mode-webspeech"></span>
        Microfone Local (Web Speech API)
      </label>
      
      <label className="mic-mode-option">
        <input
          type="radio"
          name="recording-mode"
          value="webrtc"
          checked={mode === 'webrtc'}
          onChange={handleChange}
          disabled={disabled}
        />
        <span className="mode-indicator mode-webrtc"></span>
        Conversa Completa (WebRTC)
      </label>
      
      <label className="mic-mode-option">
        <input
          type="radio"
          name="recording-mode"
          value="daily"
          checked={mode === 'daily'}
          onChange={handleChange}
          disabled={disabled}
        />
        <span className="mode-indicator mode-daily"></span>
        Chamada (Daily)
      </label>
    </div>
  );
};

export default RecordingModeSelector; 