const OpenAI = require('openai');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const FormData = require('form-data');
const { IncomingMessage } = require('http');

// Configurar cliente OpenAI
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
//   timeout: 60000, // Aumentado para 60 segundos
//   maxRetries: 3
// });

// Mock do cliente OpenAI para evitar chamadas reais
const openai = {
  chat: {
    completions: {
      create: async (options) => {
        console.log('MOCK: OpenAI API chamada simulada');
        return {
          choices: [
            {
              message: {
                content: "Esta é uma resposta simulada da API OpenAI para fins de teste. A API real está desabilitada temporariamente."
              }
            }
          ]
        };
      }
    }
  }
};

/**
 * Serviço para interações com a API da OpenAI
 */
class OpenAIService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    
    // Alterado para sempre exibir mensagem de teste
    console.log('OpenAI API em modo SIMULAÇÃO - sem chamadas reais à API');
  }
  
  /**
   * Chama a API do Whisper para transcrição de áudio
   * @param {FormData} formData - FormData contendo o arquivo e parâmetros
   * @returns {Promise<Object>} - Resultado da transcrição
   */
  async callWhisperAPI(formData) {
    console.log('MOCK: Simulando chamada à API Whisper...');
    
    // Simulação de resposta sem chamar a API real
    return {
      text: "Esta é uma transcrição simulada para fins de teste. A API Whisper real está desabilitada temporariamente."
    };
    
    // Código original comentado abaixo
    /*
    console.log('Iniciando chamada à API Whisper...');
    
    // Verificar API key
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY não configurada');
    } else {
      console.log('OPENAI_API_KEY configurada corretamente');
    }
    
    try {
      // Configurar headers
      const headers = {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      };
      
      console.log('Preparando para enviar requisição para API Whisper...');
      
      // Verificar se o formData está válido
      if (!formData || typeof formData.getHeaders !== 'function') {
        console.error('FormData inválido ou não inicializado corretamente');
        throw new Error('FormData inválido para a requisição');
      }
      
      // DEBUG: Verificar arquivo diretamente sem iterar pelo FormData (que não é compatível com entries() em Node.js)
      // Tentar abrir o arquivo de áudio para verificação
      try {
        // Muitos FormData implementations no Node.js não suportam entries()
        // Verificar arquivo diretamente se possível através do caminho conhecido
        if (formData._streams && Array.isArray(formData._streams)) {
          // Procurar caminhos de arquivo nos streams do FormData (método alternativo)
          const streamData = formData._streams.join('');
          const filePathMatches = streamData.match(/path":"([^"]+)"/g);
          
          if (filePathMatches && filePathMatches.length > 0) {
            // Extrair o caminho do arquivo
            const filePath = filePathMatches[0].replace(/path":"/, '').replace(/"$/, '');
            console.log(`Verificando arquivo extraído do FormData: ${filePath}`);
            
            if (fs.existsSync(filePath)) {
              const stats = fs.statSync(filePath);
              console.log(`Arquivo existe e tem tamanho: ${Math.round(stats.size/1024)}KB`);
              
              // Verificar se o arquivo tem conteúdo válido
              if (stats.size < 1024) {
                console.error('Arquivo muito pequeno, provavelmente inválido');
                throw new Error('Arquivo de áudio inválido ou vazio');
              }
            } else {
              console.error(`Arquivo não encontrado: ${filePath}`);
              // Não lançar erro aqui, tentar continuar
              console.warn('Prosseguindo mesmo com verificação de arquivo falha');
            }
          } else {
            console.warn('Não foi possível extrair o caminho do arquivo do FormData');
          }
        } else {
          console.warn('FormData não contém _streams na estrutura esperada');
        }
      } catch (formDataError) {
        console.error('Erro ao verificar FormData:', formDataError);
        // Continuar mesmo com erro na verificação
        console.warn('Prosseguindo mesmo com erro na verificação do arquivo');
      }
      
      // Combinar os headers do formData com os headers de autenticação
      const combinedHeaders = {
        ...headers,
        ...formData.getHeaders()
      };
      
      // Fazer a requisição
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        { 
          headers: combinedHeaders,
          maxBodyLength: Infinity, // Necessário para arquivos grandes
          maxContentLength: Infinity, // Necessário para arquivos grandes
          timeout: 60000 // Timeout de 60 segundos
        }
      );
      
      console.log(`Resposta da API recebida: status ${response.status}`);
      
      return response.data;
    } catch (error) {
      console.error('Erro na chamada à API Whisper:', error.message);
      
      // Tornar mais detalhado o erro
      if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error('Dados:', error.response.data);
        
        // Se o erro estiver relacionado ao arquivo
        if (error.response.status === 400 && 
            error.response.data && 
            error.response.data.error && 
            typeof error.response.data.error === 'string' && 
            error.response.data.error.includes('file')) {
          console.error('Erro relacionado ao arquivo de áudio');
        }
      } else if (error.request) {
        // A requisição foi feita mas não houve resposta
        console.error('Sem resposta da API:', error.request);
      }
      
      throw error;
    }
    */
  }
  
  /**
   * Chama a API Completions do OpenAI
   * @param {string} prompt - Prompt para completions
   * @param {Object} options - Opções adicionais
   * @returns {Promise<Object>} - Resultado do completions
   */
  async callCompletionsAPI(prompt, options = {}) {
    console.log('MOCK: Simulando chamada à API Completions...');
    
    // Simulação de resposta sem chamar a API real
    return "Esta é uma resposta simulada da API OpenAI para fins de teste. A API real está desabilitada temporariamente.";
    
    // Código original comentado abaixo
    /*
    try {
      // Validar chave API
      if (!this.apiKey) {
        throw new Error('OPENAI_API_KEY não configurada');
      }
      
      // Opções padrão
      const defaultOptions = {
        model: 'gpt-4',
        max_tokens: 1000,
        temperature: 0.7,
      };
      
      // Mesclar opções
      const finalOptions = {
        ...defaultOptions,
        ...options,
        messages: [{ role: 'user', content: prompt }],
      };
      
      // Chamada para a API
      const completion = await openai.chat.completions.create(finalOptions);
      
      return completion.choices[0].message.content;
    } catch (error) {
      console.error('Erro ao chamar API Completions:', error.message);
      throw error;
    }
    */
  }
  
  /**
   * Processa uma transcrição de áudio e salva no banco de dados
   * @param {string} text - Texto transcrito
   * @param {string} sessionId - ID da sessão
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} - Registro salvo
   */
  async saveTranscription(text, sessionId, userId) {
    try {
      // Verificar se a sessão existe
      const session = await prisma.session.findUnique({
        where: { id: sessionId }
      });
      
      if (!session) {
        throw new Error(`Sessão ${sessionId} não encontrada`);
      }
      
      // Criar nova transcrição
      const transcription = await prisma.transcription.create({
        data: {
          content: text,
          sessionId: sessionId,
          userId: userId,
          speaker: 'user',
          timestamp: new Date()
        }
      });
      
      return transcription;
    } catch (error) {
      console.error('Erro ao salvar transcrição:', error.message);
      throw error;
    }
  }
}

module.exports = new OpenAIService(); 