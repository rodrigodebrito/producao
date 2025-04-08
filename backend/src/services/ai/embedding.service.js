// Removendo import com require e usando uma variável que será preenchida depois
// const { pipeline } = require('@xenova/transformers');
const prisma = require('../../utils/prisma');
const logger = require('../../utils/logger');

let pipeline; // Será preenchido após importação dinâmica

class EmbeddingService {
  constructor() {
    this.model = null;
    this.modelName = 'Xenova/all-MiniLM-L6-v2'; // Modelo leve e eficiente para embeddings
    this.embeddingDimension = 384; // Dimensão padrão de embeddings para este modelo
    this.initialized = false;
    
    // Iniciar o carregamento do módulo transformers de forma assíncrona
    this.loadTransformersModule().catch(err => {
      logger.error('Erro ao carregar o módulo transformers:', err);
    });
  }

  /**
   * Carrega o módulo transformers usando importação dinâmica
   */
  async loadTransformersModule() {
    try {
      logger.info('EmbeddingService: Carregando módulo transformers via import dinâmico');
      const transformers = await import('@xenova/transformers');
      pipeline = transformers.pipeline;
      logger.info('EmbeddingService: Módulo transformers carregado com sucesso');
    } catch (error) {
      logger.error('EmbeddingService: Erro ao carregar módulo transformers', error);
      throw error;
    }
  }

  /**
   * Inicializa o modelo de embeddings
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Garantir que o módulo transformers foi carregado
      if (!pipeline) {
        logger.info('EmbeddingService: Aguardando carregamento do módulo transformers...');
        await this.loadTransformersModule();
      }

      logger.info(`EmbeddingService: Inicializando modelo ${this.modelName}`);
      this.model = await pipeline('feature-extraction', this.modelName);
      this.initialized = true;
      logger.info('EmbeddingService: Modelo inicializado com sucesso');
    } catch (error) {
      logger.error('EmbeddingService: Erro ao inicializar modelo', error);
      throw new Error(`Falha ao inicializar modelo de embeddings: ${error.message}`);
    }
  }

  /**
   * Gera embedding para um texto
   * @param {string} text - Texto para gerar embedding
   * @returns {Promise<number[]>} Vetor de embedding
   */
  async generateEmbedding(text) {
    await this.initialize();

    try {
      // Truncar texto se for muito longo para evitar problemas
      const truncatedText = text.substring(0, 8192);
      
      const result = await this.model(truncatedText, {
        pooling: 'mean',
        normalize: true
      });

      // Extrair os valores do tensor
      const embedding = Array.from(result.data);
      return embedding;
    } catch (error) {
      logger.error('EmbeddingService: Erro ao gerar embedding', error);
      throw new Error(`Falha ao gerar embedding: ${error.message}`);
    }
  }

  /**
   * Calcula a similaridade de cosseno entre dois vetores
   * @param {number[]} vec1 - Primeiro vetor
   * @param {number[]} vec2 - Segundo vetor
   * @returns {number} Similaridade (0-1)
   */
  cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) {
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    // Evitar divisão por zero
    if (norm1 === 0 || norm2 === 0) return 0;

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Atualiza o embedding de um material específico
   * @param {string} materialId - ID do material para atualizar
   */
  async updateMaterialEmbedding(materialId) {
    try {
      logger.info(`EmbeddingService: Atualizando embedding para o material ${materialId}`);
      
      // Obter o material
      const material = await prisma.trainingMaterial.findUnique({
        where: { id: materialId }
      });

      if (!material) {
        throw new Error(`Material não encontrado: ${materialId}`);
      }

      // Preparar texto para embedding (título + insights + conteúdo)
      let embeddingText = material.title + '\n\n';
      
      if (material.insights) {
        embeddingText += material.insights + '\n\n';
      }
      
      // Adicionar parte do conteúdo, mas limitando para não sobrecarregar
      if (material.content) {
        embeddingText += material.content.substring(0, 5000);
      }

      // Gerar embedding
      const embedding = await this.generateEmbedding(embeddingText);

      // Atualizar no banco de dados
      await prisma.trainingMaterial.update({
        where: { id: materialId },
        data: { embedding }
      });

      logger.info(`EmbeddingService: Embedding atualizado com sucesso para o material ${materialId}`);
      return embedding;
    } catch (error) {
      logger.error(`EmbeddingService: Erro ao atualizar embedding do material ${materialId}`, error);
      throw error;
    }
  }

  /**
   * Busca materiais semanticamente semelhantes ao texto fornecido
   * @param {string} queryText - Texto de consulta
   * @param {number} limit - Número máximo de resultados
   * @param {number} minSimilarity - Similaridade mínima (0-1)
   * @returns {Promise<Array>} Materiais semelhantes
   */
  async searchSimilarMaterials(queryText, limit = 5, minSimilarity = 0.7) {
    try {
      await this.initialize();
      logger.info(`EmbeddingService: Buscando materiais semelhantes para: "${queryText.substring(0, 50)}..."`);

      // Gerar embedding para a consulta
      const queryEmbedding = await this.generateEmbedding(queryText);

      // Buscar todos os materiais que têm embeddings
      const materials = await prisma.trainingMaterial.findMany({
        where: {
          embedding: { not: null },
          status: 'processed'
        }
      });

      // Calcular similaridade para cada material
      const results = materials
        .map(material => {
          // Verificar se o embedding existe e é válido
          if (!material.embedding || !Array.isArray(material.embedding)) {
            return { material, similarity: 0 };
          }

          const similarity = this.cosineSimilarity(queryEmbedding, material.embedding);
          return { material, similarity };
        })
        // Filtrar por similaridade mínima
        .filter(result => result.similarity >= minSimilarity)
        // Ordenar por similaridade (maior primeiro)
        .sort((a, b) => b.similarity - a.similarity)
        // Limitar quantidade de resultados
        .slice(0, limit)
        // Mapear para formato de resposta
        .map(result => ({
          id: result.material.id,
          title: result.material.title,
          categories: result.material.categories,
          insights: result.material.insights,
          similarity: result.similarity
        }));

      logger.info(`EmbeddingService: Encontrados ${results.length} materiais semelhantes`);
      return results;
    } catch (error) {
      logger.error('EmbeddingService: Erro ao buscar materiais semelhantes', error);
      return [];
    }
  }

  /**
   * Atualiza embeddings para todos os materiais processados
   */
  async updateAllEmbeddings() {
    try {
      logger.info('EmbeddingService: Iniciando atualização de todos os embeddings');
      
      // Buscar todos os materiais processados sem embedding
      const materials = await prisma.trainingMaterial.findMany({
        where: {
          status: 'processed',
          embedding: null
        }
      });

      logger.info(`EmbeddingService: Encontrados ${materials.length} materiais para atualizar embeddings`);

      // Atualizar embeddings em sequência para evitar sobrecarga
      for (const material of materials) {
        try {
          await this.updateMaterialEmbedding(material.id);
          logger.info(`EmbeddingService: Embedding atualizado para material ${material.id}`);
        } catch (error) {
          logger.error(`EmbeddingService: Erro ao atualizar embedding do material ${material.id}`, error);
          // Continuar com o próximo material mesmo se houver erro
        }
      }

      logger.info('EmbeddingService: Atualização de embeddings concluída');
    } catch (error) {
      logger.error('EmbeddingService: Erro ao atualizar todos os embeddings', error);
      throw error;
    }
  }
}

module.exports = new EmbeddingService(); 