// const OpenAI = require('openai');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const FormData = require('form-data');
const { IncomingMessage } = require('http');

// Removida completamente a inicialização do OpenAI
// Sem simulação/mock nenhum

/**
 * Serviço para interações com a API da OpenAI
 */
class OpenAIService {
  constructor() {
    console.log('OpenAI API está completamente desabilitada');
  }
  
  /**
   * Versão desabilitada da API Whisper para transcrição de áudio
   * @returns {Promise<Object>} - Resultado fixo
   */
  async callWhisperAPI() {
    console.log('OpenAI API está completamente desativada - retornando resposta fixa para callWhisperAPI');
    return {
      text: "Transcrição desativada. OpenAI API não está disponível."
    };
  }
  
  /**
   * Versão desabilitada da API Completions
   * @returns {Promise<String>} - Resultado fixo
   */
  async callCompletionsAPI() {
    console.log('OpenAI API está completamente desativada - retornando resposta fixa para callCompletionsAPI');
    return "OpenAI API está desabilitada.";
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