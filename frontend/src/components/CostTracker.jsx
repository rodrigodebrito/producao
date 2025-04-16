import React, { useState, useEffect } from 'react';
import costTracker from '../services/costTrackingService';
import { Box, Typography, Paper, IconButton, Tooltip, Collapse } from '@mui/material';
import { Money, Receipt, Refresh, Close, ExpandMore, ExpandLess } from '@mui/icons-material';

/**
 * Componente para exibir informações de custo da sessão atual
 */
const CostTracker = () => {
  const [costs, setCosts] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(true);
  
  // Atualizar custos periodicamente
  useEffect(() => {
    // Função para atualizar custos
    const updateCosts = () => {
      setCosts(costTracker.calculateCosts());
    };
    
    // Atualizar imediatamente
    updateCosts();
    
    // Configurar intervalo de atualização (a cada 5 segundos)
    const interval = setInterval(updateCosts, 5000);
    
    // Limpar intervalo ao desmontar
    return () => clearInterval(interval);
  }, []);
  
  // Se não houver custos, não renderizar nada
  if (!costs || !visible) return null;
  
  // Função para resetar contadores
  const handleReset = () => {
    costTracker.reset();
    setCosts(costTracker.calculateCosts());
  };
  
  // Função para exibir relatório completo
  const showFullReport = () => {
    console.log(costTracker.getFullReport());
    alert('Relatório completo exibido no console!');
  };
  
  return (
    <Paper 
      elevation={3}
      sx={{
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        width: expanded ? '350px' : '180px',
        padding: '10px',
        zIndex: 9999,
        transition: 'all 0.3s ease',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(5px)',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
      }}
    >
      {/* Cabeçalho do componente */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle2" fontWeight="bold" display="flex" alignItems="center">
          <Money fontSize="small" color="primary" sx={{ mr: 0.5 }} />
          Custo Estimado
        </Typography>
        
        <Box>
          <Tooltip title={expanded ? "Recolher" : "Expandir"}>
            <IconButton 
              size="small" 
              onClick={() => setExpanded(!expanded)}
              sx={{ padding: '4px' }}
            >
              {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Resetar contadores">
            <IconButton 
              size="small" 
              onClick={handleReset}
              sx={{ padding: '4px' }}
            >
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Fechar">
            <IconButton 
              size="small" 
              onClick={() => setVisible(false)}
              sx={{ padding: '4px' }}
            >
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      
      {/* Resumo sempre visível */}
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" color="primary" fontWeight="bold">
          ${costs.total.toFixed(4)}
        </Typography>
        
        <Typography variant="body2" color="textSecondary">
          {costs.stats.sessionDurationMinutes.toFixed(1)} min
        </Typography>
      </Box>
      
      {/* Detalhes quando expandido */}
      <Collapse in={expanded}>
        <Box mt={2} pt={1} borderTop="1px solid #eee">
          <Typography variant="caption" color="textSecondary" gutterBottom>
            Detalhamento de custos:
          </Typography>
          
          <Box display="flex" justifyContent="space-between" mb={0.5}>
            <Typography variant="body2">Transcrição:</Typography>
            <Typography variant="body2" fontWeight="medium">${costs.whisper.toFixed(4)}</Typography>
          </Box>
          
          <Box display="flex" justifyContent="space-between" mb={0.5}>
            <Typography variant="body2">IA (entrada):</Typography>
            <Typography variant="body2" fontWeight="medium">${costs.gptInput.toFixed(4)}</Typography>
          </Box>
          
          <Box display="flex" justifyContent="space-between" mb={0.5}>
            <Typography variant="body2">IA (saída):</Typography>
            <Typography variant="body2" fontWeight="medium">${costs.gptOutput.toFixed(4)}</Typography>
          </Box>
          
          <Box display="flex" justifyContent="space-between" mb={0.5}>
            <Typography variant="body2">Embeddings:</Typography>
            <Typography variant="body2" fontWeight="medium">${costs.embedding.toFixed(4)}</Typography>
          </Box>
          
          <Box mt={1} pt={1} borderTop="1px solid #eee">
            <Typography variant="caption" color="textSecondary" gutterBottom>
              Utilização:
            </Typography>
            
            <Box display="flex" justifyContent="space-between" mb={0.5}>
              <Typography variant="body2">Áudio:</Typography>
              <Typography variant="body2">{costs.stats.audioMinutes.toFixed(2)} min</Typography>
            </Box>
            
            <Box display="flex" justifyContent="space-between" mb={0.5}>
              <Typography variant="body2">Tokens entrada:</Typography>
              <Typography variant="body2">{(costs.stats.tokensInput / 1000).toFixed(2)}K</Typography>
            </Box>
            
            <Box display="flex" justifyContent="space-between">
              <Typography variant="body2">Tokens saída:</Typography>
              <Typography variant="body2">{(costs.stats.tokensOutput / 1000).toFixed(2)}K</Typography>
            </Box>
          </Box>
          
          <Box mt={1} textAlign="center">
            <Tooltip title="Ver relatório completo no console">
              <IconButton 
                size="small" 
                onClick={showFullReport}
                sx={{ padding: '4px' }}
              >
                <Receipt fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
};

export default CostTracker; 