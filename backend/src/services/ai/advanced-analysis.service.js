/**
 * Serviço de análise avançada para sessões de terapia
 * Implementa análise detalhada de temas, estruturação de resultados
 * e integração com materiais de treinamento
 */
const { OpenAI } = require('openai');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');
const { createLogger } = require('../../utils/logger');
const logger = createLogger('advanced-analysis-service');
const trainingService = require('./training.service');

// Inicializar clientes
const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

class AdvancedAnalysisService {
  /**
   * Extrai temas detalhados do transcript da sessão
   * Inclui subtemas, relevância, emoções associadas e frequência
   * @param {string} transcript - Transcrição da sessão
   * @returns {Promise<Array>} - Array de temas detalhados
   */
  async extractDetailedThemes(transcript) {
    try {
      logger.info('AdvancedAnalysisService: Extraindo temas detalhados da sessão');
      
      const systemPrompt = `Analise profundamente esta transcrição de sessão terapêutica e extraia os temas principais.
      Para cada tema identificado, forneça:
      1. Nome do tema principal
      2. Subtemas relacionados
      3. Palavras-chave associadas
      4. Nível de relevância (1-10)
      5. Emoções associadas ao tema
      6. Frequência com que aparece na sessão (baixa, média, alta)
      
      Formate a resposta como JSON válido com a seguinte estrutura:
      {
        "themes": [
          {
            "theme": "string",
            "subthemes": ["string"],
            "keywords": ["string"],
            "relevance": number,
            "emotions": ["string"],
            "frequency": "string"
          }
        ]
      }
      
      Seja preciso e clínico na identificação dos temas, utilizando terminologia terapêutica apropriada.`;
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript }
        ],
        temperature: 0.7,
        max_tokens: 1500
      });
      
      const result = JSON.parse(completion.choices[0].message.content);
      logger.info(`AdvancedAnalysisService: Extraídos ${result.themes.length} temas detalhados`);
      
      return result.themes;
    } catch (error) {
      logger.error('AdvancedAnalysisService: Erro ao extrair temas detalhados', { error });
      throw new Error(`Falha ao extrair temas detalhados: ${error.message}`);
    }
  }

  /**
   * Cria uma análise temática para cada tema identificado,
   * buscando materiais relevantes e gerando insights específicos
   * @param {Array} themes - Array de temas detalhados
   * @param {string} transcript - Transcrição da sessão
   * @returns {Promise<Array>} - Array de análises temáticas
   */
  async createThematicAnalysis(themes, transcript) {
    try {
      logger.info('AdvancedAnalysisService: Criando análises temáticas');
      
      const thematicAnalysis = [];
      
      // Para cada tema, buscar materiais relevantes e criar uma análise específica
      for (const theme of themes) {
        // Buscar materiais relevantes para o tema e subtemas
        const searchTerms = [
          theme.theme, 
          ...theme.subthemes
        ].filter(Boolean);
        
        let materials = [];
        
        // Primeira tentativa: busca direta por correspondência de categorias
        try {
          for (const term of searchTerms) {
            const matchedMaterials = await prisma.trainingMaterial.findMany({
              where: {
                OR: [
                  { categories: { has: term } },
                  { title: { contains: term, mode: 'insensitive' } }
                ],
                status: 'processed'
              },
              select: {
                id: true,
                title: true,
                insights: true,
                categories: true,
                content: true
              },
              take: 2
            });
            
            materials = [...materials, ...matchedMaterials];
          }
        } catch (error) {
          logger.warn('AdvancedAnalysisService: Erro na busca direta por materiais', { error, theme });
        }
        
        // Segunda tentativa: busca semântica se não encontrou materiais suficientes
        if (materials.length < 2) {
          try {
            const embeddingSearchResults = await trainingService.semanticSearch(
              theme.theme, 
              2
            );
            
            // Adicionar resultados da busca semântica se encontrados
            if (embeddingSearchResults && embeddingSearchResults.length > 0) {
              materials = [...materials, ...embeddingSearchResults];
            }
          } catch (searchError) {
            logger.warn('AdvancedAnalysisService: Erro na busca semântica', { 
              error: searchError,
              theme: theme.theme
            });
          }
        }
        
        // Remover duplicados por ID
        const uniqueMaterials = Array.from(
          new Map(materials.map(m => [m.id, m])).values()
        );
        
        // Extrair informações relevantes dos materiais para a análise
        const materialContexts = uniqueMaterials.map(m => ({
          title: m.title,
          insights: m.insights || '',
          categories: m.categories || []
        }));
        
        // Gerar análise específica para este tema
        let themeAnalysis = {
          theme: theme.theme,
          subthemes: theme.subthemes,
          relevance: theme.relevance,
          emotions: theme.emotions,
          detailedAnalysis: '',
          materialReferences: uniqueMaterials.map(m => ({
            id: m.id,
            title: m.title
          }))
        };
        
        // Se temos materiais relevantes, enriquecer a análise com eles
        if (materialContexts.length > 0) {
          try {
            const systemPrompt = `Você é um assistente especializado em psicoterapia que ajuda terapeutas a analisar sessões.
            Analise o tema específico da sessão considerando os materiais de treinamento fornecidos.
            Gere uma análise detalhada que conecte o tema com os conceitos dos materiais relevantes.
            Mantenha um tom profissional e clínico, utilizando terminologia terapêutica apropriada.`;
            
            const userPrompt = `
            Tema a analisar: ${theme.theme}
            Subtemas: ${theme.subthemes.join(', ')}
            Emoções associadas: ${theme.emotions.join(', ')}
            
            Trecho relevante da transcrição que menciona este tema:
            ${this._extractRelevantSection(transcript, theme.keywords, 1500)}
            
            Materiais de treinamento relevantes:
            ${materialContexts.map(m => 
              `Título: ${m.title}\nInsights: ${m.insights}\nCategorias: ${m.categories.join(', ')}`
            ).join('\n\n')}
            
            Forneça uma análise detalhada deste tema específico, conectando-o com os conceitos dos materiais de treinamento.`;
            
            const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              temperature: 0.7,
              max_tokens: 800
            });
            
            themeAnalysis.detailedAnalysis = completion.choices[0].message.content;
          } catch (error) {
            logger.error('AdvancedAnalysisService: Erro ao gerar análise temática enriquecida', { error, theme });
            // Fallback para análise básica
            themeAnalysis.detailedAnalysis = `Análise do tema "${theme.theme}": Este tema aparece com relevância ${theme.relevance}/10 na sessão e está associado a emoções como ${theme.emotions.join(', ')}.`;
          }
        } else {
          // Análise básica sem materiais de referência
          themeAnalysis.detailedAnalysis = `Análise do tema "${theme.theme}": Este tema aparece com relevância ${theme.relevance}/10 na sessão e está associado a emoções como ${theme.emotions.join(', ')}.`;
        }
        
        thematicAnalysis.push(themeAnalysis);
      }
      
      logger.info(`AdvancedAnalysisService: Criadas ${thematicAnalysis.length} análises temáticas`);
      return thematicAnalysis;
    } catch (error) {
      logger.error('AdvancedAnalysisService: Erro ao criar análises temáticas', { error });
      return themes.map(theme => ({
        theme: theme.theme,
        subthemes: theme.subthemes,
        relevance: theme.relevance,
        emotions: theme.emotions,
        detailedAnalysis: `Tema identificado: ${theme.theme}. Relevância: ${theme.relevance}/10.`,
        materialReferences: []
      }));
    }
  }

  /**
   * Extrai um trecho relevante do transcript que menciona palavras-chave específicas
   * @param {string} transcript - Transcrição completa
   * @param {Array} keywords - Palavras-chave a procurar
   * @param {number} maxLength - Tamanho máximo do trecho
   * @returns {string} - Trecho relevante
   */
  _extractRelevantSection(transcript, keywords, maxLength = 1000) {
    // Dividir transcrição em linhas ou parágrafos
    const lines = transcript.split('\n');
    
    // Encontrar linhas que contêm pelo menos uma das palavras-chave
    const relevantLines = lines.filter(line => 
      keywords.some(keyword => 
        line.toLowerCase().includes(keyword.toLowerCase())
      )
    );
    
    // Se não encontrarmos linhas relevantes, retornar um trecho do início
    if (relevantLines.length === 0) {
      return transcript.substring(0, maxLength);
    }
    
    // Juntar as linhas relevantes
    let relevantText = relevantLines.join('\n');
    
    // Truncar se necessário
    if (relevantText.length > maxLength) {
      relevantText = relevantText.substring(0, maxLength) + '...';
    }
    
    return relevantText;
  }

  /**
   * Gera uma análise estruturada completa da sessão,
   * incorporando as análises temáticas e materiais relevantes
   * @param {Array} thematicAnalysis - Array de análises temáticas
   * @param {string} transcript - Transcrição da sessão
   * @returns {Promise<Object>} - Análise estruturada completa
   */
  async generateStructuredAnalysis(thematicAnalysis, transcript) {
    try {
      logger.info('AdvancedAnalysisService: Gerando análise estruturada completa');
      
      // Ordenar temas por relevância
      const sortedThemes = [...thematicAnalysis].sort((a, b) => b.relevance - a.relevance);
      
      // Prepara um resumo dos temas principais
      const themesSummary = sortedThemes
        .map(t => `${t.theme} (Relevância: ${t.relevance}/10)`)
        .join(', ');
      
      // Sistema de prompt para análise estruturada
      const systemPrompt = `Você é um assistente especializado em psicoterapia que ajuda terapeutas a analisar sessões.
      Você irá gerar uma análise estruturada e profissional da sessão terapêutica, baseada nas análises temáticas fornecidas.
      Seu objetivo é sintetizar as informações em um formato claro e útil para o terapeuta.
      
      A análise deve incluir:
      1. Uma visão geral da sessão
      2. Padrões emocionais identificados
      3. Dinâmicas relevantes
      4. Recomendações para o terapeuta
      
      Mantenha um tom profissional e baseie suas conclusões nas análises temáticas fornecidas.`;
      
      // Montamos o prompt para o usuário com as análises temáticas
      const userPrompt = `
      Baseado nas seguintes análises temáticas, gere uma análise estruturada e profissional desta sessão terapêutica:
      
      Temas principais identificados (em ordem de relevância): ${themesSummary}
      
      Análises temáticas detalhadas:
      ${sortedThemes.map(t => 
        `Tema: ${t.theme}\nRelevância: ${t.relevance}/10\nEmotional: ${t.emotions.join(', ')}\nAnálise: ${t.detailedAnalysis.substring(0, 300)}...`
      ).join('\n\n')}
      
      Forneça uma análise estruturada que sintetize estes insights de forma clara e útil para o terapeuta.`;
      
      // Gerar a análise estruturada
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });
      
      // Extrair materiais referenciados para uso na UI
      const referencedMaterials = this._extractUsedMaterials(thematicAnalysis);
      
      // Estruturar a resposta completa
      const structuredAnalysis = {
        overview: completion.choices[0].message.content,
        thematicAnalysis: sortedThemes,
        referencedMaterials
      };
      
      logger.info('AdvancedAnalysisService: Análise estruturada gerada com sucesso');
      return structuredAnalysis;
    } catch (error) {
      logger.error('AdvancedAnalysisService: Erro ao gerar análise estruturada', { error });
      
      // Versão simplificada como fallback
      return {
        overview: `Análise da sessão: Foram identificados ${thematicAnalysis.length} temas principais, incluindo ${thematicAnalysis.map(t => t.theme).join(', ')}.`,
        thematicAnalysis,
        referencedMaterials: this._extractUsedMaterials(thematicAnalysis)
      };
    }
  }

  /**
   * Extrai os materiais utilizados nas análises temáticas
   * para referência na UI
   * @param {Array} thematicAnalysis - Array de análises temáticas
   * @returns {Array} - Materiais referenciados
   */
  _extractUsedMaterials(thematicAnalysis) {
    // Mapear todos os materiais referenciados
    const allReferences = thematicAnalysis
      .flatMap(t => t.materialReferences || [])
      .filter(Boolean);
    
    // Remover duplicatas por ID
    const uniqueMaterials = Array.from(
      new Map(allReferences.map(m => [m.id, m])).values()
    );
    
    return uniqueMaterials;
  }

  /**
   * Método principal que orquestra todo o processo de análise
   * @param {string} transcript - Transcrição da sessão
   * @returns {Promise<Object>} - Análise estruturada completa
   */
  async analyzeSession(transcript) {
    try {
      logger.info('AdvancedAnalysisService: Iniciando análise de sessão');
      
      // 1. Extrair temas detalhados
      const themes = await this.extractDetailedThemes(transcript);
      logger.info(`AdvancedAnalysisService: Extraídos ${themes.length} temas`);
      
      // 2. Criar análise temática para cada tema
      const thematicAnalysis = await this.createThematicAnalysis(themes, transcript);
      logger.info(`AdvancedAnalysisService: Criadas ${thematicAnalysis.length} análises temáticas`);
      
      // 3. Gerar análise estruturada completa
      const structuredAnalysis = await this.generateStructuredAnalysis(thematicAnalysis, transcript);
      logger.info('AdvancedAnalysisService: Análise estruturada gerada com sucesso');
      
      return structuredAnalysis;
    } catch (error) {
      logger.error('AdvancedAnalysisService: Erro ao analisar sessão', { error });
      throw new Error(`Falha ao realizar análise avançada: ${error.message}`);
    }
  }
}

module.exports = new AdvancedAnalysisService(); 