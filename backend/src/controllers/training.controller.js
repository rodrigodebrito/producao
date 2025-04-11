const trainingService = require('../services/ai/training.service');
const embeddingService = require('../services/ai/embedding.service');
const prisma = require('../utils/prisma');
const { createLogger } = require('../utils/logger');
const logger = createLogger('training-controller');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const trainingController = {
  /**
   * Adiciona um novo material de treinamento
   */
  addMaterial: async (req, res) => {
    try {
      const { title, content, type, categories, videoUrl, isVideoTranscription } = req.body;
      const userId = req.user.id;

      const material = await trainingService.addTrainingMaterial({
        title,
        content,
        type,
        categories,
        videoUrl,
        isVideoTranscription,
        userId
      });

      res.status(201).json(material);
    } catch (error) {
      logger.error('Erro ao adicionar material:', error);
      res.status(500).json({ error: 'Erro ao adicionar material de treinamento' });
    }
  },

  /**
   * Adiciona um material com upload de documento
   */
  uploadMaterial: async (req, res) => {
    try {
      const { title, type, categories } = req.body;
      const userId = req.user.id;
      let categories_array = [];
      
      // Verificar se categories está em formato de array ou string
      if (typeof req.body['categories[]'] === 'string') {
        categories_array = [req.body['categories[]']];
      } else if (Array.isArray(req.body['categories[]'])) {
        categories_array = req.body['categories[]'];
      } else if (typeof categories === 'string') {
        categories_array = [categories];
      } else if (Array.isArray(categories)) {
        categories_array = categories;
      }

      const isVideoTranscription = req.body.isVideoTranscription === 'true';
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }

      // Extrair o conteúdo do documento
      let content = '';
      
      if (file.mimetype === 'text/plain') {
        // Ler arquivo de texto diretamente
        try {
          content = fs.readFileSync(file.path, 'utf8');
          logger.info(`Texto extraído com sucesso do arquivo TXT: ${file.originalname}`);
        } catch (error) {
          logger.error('Erro ao ler arquivo de texto:', error);
          content = 'Erro ao extrair texto do arquivo. O conteúdo será processado manualmente.';
        }
      } else if (file.mimetype === 'application/pdf') {
        // Extrair texto de PDF
        try {
          const dataBuffer = fs.readFileSync(file.path);
          const pdfData = await pdf(dataBuffer);
          content = pdfData.text;
          logger.info(`Texto extraído com sucesso do PDF: ${file.originalname}`);
        } catch (error) {
          logger.error('Erro ao extrair texto do PDF:', error);
          content = 'Não foi possível extrair o texto do PDF. O conteúdo será processado manualmente.';
        }
      } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 file.mimetype === 'application/msword') {
        // Para documentos Word, o processamento ocorrerá no training.service.js
        content = 'Documento Word será processado durante a análise.';
        logger.info(`Documento Word detectado: ${file.originalname}. Processamento adiado para fase de análise.`);
      } else {
        // Para outros formatos, manter mensagem padrão
        content = 'Conteúdo extraído do documento. O processamento completo será realizado pela IA.';
        logger.info(`Formato não processado diretamente: ${file.mimetype}`);
      }

      // Criar o material no banco de dados
      const material = await trainingService.addTrainingMaterial({
        title,
        content,
        type,
        categories: categories_array,
        documentPath: file.path,
        documentName: file.originalname,
        documentType: file.mimetype,
        userId
      });

      res.status(201).json(material);
    } catch (error) {
      logger.error('Erro ao fazer upload de material:', error);
      res.status(500).json({ error: 'Erro ao fazer upload de material de treinamento' });
    }
  },

  /**
   * Atualiza um material existente com upload de documento
   */
  updateMaterialWithUpload: async (req, res) => {
    try {
      const { id } = req.params;
      const { title, type, categories } = req.body;
      let categories_array = [];
      
      // Verificar se categories está em formato de array ou string
      if (typeof req.body['categories[]'] === 'string') {
        categories_array = [req.body['categories[]']];
      } else if (Array.isArray(req.body['categories[]'])) {
        categories_array = req.body['categories[]'];
      } else if (typeof categories === 'string') {
        categories_array = [categories];
      } else if (Array.isArray(categories)) {
        categories_array = categories;
      }

      const isVideoTranscription = req.body.isVideoTranscription === 'true';
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }

      // Obter material existente para eventuais limpezas
      const existingMaterial = await prisma.trainingMaterial.findUnique({
        where: { id }
      });

      if (!existingMaterial) {
        return res.status(404).json({ error: 'Material não encontrado' });
      }

      // Remover documento anterior se existir
      if (existingMaterial.documentPath && fs.existsSync(existingMaterial.documentPath)) {
        fs.unlinkSync(existingMaterial.documentPath);
      }

      // Extrair o conteúdo do documento
      let content = '';
      
      if (file.mimetype === 'text/plain') {
        // Ler arquivo de texto diretamente
        try {
          content = fs.readFileSync(file.path, 'utf8');
          logger.info(`Texto extraído com sucesso do arquivo TXT: ${file.originalname}`);
        } catch (error) {
          logger.error('Erro ao ler arquivo de texto:', error);
          content = 'Erro ao extrair texto do arquivo. O conteúdo será processado manualmente.';
        }
      } else if (file.mimetype === 'application/pdf') {
        // Extrair texto de PDF
        try {
          const dataBuffer = fs.readFileSync(file.path);
          const pdfData = await pdf(dataBuffer);
          content = pdfData.text;
          logger.info(`Texto extraído com sucesso do PDF: ${file.originalname}`);
        } catch (error) {
          logger.error('Erro ao extrair texto do PDF:', error);
          content = 'Não foi possível extrair o texto do PDF. O conteúdo será processado manualmente.';
        }
      } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 file.mimetype === 'application/msword') {
        // Para documentos Word, o processamento ocorrerá no training.service.js
        content = 'Documento Word será processado durante a análise.';
        logger.info(`Documento Word detectado: ${file.originalname}. Processamento adiado para fase de análise.`);
      } else {
        // Para outros formatos, manter mensagem padrão
        content = 'Conteúdo extraído do documento. O processamento completo será realizado pela IA.';
        logger.info(`Formato não processado diretamente: ${file.mimetype}`);
      }

      // Atualizar o material no banco de dados
      const material = await prisma.trainingMaterial.update({
        where: { id },
        data: {
          title,
          content,
          type,
          categories: categories_array,
          documentPath: file.path,
          documentName: file.originalname,
          documentType: file.mimetype,
          status: 'pending' // Resetar status para que seja processado novamente
        }
      });

      res.status(200).json(material);
    } catch (error) {
      logger.error('Erro ao atualizar material com upload:', error);
      res.status(500).json({ error: 'Erro ao atualizar material de treinamento' });
    }
  },

  /**
   * Lista materiais por categoria
   */
  getMaterialsByCategory: async (req, res) => {
    try {
      const { category } = req.params;
      const materials = await trainingService.getMaterialsByCategory(category);
      res.json(materials);
    } catch (error) {
      logger.error('Erro ao buscar materiais:', error);
      res.status(500).json({ error: 'Erro ao buscar materiais de treinamento' });
    }
  },

  /**
   * Obtém detalhes de um material específico
   */
  getMaterialById: async (req, res) => {
    try {
      const { id } = req.params;
      const material = await prisma.trainingMaterial.findUnique({
        where: { id }
      });

      if (!material) {
        return res.status(404).json({ error: 'Material não encontrado' });
      }

      res.json(material);
    } catch (error) {
      logger.error('Erro ao buscar material:', error);
      res.status(500).json({ error: 'Erro ao buscar material de treinamento' });
    }
  },

  /**
   * Atualiza um material existente
   */
  updateMaterial: async (req, res) => {
    try {
      const { id } = req.params;
      const { title, content, type, categories, videoUrl, isVideoTranscription } = req.body;

      const material = await prisma.trainingMaterial.update({
        where: { id },
        data: { 
          title, 
          content, 
          type, 
          categories, 
          videoUrl, 
          isVideoTranscription 
        }
      });

      res.json(material);
    } catch (error) {
      logger.error('Erro ao atualizar material:', error);
      res.status(500).json({ error: 'Erro ao atualizar material de treinamento' });
    }
  },

  /**
   * Remove um material
   */
  deleteMaterial: async (req, res) => {
    try {
      const { id } = req.params;
      await prisma.trainingMaterial.delete({
        where: { id }
      });

      res.status(204).send();
    } catch (error) {
      logger.error('Erro ao deletar material:', error);
      res.status(500).json({ error: 'Erro ao deletar material de treinamento' });
    }
  },

  /**
   * Processa um material manualmente
   */
  processMaterial: async (req, res) => {
    try {
      const { id } = req.params;
      
      // Atualizar o status para processing
      await prisma.trainingMaterial.update({
        where: { id },
        data: {
          status: 'processing'
        }
      });
      
      // Obter o material para verificar seu tamanho
      const material = await prisma.trainingMaterial.findUnique({
        where: { id }
      });
      
      // Verificar o tamanho do conteúdo para decidir se processa de forma síncrona ou assíncrona
      const isLargeDocument = material && material.content && material.content.length > 10000;
      
      if (isLargeDocument) {
        // Para documentos grandes, iniciar o processamento em segundo plano
        // e retornar imediatamente para não causar timeout no cliente
        logger.info(`Iniciando processamento em segundo plano para o material: ${id}`);
        
        // Inicia o processamento em uma promessa separada
        (async () => {
          try {
            await trainingService.processMaterial(id);
            logger.info(`Processamento em segundo plano concluído para o material: ${id}`);
          } catch (error) {
            logger.error(`Erro durante o processamento em segundo plano do material ${id}:`, error);
            
            // Atualizar status para error
            await prisma.trainingMaterial.update({
              where: { id },
              data: {
                status: 'error'
              }
            });
          }
        })();
        
        // Retornar resposta imediatamente
        return res.json({ 
          message: 'Processamento iniciado em segundo plano. Verifique o status mais tarde.',
          background: true
        });
      }
      
      // Para documentos menores, processar normalmente
      const insights = await trainingService.processMaterial(id);
      
      res.json({ insights });
    } catch (error) {
      logger.error('Erro ao processar material:', error);
      
      // Atualizar status para error
      try {
        await prisma.trainingMaterial.update({
          where: { id: req.params.id },
          data: {
            status: 'error'
          }
        });
      } catch (updateError) {
        logger.error('Erro ao atualizar status do material:', updateError);
      }
      
      res.status(500).json({ error: 'Erro ao processar material de treinamento' });
    }
  },

  /**
   * Melhora a análise de uma sessão usando materiais de treinamento
   */
  enhanceSessionAnalysis: async (req, res) => {
    try {
      const { sessionContent, category } = req.body;
      const enhancedAnalysis = await trainingService.enhanceSessionAnalysis(
        sessionContent,
        category
      );
      res.json({ analysis: enhancedAnalysis });
    } catch (error) {
      logger.error('Erro ao melhorar análise:', error);
      res.status(500).json({ error: 'Erro ao melhorar análise da sessão' });
    }
  },

  /**
   * Lista todos os materiais
   */
  getAllMaterials: async (req, res) => {
    try {
      const materials = await prisma.trainingMaterial.findMany({
        orderBy: {
          createdAt: 'desc'
        }
      });
      
      res.json(materials);
    } catch (error) {
      logger.error('Erro ao buscar todos os materiais:', error);
      res.status(500).json({ error: 'Erro ao buscar materiais de treinamento' });
    }
  },

  /**
   * Gera ou atualiza embeddings para um material específico
   */
  generateEmbedding: async (req, res) => {
    try {
      const { id } = req.params;

      // Verificar se o material existe
      const material = await prisma.trainingMaterial.findUnique({
        where: { id }
      });

      if (!material) {
        return res.status(404).json({ error: 'Material não encontrado' });
      }

      // Gerar embedding
      const embedding = await embeddingService.updateMaterialEmbedding(id);
      
      res.status(200).json({ 
        message: 'Embedding gerado com sucesso',
        materialId: id,
        embeddingSize: embedding.length
      });
    } catch (error) {
      logger.error('Erro ao gerar embedding:', error);
      res.status(500).json({ error: 'Erro ao gerar embedding para o material' });
    }
  },

  /**
   * Gera embeddings para todos os materiais processados sem embedding
   */
  generateAllEmbeddings: async (req, res) => {
    try {
      // Iniciar o processo de atualização em segundo plano
      res.status(202).json({ 
        message: 'Processo de geração de embeddings iniciado em segundo plano',
        background: true
      });

      // Continuar o processamento após enviar a resposta
      try {
        await embeddingService.updateAllEmbeddings();
        logger.info('Embeddings atualizados com sucesso para todos os materiais');
      } catch (error) {
        logger.error('Erro ao atualizar todos os embeddings:', error);
      }
    } catch (error) {
      logger.error('Erro ao iniciar geração de embeddings:', error);
      res.status(500).json({ error: 'Erro ao iniciar processo de geração de embeddings' });
    }
  },

  /**
   * Busca materiais semanticamente similares ao texto fornecido
   */
  searchSemantic: async (req, res) => {
    try {
      const { query } = req.body;
      
      if (!query || query.trim().length < 10) {
        return res.status(400).json({ 
          error: 'Consulta muito curta. Forneça pelo menos 10 caracteres para busca.' 
        });
      }

      // Realizar busca semântica
      const results = await trainingService.searchSemanticMaterials(query);
      
      res.status(200).json({
        message: 'Busca semântica realizada com sucesso',
        results,
        count: results.length
      });
    } catch (error) {
      logger.error('Erro ao realizar busca semântica:', error);
      res.status(500).json({ error: 'Erro ao realizar busca semântica' });
    }
  }
};

module.exports = trainingController; 