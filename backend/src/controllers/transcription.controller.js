const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const openaiService = require('../services/ai/openai.service');
const trainingService = require('../services/ai/training.service');
const { createLogger } = require('../utils/logger');
const logger = createLogger('transcription-controller');

const prisma = new PrismaClient();

/**
 * Controlador para gerenciar transcrições de áudio/vídeo usando OpenAI Whisper API
 */
const transcriptionController = {
  /**
   * Inicia o processo de transcrição de um arquivo de áudio/vídeo
   */
  transcribeMedia: async (req, res) => {
    try {
      // Verificar se um arquivo foi enviado
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo foi enviado.' });
      }

      // Verificar o tamanho do arquivo (limite de 25 MB para a API do OpenAI Whisper)
      const maxSizeBytes = 25 * 1024 * 1024; // 25 MB
      const fileStats = fs.statSync(req.file.path);
      
      if (fileStats.size > maxSizeBytes) {
        // Remover o arquivo que excede o limite
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ 
          error: `O arquivo excede o limite de tamanho de 25 MB. Tamanho atual: ${(fileStats.size / (1024 * 1024)).toFixed(2)} MB.`,
          suggestedAction: 'Compacte o arquivo ou divida-o em partes menores.'
        });
      }

      // Obtém dados do formulário
      const { title, language = 'pt' } = req.body;
      
      // Corrigir manipulação de categorias para evitar undefined
      let categories = [];
      if (req.body.categories) {
        categories = req.body.categories;
      } else if (req.body['categories[]']) {
        categories = Array.isArray(req.body['categories[]']) 
          ? req.body['categories[]'].filter(cat => cat !== undefined && cat !== null && cat !== '')
          : [req.body['categories[]']].filter(cat => cat !== undefined && cat !== null && cat !== '');
      }

      // Verificar dados obrigatórios
      if (!title || !categories || categories.length === 0) {
        // Remover o arquivo carregado para não ocupar espaço desnecessariamente
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ 
          error: 'Dados incompletos. Título e categorias são obrigatórios.' 
        });
      }

      // Obter ID do usuário atual ou usar um ID padrão para desenvolvimento
      const userId = req.user && req.user.id ? req.user.id : "34b5320d-d285-4dd8-a9ad-96308f664169";
      
      // Criar um registro de material no banco de dados para rastreamento
      const material = await prisma.trainingMaterial.create({
        data: {
          title,
          content: 'Em processamento...',
          type: 'VIDEO_TRANSCRIPTION',
          status: 'processing',
          categories: categories.filter(Boolean), // Garantir que não há valores falsy
          userId: userId,
          isVideoTranscription: true
        }
      });

      // Iniciar o processo de transcrição em segundo plano
      // Nota: não aguardamos o resultado para responder mais rapidamente
      processTranscription(req.file.path, material.id, language)
        .then(() => {
          logger.info(`Transcrição concluída para o material ID: ${material.id}`);
        })
        .catch(error => {
          logger.error(`Erro na transcrição do material ID: ${material.id}`, error);
          // Atualizar o status para erro no caso de falha
          updateTranscriptionStatus(material.id, 'error', 'Erro durante a transcrição.');
        });
      
      // Responder imediatamente com o ID do material criado
      return res.status(202).json({
        id: material.id,
        message: 'Transcrição iniciada com sucesso!',
        status: 'processing'
      });
    } catch (error) {
      logger.error('Erro ao iniciar transcrição:', error);
      
      // Se houver um arquivo carregado, tentar removê-lo em caso de erro
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Erro ao remover arquivo temporário:', unlinkError);
        }
      }
      
      return res.status(500).json({ 
        error: 'Erro ao processar a transcrição.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  /**
   * Obtém o status atual de uma transcrição
   */
  getTranscriptionStatus: async (req, res) => {
    try {
      const { id } = req.params;

      // Buscar material no banco de dados
      const material = await prisma.trainingMaterial.findUnique({
        where: { id }
      });

      if (!material) {
        return res.status(404).json({ error: 'Transcrição não encontrada.' });
      }

      // Verificar se o usuário tem permissão para acessar este material
      const userId = req.user && req.user.id ? req.user.id : null;
      const isAdmin = req.user && req.user.role === 'ADMIN';
      if (!isAdmin && userId && material.userId !== userId) {
        return res.status(403).json({ error: 'Você não tem permissão para acessar esta transcrição.' });
      }

      return res.status(200).json({
        id: material.id,
        status: material.status,
        isComplete: ['processed', 'error'].includes(material.status),
        hasError: material.status === 'error',
        contentLength: material.content ? material.content.length : 0,
        lastUpdated: material.updatedAt
      });
    } catch (error) {
      logger.error('Erro ao buscar status de transcrição:', error);
      
      return res.status(500).json({ 
        error: 'Erro ao verificar o status da transcrição.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  /**
   * Obtém o resultado completo de uma transcrição
   */
  getTranscription: async (req, res) => {
    try {
      const { id } = req.params;

      // Buscar material no banco de dados
      const material = await prisma.trainingMaterial.findUnique({
        where: { id }
      });

      if (!material) {
        return res.status(404).json({ error: 'Transcrição não encontrada.' });
      }

      // Verificar se o usuário tem permissão para acessar este material
      const userId = req.user && req.user.id ? req.user.id : null;
      const isAdmin = req.user && req.user.role === 'ADMIN';
      if (!isAdmin && userId && material.userId !== userId) {
        return res.status(403).json({ error: 'Você não tem permissão para acessar esta transcrição.' });
      }

      // Verificar se a transcrição está completa
      if (material.status !== 'processed') {
        return res.status(400).json({ 
          error: 'A transcrição ainda não foi concluída ou ocorreu um erro.',
          status: material.status
        });
      }

      return res.status(200).json({
        id: material.id,
        title: material.title,
        content: material.content,
        type: material.type,
        categories: material.categories,
        insights: material.insights,
        createdAt: material.createdAt,
        updatedAt: material.updatedAt
      });
    } catch (error) {
      logger.error('Erro ao buscar transcrição:', error);
      
      return res.status(500).json({ 
        error: 'Erro ao recuperar a transcrição.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  /**
   * Cancela uma transcrição em andamento
   */
  cancelTranscription: async (req, res) => {
    try {
      const { id } = req.params;

      // Buscar material no banco de dados
      const material = await prisma.trainingMaterial.findUnique({
        where: { id }
      });

      if (!material) {
        return res.status(404).json({ error: 'Transcrição não encontrada.' });
      }

      // Verificar se o usuário tem permissão para cancelar este material
      const userId = req.user && req.user.id ? req.user.id : null;
      const isAdmin = req.user && req.user.role === 'ADMIN';
      if (!isAdmin && userId && material.userId !== userId) {
        return res.status(403).json({ error: 'Você não tem permissão para cancelar esta transcrição.' });
      }

      // Verificar se a transcrição está em andamento
      if (material.status !== 'processing') {
        return res.status(400).json({ 
          error: 'A transcrição não pode ser cancelada pois não está em andamento.',
          status: material.status
        });
      }

      // Atualizar o status para "cancelled"
      await prisma.trainingMaterial.update({
        where: { id },
        data: {
          status: 'cancelled',
          content: 'Transcrição cancelada pelo usuário.'
        }
      });

      return res.status(200).json({
        id: material.id,
        message: 'Transcrição cancelada com sucesso.',
        status: 'cancelled'
      });
    } catch (error) {
      logger.error('Erro ao cancelar transcrição:', error);
      
      return res.status(500).json({ 
        error: 'Erro ao cancelar a transcrição.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

/**
 * Função auxiliar para processar a transcrição em segundo plano
 */
async function processTranscription(filePath, materialId, language) {
  try {
    logger.info(`Iniciando processamento de transcrição para material ID: ${materialId}`);
    
    // Transcrever o arquivo usando o serviço OpenAI
    const transcript = await openaiService.transcribeAudioVideo(filePath, language);
    
    // Extrair insights do conteúdo transcrito
    const insights = await trainingService.extractInsights(transcript, `Transcrição de áudio/vídeo`);
    
    // Atualizar o material com a transcrição e os insights
    await prisma.trainingMaterial.update({
      where: { id: materialId },
      data: {
        content: transcript,
        insights: insights,
        status: 'processed'
      }
    });
    
    // Remover o arquivo temporário após o processamento
    fs.unlinkSync(filePath);
    
    logger.info(`Transcrição concluída e salva para o material ID: ${materialId}`);
    return true;
  } catch (error) {
    logger.error(`Erro ao processar transcrição para material ID: ${materialId}:`, error);
    
    // Atualizar status para erro
    await updateTranscriptionStatus(materialId, 'error', 'Falha ao processar transcrição: ' + error.message);
    
    // Tentar limpar o arquivo temporário
    try {
      fs.unlinkSync(filePath);
    } catch (unlinkError) {
      logger.error(`Erro ao remover arquivo temporário após falha: ${filePath}`, unlinkError);
    }
    
    throw error;
  }
}

/**
 * Função auxiliar para atualizar o status de uma transcrição
 */
async function updateTranscriptionStatus(materialId, status, errorMessage) {
  try {
    await prisma.trainingMaterial.update({
      where: { id: materialId },
      data: {
        status,
        content: status === 'error' ? errorMessage : undefined
      }
    });
    return true;
  } catch (error) {
    logger.error(`Erro ao atualizar status da transcrição ID: ${materialId}:`, error);
    return false;
  }
}

module.exports = transcriptionController; 