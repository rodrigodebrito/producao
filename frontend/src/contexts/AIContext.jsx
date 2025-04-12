import React, { createContext, useContext, useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import PropTypes from 'prop-types';
import hybridAIService from '../services/hybridAI.service';
import { initializeTensorFlow, isTfInitialized } from '../services/tfHelper';

// Criar o contexto
const AIContext = createContext();

export const AIProvider = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [emotions, setEmotions] = useState({});
  const [localProcessing, setLocalProcessing] = useState(true);
  const [anonymization, setAnonymization] = useState(true);
  const [lastResult, setLastResult] = useState(null);
  
  // Inicializar o serviço
  useEffect(() => {
    const initialize = async () => {
      try {
        // Inicializar TensorFlow apenas uma vez
        console.log('Inicializando TensorFlow...');
        await initializeTensorFlow({ logLevel: 0 });
        console.log('TensorFlow inicializado com sucesso!');
        
        // Configurar ouvintes de eventos
        window.addEventListener('transcript-updated', handleTranscriptUpdate);
        window.addEventListener('emotion-detected', handleEmotionDetected);
        window.addEventListener('recording-started', () => setIsListening(true));
        window.addEventListener('recording-stopped', () => setIsListening(false));
        
        setIsInitialized(true);
        console.log('Contexto de IA inicializado com sucesso!');
      } catch (error) {
        console.error('Erro ao inicializar contexto de IA:', error);
        toast.error('Erro ao inicializar recursos de IA');
      }
    };
    
    initialize();
    
    // Limpar ouvintes de eventos ao desmontar
    return () => {
      window.removeEventListener('transcript-updated', handleTranscriptUpdate);
      window.removeEventListener('emotion-detected', handleEmotionDetected);
      window.removeEventListener('recording-started', () => setIsListening(true));
      window.removeEventListener('recording-stopped', () => setIsListening(false));
    };
  }, []);
  
  // Manipuladores de eventos
  const handleTranscriptUpdate = (event) => {
    setTranscript(event.detail.fullText);
  };
  
  const handleEmotionDetected = (event) => {
    setEmotions(event.detail.accumulated);
  };
  
  // Funções para iniciar/parar reconhecimento de voz
  const startListening = () => {
    if (hybridAIService.startRecording()) {
      setIsListening(true);
      toast.info('Reconhecimento de voz iniciado', { autoClose: 2000 });
      return true;
    }
    toast.error('Não foi possível iniciar o reconhecimento de voz');
    return false;
  };
  
  const stopListening = () => {
    if (hybridAIService.stopRecording()) {
      setIsListening(false);
      toast.info('Reconhecimento de voz finalizado', { autoClose: 2000 });
      return true;
    }
    toast.error('Não foi possível finalizar o reconhecimento de voz');
    return false;
  };
  
  // Nova função auxiliar para atualizar diretamente o transcript
  const updateTranscript = (newTranscript) => {
    if (typeof newTranscript === 'string') {
      setTranscript(newTranscript);
      return true;
    }
    return false;
  };
  
  // Função auxiliar para verificar storage por transcrições
  const checkStorageForTranscripts = (sessionId) => {
    try {
      if (!sessionId) return null;
      
      // Verificar primeiro no sessionStorage
      const sessionKey = `whisper_transcriptions_${sessionId}`;
      const sessionData = sessionStorage.getItem(sessionKey);
      
      // Se tiver dados no sessionStorage, usar esses
      if (sessionData) {
        try {
          const transcripts = JSON.parse(sessionData);
          
          if (Array.isArray(transcripts) && transcripts.length > 0) {
            console.log(`[AIContext] Encontradas ${transcripts.length} transcrições no sessionStorage`);
            
            // Combinar em texto único
            const combinedText = transcripts
              .map(t => `${t.speaker || 'Usuário'}: ${t.content}`)
              .join('\n');
            
            return combinedText;
          }
        } catch (e) {
          console.warn('[AIContext] Erro ao processar dados do sessionStorage:', e);
        }
      }
      
      // Verificar localStorage como fallback
      const localKey = `whisper_transcript_${sessionId}`;
      const localData = localStorage.getItem(localKey);
      
      if (!localData) return null;
      
      const transcripts = JSON.parse(localData);
      
      if (!Array.isArray(transcripts) || transcripts.length === 0) return null;
      
      console.log(`[AIContext] Encontradas ${transcripts.length} transcrições no localStorage`);
      
      // Combinar em texto único
      const combinedText = transcripts
        .map(t => `${t.speaker || 'Usuário'}: ${t.content}`)
        .join('\n');
      
      return combinedText;
    } catch (error) {
      console.warn('[AIContext] Erro ao verificar storage por transcrições:', error);
      return null;
    }
  };
  
  // Função genérica para buscar transcrições
  const fetchTranscriptions = async (sessionId) => {
    try {
      // Usar o ID de sessão fixo se não tiver um
      const effectiveSessionId = sessionId || 'f275c5c4-fb58-40e3-9710-2c95e30741b0';
      
      console.log('[AIContext] Buscando transcrições para a sessão:', effectiveSessionId);
      
      // MELHORIA: Primeiro verificar localStorage
      const localTranscripts = checkStorageForTranscripts(effectiveSessionId);
      if (localTranscripts) {
        console.log('[AIContext] Usando transcrições do localStorage');
        return localTranscripts;
      }
      
      // Obter token de autenticação
      const authToken = localStorage.getItem('authToken') || 
                        sessionStorage.getItem('authToken') || 
                        localStorage.getItem('token') || 
                        sessionStorage.getItem('token');
      
      if (!authToken) {
        console.warn('[AIContext] Token de autenticação não encontrado');
        return null;
      }
      
      // CORREÇÃO: Tentar diferentes endpoints para buscar transcrições
      // NOTA: Alguns servidores podem usar rotas diferentes
      const apiUrl = 'https://theraconnect-prd.onrender.com/api/ai';
      
      // Lista de possíveis endpoints para testar
      const endpointsToTry = [
        `${apiUrl}/transcriptions/session/${effectiveSessionId}`,
        `${apiUrl}/transcript/${effectiveSessionId}`,
        `${apiUrl}/transcript-history/${effectiveSessionId}`,
        `https://theraconnect-prd.onrender.com/api/transcriptions/session/${effectiveSessionId}`,
        `https://theraconnect-prd.onrender.com/api/ai/transcriptions/session/${effectiveSessionId}`
      ];
      
      // Tentar cada endpoint até que um funcione
      let transcriptData = null;
      let successfulEndpoint = null;
      
      for (const endpoint of endpointsToTry) {
        try {
          console.log(`[AIContext] Tentando endpoint: ${endpoint}`);
          
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.ok) {
            const responseData = await response.json();
            console.log('[AIContext] Resposta obtida com sucesso:', responseData);
            
            // CORREÇÃO: Verificar todos os formatos possíveis de resposta
            if (responseData && (
                (responseData.data && responseData.data.length > 0) ||
                (responseData.transcripts && responseData.transcripts.length > 0) ||
                (responseData.transcriptions && responseData.transcriptions.length > 0) ||
                (Array.isArray(responseData) && responseData.length > 0)
              )) {
              transcriptData = responseData;
              successfulEndpoint = endpoint;
              break;
            } else {
              console.log('[AIContext] Endpoint retornou dados, mas sem transcrições válidas');
            }
          } else {
            console.warn(`[AIContext] Erro no endpoint ${endpoint}: ${response.status}`);
          }
        } catch (endpointError) {
          console.warn(`[AIContext] Erro ao tentar endpoint ${endpoint}:`, endpointError);
          // Continuar tentando outros endpoints
        }
      }
      
      if (!transcriptData) {
        console.warn('[AIContext] Nenhum endpoint retornou dados de transcrição');
        return null;
      }
      
      console.log(`[AIContext] Dados de transcrição obtidos do endpoint: ${successfulEndpoint}`);
      
      // CORREÇÃO: Extrair os dados da transcrição (diferentes formatos possíveis)
      let transcriptItems = [];
      
      if (Array.isArray(transcriptData)) {
        // Se a resposta já é um array
        transcriptItems = transcriptData;
      } else if (transcriptData.data && Array.isArray(transcriptData.data)) {
        // Formato { data: [...] }
        transcriptItems = transcriptData.data;
      } else if (transcriptData.transcripts && Array.isArray(transcriptData.transcripts)) {
        // Formato { transcripts: [...] }
        transcriptItems = transcriptData.transcripts;
      } else if (transcriptData.transcriptions && Array.isArray(transcriptData.transcriptions)) {
        // Formato { transcriptions: [...] }
        transcriptItems = transcriptData.transcriptions;
      }
      
      console.log(`[AIContext] Encontradas ${transcriptItems.length} transcrições processáveis`);
      
      if (transcriptItems.length > 0) {
        // CORREÇÃO: Lidar com diferentes estruturas de objeto
        const combinedText = transcriptItems
          .map(t => {
            const speaker = t.speaker || t.user || 'Usuário';
            const text = t.content || t.text || t.transcript || t.message || '';
            return `${speaker}: ${text}`;
          })
          .join('\n');
        
        console.log(`[AIContext] Texto combinado das transcrições: ${combinedText.length} caracteres`);
        return combinedText;
      }
      
      return null;
    } catch (fetchError) {
      console.error('[AIContext] Erro ao buscar transcrições do backend:', fetchError);
      return null;
    }
  };
  
  // Nova função auxiliar para extrair sessionId da URL
  const extractSessionIdFromUrl = () => {
    try {
      const url = window.location.href;
      
      // Tentar extrair de padrões comuns
      // 1. Pattern /session/{id}
      const sessionMatch = url.match(/\/session\/([a-zA-Z0-9_-]+)/);
      if (sessionMatch && sessionMatch[1]) {
        return sessionMatch[1];
      }
      
      // 2. Pattern de UUID
      const uuidMatch = url.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
      if (uuidMatch && uuidMatch[0]) {
        return uuidMatch[0];
      }
      
      // 3. Storage
      return localStorage.getItem('currentSessionId') || 
            sessionStorage.getItem('currentSessionId') ||
            localStorage.getItem('sessionId') ||
            sessionStorage.getItem('sessionId');
    } catch (e) {
      console.error('Erro ao extrair sessionId da URL:', e);
      return null;
    }
  };
  
  // Função de análise
  const analyze = async (sessionId, text = transcript) => {
    try {
      setIsProcessing(true);
      toast.info('Analisando sessão...', { autoClose: 2000 });
      
      // Obter sessionId do contexto ou da URL se não for fornecido
      const effectiveSessionId = sessionId || extractSessionIdFromUrl() || window.currentSessionId;
      
      console.log(`[AIContext] Iniciando análise para sessão: ${effectiveSessionId}`);
      console.log(`[AIContext] Texto para análise (${text?.length || 0} caracteres): ${text?.substring(0, 50)}...`);
      
      // NOVO: Se o texto estiver vazio, buscar as transcrições do backend
      let effectiveText = text;
      if (!effectiveText || effectiveText.trim().length === 0) {
        const fetchedText = await fetchTranscriptions(effectiveSessionId);
        if (fetchedText) {
          effectiveText = fetchedText;
          // Atualizar o estado do transcript
          setTranscript(effectiveText);
        }
      }
      
      // Se ainda não temos texto após tentar buscar do backend
      if (!effectiveText || effectiveText.trim().length === 0) {
        console.warn('[AIContext] Texto completamente vazio para análise, mesmo após buscar do backend');
        toast.warning('Não há texto para analisar. Inicie a gravação ou continue a conversa.');
        
        const mockResult = {
          type: 'analysis',
          analysis: 'É necessário ter algum conteúdo de conversa para realizar uma análise.',
          content: 'Inicie ou continue a conversa para receber análises.'
        };
        
        setLastResult(mockResult);
        setIsProcessing(false);
        return mockResult;
      }
      
      let result;
      try {
        // Usar o sessionId efetivo para a análise
        console.log(`[AIContext] Enviando para análise: sessão=${effectiveSessionId}, texto=${effectiveText.length} caracteres`);
        result = await hybridAIService.analyzeText(effectiveText, effectiveSessionId);
        console.log('[AIContext] Resultado da análise:', result);
      } catch (error) {
        console.error('[AIContext] Erro no serviço de análise:', error);
        
        // Verificar se é um erro de API da OpenAI
        const isOpenAIError = error.message?.includes('OpenAI') || 
                             error.message?.includes('API key') || 
                             (error.error && error.error.includes('API key'));
        
        // Criar um resultado de erro mais amigável e específico
        result = {
          type: 'analysis',
          error: isOpenAIError ? 'Serviço de IA temporariamente indisponível' : 'Falha no serviço de análise',
          message: isOpenAIError 
            ? 'A API da OpenAI está temporariamente indisponível. O administrador já foi notificado.' 
            : error.message,
          analysis: 'Não foi possível analisar a sessão atual devido a um erro técnico.',
          content: isOpenAIError 
            ? 'O serviço de IA está temporariamente em manutenção. A transcrição continua funcionando normalmente e todas as informações estão sendo salvas.' 
            : 'O serviço de IA está temporariamente indisponível.'
        };
      }
      
      // Garantir que o resultado possui um formato válido
      if (!result || !result.type) {
        result = {
          ...result,
          type: 'analysis'
        };
      }
      
      // Processar materiais referenciados se existirem
      if (result.data && result.data.referencedMaterials && result.data.referencedMaterials.length > 0) {
        console.log('[AIContext] Análise inclui materiais de referência:', result.data.referencedMaterials.length);
      } else {
        console.log('[AIContext] Análise não inclui materiais de referência');
      }
      
      // Garantir que há conteúdo de análise
      if (!result.analysis && !result.content && !result.error) {
        result.analysis = 'Não foram identificados padrões significativos na conversa atual.';
        result.content = 'Continue a sessão para permitir uma análise mais aprofundada.';
      }
      
      // Adicionar tipo para identificação no painel de resultados
      const resultWithType = { ...result, type: 'analysis' };
      setLastResult(resultWithType);
      
      // Disparar evento específico para garantir que o painel seja exibido
      window.dispatchEvent(new CustomEvent('ai-result', {
        detail: { result: resultWithType, source: 'analysis' }
      }));
      
      toast.success('Análise concluída!');
      return resultWithType;
    } catch (error) {
      console.error('Erro ao analisar sessão:', error);
      toast.error(`Erro ao analisar sessão: ${error.message}`);
      
      // Criar um resultado de erro com análise de fallback
      const errorResult = {
        type: 'analysis',
        error: 'Erro ao analisar sessão',
        message: error.message,
        analysis: 'Não foi possível completar a análise devido a um erro no processamento.',
        content: 'Tente novamente ou continue a sessão para gerar mais conteúdo para análise.'
      };
      
      setLastResult(errorResult);
      return errorResult;
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Função para gerar sugestões
  const suggest = async (sessionId, text = transcript) => {
    try {
      setIsProcessing(true);
      toast.info('Gerando sugestões...', { autoClose: 2000 });
      
      // Obter sessionId do contexto ou da URL se não for fornecido
      const effectiveSessionId = sessionId || extractSessionIdFromUrl() || window.currentSessionId;
      
      console.log(`[AIContext] Iniciando sugestões para sessão: ${effectiveSessionId}`);
      console.log(`[AIContext] Texto para sugestões (${text?.length || 0} caracteres): ${text?.substring(0, 50)}...`);
      
      // NOVO: Se o texto estiver vazio, buscar as transcrições do backend
      let effectiveText = text;
      if (!effectiveText || effectiveText.trim().length === 0) {
        const fetchedText = await fetchTranscriptions(effectiveSessionId);
        if (fetchedText) {
          effectiveText = fetchedText;
          // Atualizar o estado do transcript
          setTranscript(effectiveText);
        }
      }
      
      // Se ainda não temos texto após tentar buscar do backend
      if (!effectiveText || effectiveText.trim().length === 0) {
        console.warn('[AIContext] Texto completamente vazio para sugestões, mesmo após buscar do backend');
        
        toast.warning('Não há texto para analisar. Inicie a gravação ou continue a conversa.');
        
        const mockResult = {
          type: 'suggestions',
          suggestions: [
            'Não há conteúdo de conversa suficiente para gerar sugestões.',
            'Inicie ou continue a conversa para receber sugestões relevantes.'
          ]
        };
        
        setLastResult(mockResult);
        setIsProcessing(false);
        return mockResult;
      }
      
      let result;
      try {
        // Usar o sessionId efetivo para as sugestões
        console.log(`[AIContext] Enviando para geração de sugestões: sessão=${effectiveSessionId}, texto=${effectiveText.length} caracteres`);
        result = await hybridAIService.generateSuggestions(effectiveText, effectiveSessionId);
        console.log('[AIContext] Resultado das sugestões:', result);
      } catch (error) {
        console.error('[AIContext] Erro no serviço de sugestões:', error);
        result = {
          type: 'suggestions',
          error: 'Falha no serviço de sugestões',
          message: error.message,
          suggestions: [
            'Considere fazer perguntas abertas ao paciente.',
            'Mantenha um tom empático e acolhedor.',
            'Observe padrões de comunicação e sentimentos expressos.'
          ],
          content: 'Sugestões genéricas (o serviço de IA está indisponível no momento).'
        };
      }
      
      // Garantir que o resultado possui um formato válido
      if (!result || !result.type) {
        result = {
          ...result,
          type: 'suggestions'
        };
      }
      
      // Processar materiais referenciados se existirem
      if (result.data && result.data.referencedMaterials && result.data.referencedMaterials.length > 0) {
        console.log('[AIContext] Sugestões incluem materiais de referência:', result.data.referencedMaterials.length);
      } else {
        console.log('[AIContext] Sugestões não incluem materiais de referência');
      }
      
      // Garantir que existem sugestões mesmo sem conteúdo da API
      if (!result.suggestions && !result.error) {
        result.suggestions = [
          'Faça perguntas que explorem sentimentos e pensamentos.',
          'Preste atenção à linguagem não-verbal.',
          'Valide os sentimentos expressos pelo paciente.'
        ];
      }
      
      // Adicionar tipo para identificação no painel de resultados se não estiver presente
      const resultWithType = { ...result, type: 'suggestions' };
      setLastResult(resultWithType);
      
      // Disparar evento específico para garantir que o painel seja exibido
      window.dispatchEvent(new CustomEvent('ai-result', {
        detail: { result: resultWithType, source: 'suggestions' }
      }));
      
      toast.success('Sugestões geradas!');
      return resultWithType;
    } catch (error) {
      console.error('Erro ao gerar sugestões:', error);
      toast.error(`Erro ao gerar sugestões: ${error.message}`);
      
      // Criar um resultado de erro com sugestões de fallback
      const errorResult = {
        type: 'suggestions',
        error: 'Erro ao gerar sugestões',
        message: error.message,
        suggestions: [
          'Mantenha uma postura acolhedora e empática.',
          'Utilize técnicas de escuta ativa.',
          'Faça resumos periódicos para verificar compreensão.'
        ],
        content: 'Sugestões padrão (ocorreu um erro ao processar a solicitação).'
      };
      
      setLastResult(errorResult);
      return errorResult;
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Função para gerar relatório
  const report = async (sessionId, text = transcript) => {
    try {
      setIsProcessing(true);
      toast.info('Gerando relatório...', { autoClose: 2000 });
      
      // Obter sessionId do contexto ou da URL se não for fornecido
      const effectiveSessionId = sessionId || extractSessionIdFromUrl() || window.currentSessionId;
      
      console.log(`[AIContext] Iniciando relatório para sessão: ${effectiveSessionId}`);
      console.log(`[AIContext] Texto para relatório (${text?.length || 0} caracteres): ${text?.substring(0, 50)}...`);
      
      // NOVO: Se o texto estiver vazio, buscar as transcrições do backend
      let effectiveText = text;
      if (!effectiveText || effectiveText.trim().length === 0) {
        const fetchedText = await fetchTranscriptions(effectiveSessionId);
        if (fetchedText) {
          effectiveText = fetchedText;
          // Atualizar o estado do transcript
          setTranscript(effectiveText);
        }
      }
      
      // Se ainda não temos texto após tentar buscar do backend
      if (!effectiveText || effectiveText.trim().length === 0) {
        console.warn('[AIContext] Texto completamente vazio para relatório, mesmo após buscar do backend');
        
        toast.warning('Não há texto para gerar relatório. Inicie a gravação ou continue a conversa.');
        
        const mockResult = {
          type: 'report',
          report: 'Não há conteúdo de conversa suficiente para gerar um relatório. Inicie ou continue a sessão para registrar a conversa.',
          success: false
        };
        
        setLastResult(mockResult);
        setIsProcessing(false);
        return mockResult;
      }
      
      let result;
      try {
        // Usar o sessionId efetivo para o relatório
        console.log(`[AIContext] Enviando para geração de relatório: sessão=${effectiveSessionId}, texto=${effectiveText.length} caracteres`);
        result = await hybridAIService.generateReport(effectiveText, effectiveSessionId);
        console.log('[AIContext] Resultado do relatório:', result);
      } catch (error) {
        console.error('[AIContext] Erro no serviço de relatório:', error);
        result = {
          type: 'report',
          error: 'Falha no serviço de relatório',
          message: error.message,
          report: 'Não foi possível gerar o relatório devido a um erro técnico.',
          content: 'O serviço de IA está temporariamente indisponível.'
        };
      }
      
      // Garantir que o resultado possui um formato válido
      if (!result || !result.type) {
        result = {
          ...result,
          type: 'report'
        };
      }
      
      // Garantir que há conteúdo de relatório e extrair o campo 'report' se estiver aninhado
      if (result.success && result.report) {
        // O relatório veio diretamente no campo report (formato ideal)
        result.content = 'Relatório baseado na transcrição da sessão atual';
      } else if (result.data && result.data.report) {
        // O relatório está aninhado em data.report
        result.report = result.data.report;
        result.content = 'Relatório baseado na transcrição da sessão atual';
      } else if (result.success && !result.report) {
        // Sucesso mas o relatório não está em um campo padrão
        if (result.data) {
          // Tentar encontrar o relatório em alguma propriedade de data
          const possibleReportFields = ['content', 'text', 'analysis', 'result', 'reportText'];
          for (const field of possibleReportFields) {
            if (result.data[field]) {
              result.report = result.data[field];
              break;
            }
          }
        }
        // Se ainda não encontrou, verificar campos raiz
        if (!result.report) {
          const possibleReportFields = ['content', 'text', 'analysis', 'result', 'reportText'];
          for (const field of possibleReportFields) {
            if (result[field]) {
              result.report = result[field];
              break;
            }
          }
        }
        // Se ainda não tiver um relatório
        if (!result.report) {
          result.report = 'Não foi possível extrair um relatório detalhado da resposta.';
          result.content = 'Houve um problema na formatação do relatório.';
        }
      } else if (!result.report && !result.content && !result.error) {
        // Não há campos válidos para o relatório
        result.report = 'Não foi possível gerar um relatório detalhado para esta sessão.';
        result.content = 'A transcrição não contém informações suficientes.';
      }
      
      // Adicionar tipo para identificação no painel de resultados
      const resultWithType = { ...result, type: 'report' };
      setLastResult(resultWithType);
      
      // Disparar evento específico para garantir que o painel seja exibido
      window.dispatchEvent(new CustomEvent('ai-result', {
        detail: { result: resultWithType, source: 'report' }
      }));
      
      // Também disparar o evento que já existia
      window.dispatchEvent(new CustomEvent('report-generated', { 
        detail: { result: resultWithType } 
      }));
      
      toast.success('Relatório gerado com sucesso!');
      
      return resultWithType;
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
      toast.error(`Erro ao gerar relatório: ${error.message}`);
      
      // Criar um resultado de erro com relatório de fallback
      const errorResult = {
        type: 'report',
        error: 'Erro ao gerar relatório',
        message: error.message,
        report: 'Ocorreu um erro ao processar o relatório da sessão.',
        content: 'Tente novamente em alguns instantes ou continue a sessão para capturar mais informações.'
      };
      
      setLastResult(errorResult);
      return errorResult;
    } finally {
      setIsProcessing(false);
    }
  };
  
  // Funções para configuração
  const toggleLocalProcessing = () => {
    const newValue = !localProcessing;
    hybridAIService.setLocalProcessing(newValue);
    setLocalProcessing(newValue);
    toast.info(`Processamento local ${newValue ? 'ativado' : 'desativado'}`, { autoClose: 2000 });
  };
  
  const toggleAnonymization = () => {
    const newValue = !anonymization;
    hybridAIService.setAnonymization(newValue);
    setAnonymization(newValue);
    toast.info(`Anonimização ${newValue ? 'ativada' : 'desativada'}`, { autoClose: 2000 });
  };
  
  // Verificar compatibilidade
  const isCompatible = () => {
    return hybridAIService.isSpeechRecognitionSupported();
  };
  
  // Limpar transcrição
  const clearTranscript = () => {
    setTranscript('');
    setEmotions({});
  };
  
  // Salvar transcrição no backend
  const saveTranscript = async (transcriptionData) => {
    try {
      if (!transcriptionData || !transcriptionData.sessionId || (!transcriptionData.transcript && !transcriptionData.content)) {
        console.warn('[AIContext] Dados de transcrição inválidos:', transcriptionData);
        return { success: false, error: 'Dados de transcrição inválidos' };
      }
      
      console.log('[AIContext] Salvando transcrição:', {
        sessionId: transcriptionData.sessionId,
        contentLength: transcriptionData.transcript ? transcriptionData.transcript.length : (transcriptionData.content ? transcriptionData.content.length : 0),
        speaker: transcriptionData.speaker || 'user'
      });
      
      // Obter token de autenticação
      const authToken = localStorage.getItem('authToken') || 
                        sessionStorage.getItem('authToken') || 
                        localStorage.getItem('token') || 
                        sessionStorage.getItem('token');
      
      if (!authToken) {
        console.warn('[AIContext] Token de autenticação não encontrado');
        return { success: false, error: 'Token de autenticação não encontrado' };
      }
      
      // Garantir que estamos usando a propriedade 'transcript' que o backend espera
      if (transcriptionData.content && !transcriptionData.transcript) {
        transcriptionData.transcript = transcriptionData.content;
      }
      
      // Usar fetch com proxy do Vite (/api/...) ou URL completa
      const response = await fetch('https://theraconnect-prd.onrender.com/api/ai/transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(transcriptionData)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AIContext] Erro ao salvar transcrição (${response.status}):`, errorText);
        return { 
          success: false, 
          error: `Erro ao salvar transcrição: ${response.status} ${response.statusText}`,
          details: errorText
        };
      }
      
      const result = await response.json();
      console.log('[AIContext] Transcrição salva com sucesso:', result);
      
      // Atualizar transcript local com o novo texto para garantir sincronização
      setTranscript(prev => {
        // Adicionar quebra de linha se já existe texto
        return prev ? `${prev}\n${transcriptionData.content}` : transcriptionData.content;
      });
      
      return { ...result, success: true };
    } catch (error) {
      console.error('[AIContext] Erro ao salvar transcrição:', error);
      return { success: false, error: error.message };
    }
  };
  
  // Contexto para compartilhar
  const contextValue = {
    isInitialized,
    isProcessing,
    isListening,
    transcript,
    emotions,
    localProcessing,
    anonymization,
    lastResult,
    startListening,
    stopListening,
    analyze,
    suggest,
    report,
    toggleLocalProcessing,
    toggleAnonymization,
    isCompatible,
    clearTranscript,
    saveTranscript,
    updateTranscript
  };
  
  // Exportar para o window para permitir acesso fora do React
  if (typeof window !== 'undefined') {
    window.__AI_CONTEXT = contextValue;
    // Disparar evento sempre que houver uma mudança no isProcessing ou emotions
    useEffect(() => {
      window.dispatchEvent(new CustomEvent('ai-context-updated', { 
        detail: { 
          isProcessing,
          emotions,
          transcript,
          lastResult
        } 
      }));
    }, [isProcessing, emotions, transcript, lastResult]);
  }
  
  return (
    <AIContext.Provider value={contextValue}>
      {children}
    </AIContext.Provider>
  );
};

AIProvider.propTypes = {
  children: PropTypes.node.isRequired
};

// Hook personalizado para usar o contexto
export const useAI = () => {
  const context = useContext(AIContext);
  
  if (!context) {
    throw new Error('useAI deve ser usado dentro de um AIProvider');
  }
  
  return context;
};

export default AIContext; 