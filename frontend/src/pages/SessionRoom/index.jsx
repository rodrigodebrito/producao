import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import VideoArea from './VideoArea';
import ToolsMenu from './ToolsMenu';
import ActiveTools from './ActiveTools';
import AIAssistant from '../../components/AIAssistant';
import SessionTranscript from '../../components/SessionTranscript';
import SessionReport from '../../components/SessionReport';
import CostTracker from '../../components/CostTracker';
import { SessionProvider } from '../../contexts/SessionContext';
import { AIProvider } from '../../contexts/AIContext';
import { useAuth } from '../../contexts/AuthContext';
import '../SessionRoom.css';

const SessionRoom = () => {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const [activeTool, setActiveTool] = useState(null);
  const [isFieldActive, setIsFieldActive] = useState(false);
  const [isVideoFloating, setIsVideoFloating] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const tools = [
    {
      id: 'constellation',
      name: 'Campo de Constelação',
      icon: '🌟'
    },
    {
      id: 'ai',
      name: 'Assistente IA',
      icon: '🤖'
    },
    {
      id: 'transcript',
      name: 'Transcrição',
      icon: '📝'
    }
  ];

  // Função para alternar a ferramenta ativa
  const handleToolClick = (toolId) => {
    // Se já está ativo, desative
    if (activeTool === toolId) {
      setActiveTool(null);
      
      // Se estamos desativando o campo, restaure o vídeo
      if (toolId === 'constellation') {
        setIsFieldActive(false);
        setIsVideoFloating(false);
      }
      return;
    }
    
    // Ativando uma ferramenta
    setActiveTool(toolId);
    
    // Se estamos ativando o campo, transforme o vídeo em flutuante
    if (toolId === 'constellation') {
      setIsFieldActive(true);
      setIsVideoFloating(true);
    } else {
      // Para outras ferramentas, volte ao normal
      setIsFieldActive(false);
      setIsVideoFloating(false);
    }
  };

  // Verifica se o usuário é terapeuta
  const isTherapist = user?.role === 'THERAPIST';

  return (
    <SessionProvider sessionId={sessionId}>
      <AIProvider>
        <div className="session-room">
          <VideoArea isFloating={isVideoFloating} />
          
          <ToolsMenu 
            tools={tools} 
            activeTool={activeTool} 
            onToolClick={handleToolClick} 
          />
          
          <div className="tools-container">
            {activeTool === 'constellation' && (
              <ActiveTools 
                activeTool={activeTool} 
                isFieldActive={isFieldActive} 
              />
            )}
            
            {activeTool === 'transcript' && (
              <div className="transcript-container">
                <SessionTranscript 
                  sessionId={sessionId}
                  isTherapist={isTherapist}
                  onGenerateReport={() => setShowReport(true)}
                />
              </div>
            )}
          </div>

          {/* Assistente IA (apenas para terapeutas) */}
          {isTherapist && activeTool === 'ai' && (
            <AIAssistant 
              sessionId={sessionId}
              isTherapist={true}
            />
          )}

          {/* Modal do Relatório */}
          <SessionReport
            sessionId={sessionId}
            open={showReport}
            onClose={() => setShowReport(false)}
          />
          
          {/* Rastreador de custos */}
          <CostTracker />
        </div>
      </AIProvider>
    </SessionProvider>
  );
};

export default SessionRoom; 