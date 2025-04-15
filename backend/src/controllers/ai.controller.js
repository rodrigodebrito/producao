const { PrismaClient } = require('@prisma/client');
const { OpenAI } = require('openai');
const { validationResult } = require('express-validator');
const trainingService = require('../services/ai/training.service');
const advancedAnalysisService = require('../services/ai/advanced-analysis.service');
const prisma = new PrismaClient();
const FormData = require('form-data');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const openaiService = require('../services/ai/openai.service');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);
const tokenUsageService = require('../services/ai/token-usage.service');
const emotionAnalysisService = require('../services/ai/emotion-analysis.service');

// Inicializar o cliente OpenAI para uso interno no controlador
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

console.log('AI Controller: OpenAI inicializado com sucesso');

/**
 * Estima o número de tokens em um texto
 * Esta é uma estimativa aproximada (4 caracteres ≈ 1 token)
 * @param {string} text - O texto para estimar tokens
 * @returns {number} - Número aproximado de tokens
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Pré-processa uma transcrição longa para garantir que não exceda os limites de tokens da OpenAI
 * @param {string} transcript - A transcrição completa
 * @param {number} maxTokens - Máximo de tokens permitidos (padrão: 4000)
 * @returns {Promise<string>} - A transcrição resumida ou original, dependendo do tamanho
 */
async function preprocessLongTranscript(transcript, maxTokens = 4000) {
  // Estimar tokens na transcrição
  const estimatedTokens = estimateTokens(transcript);
  
  console.log(`AI Controller: Transcrição com estimativa de ${estimatedTokens} tokens`);
  
  // Se a transcrição estiver dentro do limite, retorná-la como está
  if (estimatedTokens <= maxTokens) {
    return transcript;
  }
  
  console.log(`AI Controller: Transcrição excede limite de ${maxTokens} tokens, gerando resumo`);
  
  try {
    // Gerar um resumo usando GPT-3.5-Turbo (mais rápido e mais barato)
    const summaryCompletion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Você é um assistente especializado em resumir sessões de terapia.
          Seu trabalho é condensar transcrições longas mantendo:
          1. Os principais temas discutidos
          2. Padrões emocionais importantes
          3. Insights ou momentos de progresso
          4. Desafios ou obstáculos mencionados
          5. A estrutura geral da conversa
          
          Formate o resumo da mesma forma que a transcrição original, alternando entre "Terapeuta:" e "Paciente:".
          Seu resumo deve ser detalhado o suficiente para uma análise posterior, mas reduzido para caber no limite de tokens.`
        },
        {
          role: "user",
          content: `Resumir esta transcrição de sessão terapêutica para análise posterior:\n\n${transcript}`
        }
      ],
      max_tokens: 1500,
    });
    
    const summarizedTranscript = summaryCompletion.choices[0].message.content;
    console.log(`AI Controller: Resumo gerado com sucesso. Tamanho original: ${transcript.length}, Resumo: ${summarizedTranscript.length}`);
    
    return summarizedTranscript;
  } catch (error) {
    console.error('AI Controller: Erro ao resumir transcrição longa:', error);
    
    // Em caso de erro, fazer um truncamento manual simples
    // Isso é um fallback para garantir que o sistema continue funcionando
    console.log('AI Controller: Realizando truncamento manual como fallback');
    
    // Dividir por linhas para tentar manter a estrutura da conversa
    const lines = transcript.split('\n');
    let truncatedTranscript = '';
    let currentTokens = 0;
    
    // Pegar o início (1/3) e o final (2/3) da transcrição
    const startLines = Math.floor(lines.length / 3);
    const endLines = Math.floor(lines.length * 2 / 3);
    
    // Adicionar nota sobre o truncamento
    truncatedTranscript += "NOTA: Esta transcrição foi truncada devido ao tamanho.\n\n";
    truncatedTranscript += "--- INÍCIO DA SESSÃO ---\n";
    
    // Adicionar o primeiro terço das linhas
    for (let i = 0; i < startLines && currentTokens < maxTokens / 2; i++) {
      const lineTokens = estimateTokens(lines[i]);
      if (currentTokens + lineTokens <= maxTokens / 2) {
        truncatedTranscript += lines[i] + '\n';
        currentTokens += lineTokens;
      } else {
        break;
      }
    }
    
    truncatedTranscript += "\n--- PARTE INTERMEDIÁRIA OMITIDA ---\n\n";
    
    // Adicionar o último terço das linhas
    currentTokens += 100; // Considerar os tokens da nota
    for (let i = endLines; i < lines.length && currentTokens < maxTokens; i++) {
      const lineTokens = estimateTokens(lines[i]);
      if (currentTokens + lineTokens <= maxTokens) {
        truncatedTranscript += lines[i] + '\n';
        currentTokens += lineTokens;
      } else {
        break;
      }
    }
    
    truncatedTranscript += "\n--- FIM DA SESSÃO ---";
    
    console.log(`AI Controller: Transcrição truncada manualmente. Novo tamanho: ${truncatedTranscript.length}`);
    return truncatedTranscript;
  }
}

/**
 * Função auxiliar para limpar arquivos temporários
 * @param {string} originalFilePath - Caminho para o arquivo original
 * @param {string} convertedFilePath - Caminho para o arquivo convertido
 * @private
 */
async function cleanupTempFiles(originalFilePath, convertedFilePath) {
  // Aguardar um pequeno intervalo para garantir que qualquer stream seja fechado
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    // Excluir os arquivos temporários
    if (originalFilePath && fs.existsSync(originalFilePath)) {
      fs.unlinkSync(originalFilePath);
      console.log(`Arquivo original removido: ${originalFilePath}`);
    }
    
    if (convertedFilePath && fs.existsSync(convertedFilePath)) {
      fs.unlinkSync(convertedFilePath);
      console.log(`Arquivo convertido removido: ${convertedFilePath}`);
    }
  } catch (cleanupError) {
    console.error('Erro ao remover arquivos temporários:', cleanupError.message);
  }
}

/**
 * Controlador para operações relacionadas a IA
 */
const aiController = {
  /**
   * Adicionar uma nova transcrição
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  addTranscription: async (req, res) => {
    try {
      // Validar request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // Aceitar tanto 'content' quanto 'transcript' para compatibilidade
      const { sessionId, speaker } = req.body;
      // CORREÇÃO: Aceitar ambos 'transcript' e 'content' para compatibilidade
      const content = req.body.content || req.body.transcript || '';
      const timestamp = req.body.timestamp || new Date();
      
      // Log para debug
      console.log(`AI Controller: Recebida transcrição para sessionId=${sessionId}, speaker=${speaker}, tamanho=${content.length} caracteres`);

      // Verificar se a sessão existe
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          therapist: true,
          client: true
        }
      });

      if (!session) {
        return res.status(404).json({ message: 'Sessão não encontrada' });
      }

      // Verificar se o usuário atual é o terapeuta ou cliente envolvido
      const userId = req.user.id;
      const isTherapist = session.therapist.userId === userId;
      const isClient = session.client.userId === userId;

      if (!isTherapist && !isClient) {
        return res.status(403).json({ message: 'Não autorizado a adicionar transcrições a esta sessão' });
      }

      // Adicionar a transcrição
      const transcription = await prisma.sessionTranscript.create({
        data: {
          sessionId,
          speaker,
          content,
          timestamp
        }
      });

      // Se a sessão estiver em andamento, verificar se precisamos gerar insights
      if (session.status === 'ACTIVE') {
        // Aqui poderíamos chamar um serviço de IA para gerar insights
        // de forma assíncrona em uma fila de processamento
        // Por enquanto, simulamos o comportamento
        this.generateInsightsForSession(sessionId).catch(err => {
          console.error('Erro ao gerar insights:', err);
        });
      }

      res.status(201).json(transcription);
    } catch (error) {
      console.error('Erro ao adicionar transcrição:', error);
      res.status(500).json({ message: 'Erro ao adicionar transcrição' });
    }
  },

  /**
   * Listar transcrições de uma sessão
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  getSessionTranscripts: async (req, res) => {
    try {
      const { sessionId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const page = parseInt(req.query.page) || 1;
      const skip = (page - 1) * limit;

      // Verificar se a sessão existe
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          therapist: true,
          client: true
        }
      });

      if (!session) {
        return res.status(404).json({ message: 'Sessão não encontrada' });
      }

      // Verificar se o usuário atual é o terapeuta ou cliente envolvido
      const userId = req.user.id;
      const isTherapist = session.therapist.userId === userId;
      const isClient = session.client.userId === userId;

      if (!isTherapist && !isClient) {
        return res.status(403).json({ message: 'Não autorizado a visualizar transcrições desta sessão' });
      }

      // Buscar as transcrições
      const transcripts = await prisma.sessionTranscript.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
        skip,
        take: limit
      });

      // Contar o total para paginação
      const total = await prisma.sessionTranscript.count({
        where: { sessionId }
      });

      res.json({
        data: transcripts,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Erro ao listar transcrições:', error);
      res.status(500).json({ message: 'Erro ao listar transcrições' });
    }
  },

  /**
   * Gerar insights para uma sessão usando OpenAI
   * @param {string} sessionId - ID da sessão
   * @private
   */
  generateInsightsForSession: async (sessionId) => {
    try {
      // Buscar as últimas 10 transcrições
      const recentTranscripts = await prisma.sessionTranscript.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: 10
      });

      if (recentTranscripts.length < 3) {
        // Não gerar insights com poucas transcrições
        return;
      }

      // Preparar o texto para análise
      const transcriptText = recentTranscripts
        .reverse()
        .map(t => `${t.speaker}: ${t.content}`)
        .join('\n');

      // Gerar insights usando OpenAI
      const analysis = await openaiService.analyzeText(transcriptText);
      
      // Criar o insight
      await prisma.aIInsight.create({
        data: {
          sessionId,
          content: analysis,
          type: 'ANALYSIS',
          keywords: 'emoções, padrão, comunicação'
        }
      });
    } catch (error) {
      console.error('Erro ao gerar insights:', error);
      throw error;
    }
  },

  /**
   * Manualmente solicitar geração de insights
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  requestInsight: async (req, res) => {
    try {
      const { sessionId } = req.params;
      
      // Verificar se a sessão existe
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          therapist: true
        }
      });

      if (!session) {
        return res.status(404).json({ message: 'Sessão não encontrada' });
      }

      // Apenas o terapeuta pode solicitar insights
      const userId = req.user.id;
      if (session.therapist.userId !== userId) {
        return res.status(403).json({ message: 'Apenas o terapeuta pode solicitar insights' });
      }

      // Gerar o insight de forma síncrona para demonstração
      const content = req.body.prompt 
        ? `Análise baseada no prompt: ${req.body.prompt}`
        : "Análise gerada a partir das transcrições recentes. Observe como o cliente demonstra padrões emocionais que podem estar relacionados a experiências passadas.";
      
      const insight = await prisma.aIInsight.create({
        data: {
          sessionId,
          content,
          type: 'MANUAL_REQUEST',
          keywords: req.body.keywords || 'análise, emoções, padrões'
        }
      });

      res.status(201).json(insight);
    } catch (error) {
      console.error('Erro ao solicitar insight:', error);
      res.status(500).json({ message: 'Erro ao solicitar insight' });
    }
  },

  /**
   * Listar insights de uma sessão
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  getSessionInsights: async (req, res) => {
    try {
      const { sessionId } = req.params;
      
      // Verificar se a sessão existe
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          therapist: true,
          client: true
        }
      });

      if (!session) {
        return res.status(404).json({ message: 'Sessão não encontrada' });
      }

      // Verificar se o usuário atual é o terapeuta ou cliente envolvido
      const userId = req.user.id;
      const isTherapist = session.therapist.userId === userId;
      const isClient = session.client.userId === userId;

      if (!isTherapist && !isClient) {
        return res.status(403).json({ message: 'Não autorizado a visualizar insights desta sessão' });
      }

      // Insights só são mostrados para terapeuta, a menos que esteja configurado para compartilhar
      if (isClient && !session.shareInsightsWithClient) {
        return res.status(403).json({ message: 'Insights não disponíveis para o cliente' });
      }

      // Buscar os insights
      const insights = await prisma.aIInsight.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' }
      });

      res.json(insights);
    } catch (error) {
      console.error('Erro ao listar insights:', error);
      res.status(500).json({ message: 'Erro ao listar insights' });
    }
  },

  /**
   * Salvar transcrição da sessão com detecção de emoções
   * @param {Request} req - Requisição Express 
   * @param {Response} res - Resposta Express
   */
  saveTranscript: async (req, res) => {
    try {
      const { sessionId, transcript, emotions } = req.body;
      
      console.log('Requisição de transcrição recebida:', { 
        sessionId, 
        transcriptLength: transcript ? transcript.length : 0,
        hasEmotions: !!emotions 
      });
      
      // Validar parâmetros obrigatórios
      if (!sessionId) {
        return res.status(400).json({ message: 'sessionId é obrigatório' });
      }
      
      if (!transcript) {
        return res.status(400).json({ message: 'transcript é obrigatório' });
      }
      
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }

      // Verificar se a sessão existe e se o usuário tem acesso
      const session = await prisma.session.findUnique({
        where: {
          id: sessionId,
        },
        include: {
          therapist: true,
          client: true
        }
      });

      if (!session) {
        return res.status(404).json({ message: 'Sessão não encontrada' });
      }

      // Verificar se o usuário é o terapeuta ou o cliente da sessão
      const isTherapist = session.therapist?.userId === userId;
      const isClient = session.client?.userId === userId;
      
      if (!isTherapist && !isClient) {
        return res.status(403).json({ message: 'Acesso não autorizado a esta sessão' });
      }

      // Salvar a transcrição como registro novo, sem usar upsert que estava causando o erro
      const timestampNow = new Date();
      const speakerRole = isTherapist ? 'THERAPIST' : 'CLIENT';
      
      console.log(`Salvando transcrição como ${speakerRole} para sessão ${sessionId}`);
      
      try {
        // Criar um novo registro sem tentar usar uma chave composta
        const savedTranscript = await prisma.sessionTranscript.create({
          data: {
            sessionId,
            content: transcript,
            speaker: speakerRole,
            timestamp: timestampNow
          }
        });
  
        console.log('Transcrição salva com sucesso:', savedTranscript.id);
        
        res.status(200).json({
          message: 'Transcrição salva com sucesso',
          data: savedTranscript
        });
      } catch (dbError) {
        console.error('Erro específico do banco de dados:', dbError);
        res.status(500).json({ 
          message: 'Erro ao salvar no banco de dados', 
          error: dbError.message,
          code: dbError.code 
        });
      }
    } catch (error) {
      console.error('Erro ao salvar transcrição:', error);
      res.status(500).json({ message: 'Erro ao processar solicitação', error: error.message });
    }
  },

  /**
   * Analisar uma sessão
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  analyzeSession: async (req, res) => {
    try {
      console.log('AI Controller: Iniciando análise de sessão');
      const { sessionId, transcript, useAdvancedAnalysis } = req.body;
      const userId = req.user?.id;
      
      console.log(`AI Controller: Processando sessão ${sessionId}, usuário ${userId}, análise avançada: ${useAdvancedAnalysis || false}`);

      // Verificar se a sessão existe e se o usuário tem acesso
      const session = await prisma.session.findUnique({
        where: {
          id: sessionId,
        },
        include: {
          therapist: true
        }
      });

      if (!session) {
        console.log('AI Controller: Sessão não encontrada');
        return res.status(404).json({ 
          message: 'Sessão não encontrada',
          type: 'analysis',
          analysis: 'A sessão solicitada não foi encontrada no sistema.' 
        });
      }

      // Para testes ou desenvolvimento, permitir acesso mais amplo
      const isDevMode = process.env.NODE_ENV === 'development';
      const isTesting = process.env.TESTING === 'true';
      
      // Verificar se o usuário é o terapeuta da sessão
      if (!isDevMode && !isTesting && session.therapist?.userId !== userId) {
        console.log(`AI Controller: Acesso não autorizado. Terapeuta: ${session.therapist?.userId}, Usuário: ${userId}`);
        return res.status(403).json({ 
          message: 'Apenas o terapeuta pode analisar sessões',
          type: 'analysis',
          analysis: 'Você não tem permissão para analisar esta sessão.' 
        });
      }

      // Obter transcrição do banco de dados se não foi fornecida
      let processedTranscript = transcript;
      if (!processedTranscript) {
        const transcriptRecords = await prisma.sessionTranscript.findMany({
          where: {
            sessionId,
          },
          orderBy: {
            timestamp: 'asc'
          },
          take: 50
        });

        if (transcriptRecords && transcriptRecords.length > 0) {
          processedTranscript = transcriptRecords
            .map(record => `${record.speaker}: ${record.content}`)
            .join('\n');
        }
      }

      if (!processedTranscript) {
        console.log('AI Controller: Sem transcrição disponível para análise');
        return res.status(400).json({ 
          message: 'Nenhuma transcrição disponível para análise',
          type: 'analysis',
          analysis: 'Não há transcrição disponível para analisar. Inicie uma conversa primeiro.' 
        });
      }

      // NOVO: Pré-processar a transcrição se for muito longa
      processedTranscript = await preprocessLongTranscript(processedTranscript, 6000);

      // NOVO: Usar análise avançada se solicitado
      if (useAdvancedAnalysis) {
        try {
          console.log('AI Controller: Utilizando serviço de análise avançada');
          
          // Processar a sessão usando o novo serviço de análise avançada
          const advancedAnalysisResult = await advancedAnalysisService.analyzeSession(processedTranscript);
          
          // Salvar a análise no banco de dados
          const savedAnalysis = await prisma.aIInsight.create({
            data: {
              sessionId,
              content: JSON.stringify(advancedAnalysisResult),
              type: 'ADVANCED_ANALYSIS',
              keywords: advancedAnalysisResult.thematicAnalysis
                .map(item => item.theme)
                .join(', ')
            }
          });
          
          console.log('AI Controller: Análise avançada gerada com sucesso');
          
          // Retornar a resposta estruturada
          return res.status(200).json({
            message: 'Análise avançada gerada com sucesso',
            type: 'analysis',
            content: 'Análise estruturada baseada na transcrição da sessão',
            analysis: advancedAnalysisResult.overview,
            data: {
              id: savedAnalysis.id,
              structuredAnalysis: advancedAnalysisResult,
              referencedMaterials: advancedAnalysisResult.referencedMaterials
            }
          });
        } catch (advancedError) {
          console.error('AI Controller: Erro na análise avançada:', advancedError);
          // Se falhar a análise avançada, voltar para a análise padrão
          console.log('AI Controller: Fallback para análise padrão');
        }
      }

      // Continuar com a análise padrão (existente)
      try {
        console.log('AI Controller: Extraindo palavras-chave para busca de materiais');
        
        // Extrair keywords da transcrição
        const keywordsCompletion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "Extraia até 10 palavras-chave da transcrição da sessão terapêutica. Retorne apenas palavras-chave relacionadas a temas terapêuticos, separadas por vírgula, sem explicações adicionais."
            },
            {
              role: "user",
              content: processedTranscript
            }
          ],
          max_tokens: 50,
        });
        
        const keywordsText = keywordsCompletion.choices[0].message.content;
        const keywords = keywordsText.split(',').map(k => k.trim());
        
        console.log(`AI Controller: Palavras-chave extraídas: ${keywords.join(', ')}`);
        
        // Buscar materiais relevantes para essas keywords
        let allMaterials = [];
        try {
          console.log('AI Controller: Buscando materiais de treinamento relevantes');
          
          // Criar promessas para buscar materiais para cada keyword
          const materialPromises = keywords.map(keyword => 
            prisma.trainingMaterial.findMany({
              where: {
                OR: [
                  { title: { contains: keyword, mode: 'insensitive' } },
                  { content: { contains: keyword, mode: 'insensitive' } },
                  { insights: { contains: keyword, mode: 'insensitive' } },
                  { categories: { has: keyword } }
                ],
                status: 'processed'
              },
              take: 3,
              select: {
                id: true,
                title: true,
                insights: true,
                categories: true
              }
            })
          );
          
          const materialsArrays = await Promise.all(materialPromises);
          // Juntar todos os resultados e remover duplicatas por ID
          const materialsMap = new Map();
          materialsArrays.flat().forEach(m => {
            if (!materialsMap.has(m.id)) {
              materialsMap.set(m.id, m);
            }
          });
          
          allMaterials = Array.from(materialsMap.values());
          console.log(`AI Controller: Encontrados ${allMaterials.length} materiais relevantes`);
        } catch (materialError) {
          console.error('AI Controller: Erro ao buscar materiais de treinamento:', materialError);
          // Continuar mesmo se falhar a busca de materiais
          allMaterials = [];
        }
        
        let analysisText;
        let usedMaterials = [];
        
        // Se encontramos materiais relevantes, use o TrainingService para enriquecer a análise
        if (allMaterials.length > 0) {
          console.log('AI Controller: Usando TrainingService para enriquecer análise com materiais');
          
          try {
            // Extrair categorias dos materiais para usar no enhanceSessionAnalysis
            const categories = [...new Set(allMaterials.map(m => m.categories).flat())];
            
            // Usar o TrainingService para enriquecer a análise
            analysisText = await trainingService.enhanceSessionAnalysis(
              processedTranscript, 
              categories
            );
            
            // Guardar os materiais usados para incluir na resposta
            usedMaterials = allMaterials.slice(0, 5).map(m => ({
              id: m.id,
              title: m.title,
              insights: m.insights ? m.insights.substring(0, 200) + "..." : "Sem insights disponíveis",
              categories: m.categories || []
            }));
            
            console.log('AI Controller: Análise enriquecida com sucesso');
          } catch (enhanceError) {
            console.error('AI Controller: Erro ao enriquecer análise:', enhanceError);
            // Se falhar o enhancement, voltamos para a análise padrão
            analysisText = null;
          }
        }
        
        // Se não encontrou materiais ou falhou o enhancement, fazer análise padrão
        if (!analysisText) {
          console.log('AI Controller: Realizando análise padrão sem materiais de treinamento');
          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `Você é um assistente especializado em psicoterapia que ajuda terapeutas a analisar sessões. 
                Analise a transcrição da sessão e forneça insights sobre:
                1. Temas principais discutidos
                2. Padrões emocionais observados
                3. Possíveis questões subjacentes
                4. Progresso em relação a sessões anteriores (se mencionado)
                5. Pontos importantes para acompanhamento
                
                Formate a resposta de maneira clara, concisa e profissional.`
              },
              {
                role: "user",
                content: `Analise a seguinte transcrição de sessão de terapia:\n\n${processedTranscript}`
              }
            ],
            max_tokens: 1000,
          });
          
          analysisText = completion.choices[0].message.content;
        }

        console.log('AI Controller: Resposta gerada com sucesso');
        
        // Salvar a análise no banco de dados
        const savedAnalysis = await prisma.aIInsight.create({
          data: {
            sessionId,
            content: analysisText,
            type: 'ANALYSIS',
            keywords: keywords.join(', ')
          }
        });

        console.log('AI Controller: Retornando resposta estruturada');
        res.status(200).json({
          message: 'Análise gerada com sucesso',
          type: 'analysis',
          content: 'Análise baseada na transcrição da sessão atual',
          analysis: analysisText,
          data: {
            analysis: analysisText,
            id: savedAnalysis.id,
            referencedMaterials: usedMaterials.length > 0 ? usedMaterials : null
          }
        });
      } catch (openaiError) {
        console.error('AI Controller: Erro na chamada da API OpenAI:', openaiError);
        return res.status(500).json({
          message: 'Erro ao processar com a IA',
          error: openaiError.message,
          type: 'analysis',
          analysis: 'Ocorreu um erro ao gerar a análise com a IA. Tente novamente em alguns instantes.'
        });
      }
    } catch (error) {
      console.error('Erro ao analisar sessão:', error);
      res.status(500).json({ 
        message: 'Erro ao processar solicitação', 
        error: error.message,
        type: 'analysis',
        analysis: 'Ocorreu um erro inesperado. Tente novamente mais tarde.'
      });
    }
  },

  /**
   * Gerar sugestões para sessão
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  generateSuggestions: async (req, res) => {
    try {
      console.log('AI Controller: Iniciando geração de sugestões');
      const { sessionId, transcript } = req.body;
      const userId = req.user?.id;
      
      console.log(`AI Controller: Processando sugestões para sessão ${sessionId}, usuário ${userId}`);

      // Verificar se a sessão existe e se o usuário tem acesso
      const session = await prisma.session.findUnique({
        where: {
          id: sessionId,
        },
        include: {
          therapist: true
        }
      });

      if (!session) {
        console.log('AI Controller: Sessão não encontrada');
        return res.status(404).json({ 
          message: 'Sessão não encontrada',
          type: 'suggestions',
          suggestions: ['A sessão não foi encontrada. Verifique o ID da sessão.'] 
        });
      }

      // Para testes ou desenvolvimento, permitir acesso mais amplo
      const isDevMode = process.env.NODE_ENV === 'development';
      const isTesting = process.env.TESTING === 'true';
      
      // Verificar se o usuário é o terapeuta da sessão
      if (!isDevMode && !isTesting && session.therapist?.userId !== userId) {
        console.log(`AI Controller: Acesso não autorizado. Terapeuta: ${session.therapist?.userId}, Usuário: ${userId}`);
        return res.status(403).json({ 
          message: 'Apenas o terapeuta pode gerar sugestões',
          type: 'suggestions',
          suggestions: ['Você não tem permissão para gerar sugestões para esta sessão.'] 
        });
      }

      // Obter transcrição do banco de dados se não foi fornecida
      let processedTranscript = transcript;
      if (!processedTranscript) {
        const transcriptRecords = await prisma.sessionTranscript.findMany({
          where: {
            sessionId,
          },
          orderBy: {
            timestamp: 'asc'
          },
          take: 50
        });

        if (transcriptRecords && transcriptRecords.length > 0) {
          processedTranscript = transcriptRecords
            .map(record => `${record.speaker}: ${record.content}`)
            .join('\n');
        }
      }

      if (!processedTranscript) {
        console.log('AI Controller: Sem transcrição disponível para sugestões');
        return res.status(400).json({ 
          message: 'Nenhuma transcrição disponível para sugestões',
          type: 'suggestions',
          suggestions: ['Não há transcrição disponível para analisar. Inicie uma conversa primeiro.'] 
        });
      }

      // NOVO: Pré-processar a transcrição se for muito longa
      processedTranscript = await preprocessLongTranscript(processedTranscript, 6000);

      try {
        console.log('AI Controller: Gerando sugestões via OpenAI');
        
        // Extrair temas principais da transcrição para identificar materiais relevantes
        console.log('AI Controller: Extraindo temas da transcrição para buscar materiais relevantes');
        const themesCompletion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "Extraia os principais temas e conceitos da transcrição da sessão. Retorne apenas uma lista de palavras-chave separadas por vírgula, sem explicações adicionais."
            },
            {
              role: "user",
              content: `Extraia os temas principais desta transcrição de sessão terapêutica:\n\n${processedTranscript}`
            }
          ],
          max_tokens: 100,
        });
        
        // Extrair os temas como uma array
        const keywords = themesCompletion.choices[0].message.content.split(',').map(k => k.trim());
        console.log('AI Controller: Temas identificados para sugestões:', keywords);
        
        // Buscar materiais de treinamento relevantes para esses temas
        let allMaterials = [];
        try {
          // Buscar materiais para cada palavra-chave identificada
          const materialPromises = keywords.map(keyword => 
            prisma.trainingMaterial.findMany({
              where: {
                OR: [
                  { title: { contains: keyword, mode: 'insensitive' } },
                  { content: { contains: keyword, mode: 'insensitive' } },
                  { insights: { contains: keyword, mode: 'insensitive' } },
                  { categories: { has: keyword } }
                ],
                status: 'processed'
              },
              select: {
                id: true,
                title: true,
                insights: true,
                categories: true
              }
            })
          );
          
          const materialsArrays = await Promise.all(materialPromises);
          // Juntar todos os resultados e remover duplicatas por ID
          const materialsMap = new Map();
          materialsArrays.flat().forEach(m => {
            if (!materialsMap.has(m.id)) {
              materialsMap.set(m.id, m);
            }
          });
          
          allMaterials = Array.from(materialsMap.values());
          console.log(`AI Controller: Encontrados ${allMaterials.length} materiais relevantes para sugestões`);
        } catch (materialError) {
          console.error('AI Controller: Erro ao buscar materiais de treinamento:', materialError);
          // Continuar mesmo se falhar a busca de materiais
          allMaterials = [];
        }
        
        let suggestionsResponse;
        let usedMaterials = [];
        
        // Se encontramos materiais relevantes, use o TrainingService para gerar sugestões enriquecidas
        if (allMaterials.length > 0) {
          console.log('AI Controller: Usando materiais para enriquecer sugestões');
          
          try {
            // Combinar insights dos materiais para usar na geração de sugestões
            const materialsContext = allMaterials
              .slice(0, 5) // Limitar para 5 materiais para não exceder o limite de tokens
              .map(m => `Título: ${m.title}\nInsights: ${m.insights || 'Sem insights disponíveis'}\n`)
              .join('\n\n');
            
            // Gerar sugestões usando os materiais
            const completion = await openai.chat.completions.create({
              model: process.env.OPENAI_MODEL || "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content: `Você é um assistente especializado em psicoterapia que ajuda terapeutas com sugestões práticas.
                  Use os insights dos materiais de treinamento para fornecer sugestões mais específicas e contextualizadas.`
                },
                {
                  role: "user",
                  content: `Com base na transcrição da sessão e nos materiais de treinamento, forneça 5-7 sugestões práticas 
                  que o terapeuta pode aplicar para melhorar a eficácia da terapia neste caso específico.
                  
                  Materiais de Referência:
                  ${materialsContext}
                  
                  Transcrição da Sessão:
                  ${processedTranscript}
                  
                  Formate as sugestões como uma lista de recomendações claras e acionáveis.`
                }
              ],
              max_tokens: 1000,
            });
            
            // Processar a resposta e transformar em um array de sugestões
            const suggestionsText = completion.choices[0].message.content;
            
            // Extrair sugestões numeradas (1. Sugestão, 2. Sugestão, etc.) ou em listas com pontos (• Sugestão, - Sugestão)
            const suggestionLines = suggestionsText.split('\n')
              .filter(line => line.trim().match(/^(\d+\.|\-|\•|\*)\s+.+/))
              .map(line => line.replace(/^(\d+\.|\-|\•|\*)\s+/, '').trim());
            
            suggestionsResponse = suggestionLines.length > 0 ? suggestionLines : [suggestionsText];
            
            // Guardar os materiais usados para incluir na resposta
            usedMaterials = allMaterials.slice(0, 5).map(m => ({
              id: m.id,
              title: m.title,
              insights: m.insights ? m.insights.substring(0, 200) + "..." : "Sem insights disponíveis",
              categories: m.categories || []
            }));
            
            console.log('AI Controller: Sugestões enriquecidas geradas com sucesso');
          } catch (enhanceError) {
            console.error('AI Controller: Erro ao enriquecer sugestões:', enhanceError);
            // Se falhar o enhancement, voltamos para as sugestões padrão
            suggestionsResponse = null;
          }
        }
        
        // Se não encontrou materiais ou falhou o enhancement, fazer sugestões padrão
        if (!suggestionsResponse) {
          console.log('AI Controller: Realizando sugestões padrão sem materiais de treinamento');
          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `Você é um assistente especializado em psicoterapia que ajuda terapeutas durante sessões.
                Forneça sugestões práticas e relevantes com base na transcrição da sessão.`
              },
              {
                role: "user",
                content: `Com base na seguinte transcrição de uma sessão de terapia, forneça 5-7 sugestões
                específicas que possam ajudar o terapeuta a conduzir a sessão de forma mais eficaz:
                
                ${processedTranscript}`
              }
            ],
            max_tokens: 1000,
          });
          
          // Processar a resposta e transformar em um array de sugestões
          const suggestionsText = completion.choices[0].message.content;
          
          // Extrair sugestões numeradas ou em listas
          const suggestionLines = suggestionsText.split('\n')
            .filter(line => line.trim().match(/^(\d+\.|\-|\•|\*)\s+.+/))
            .map(line => line.replace(/^(\d+\.|\-|\•|\*)\s+/, '').trim());
          
          suggestionsResponse = suggestionLines.length > 0 ? suggestionLines : [suggestionsText];
        }

        console.log('AI Controller: Retornando sugestões estruturadas');
        res.status(200).json({
          message: 'Sugestões geradas com sucesso',
          type: 'suggestions',
          content: 'Sugestões baseadas na transcrição da sessão atual',
          suggestions: suggestionsResponse,
          data: {
            suggestions: suggestionsResponse,
            referencedMaterials: usedMaterials.length > 0 ? usedMaterials : null
          }
        });
      } catch (openaiError) {
        console.error('AI Controller: Erro na chamada da API OpenAI:', openaiError);
        return res.status(500).json({
          message: 'Erro ao processar com a IA',
          error: openaiError.message,
          type: 'suggestions',
          suggestions: [
            'Ocorreu um erro ao gerar sugestões com a IA.',
            'Tente novamente em alguns instantes.'
          ]
        });
      }
    } catch (error) {
      console.error('Erro ao gerar sugestões:', error);
      res.status(500).json({ 
        message: 'Erro ao processar solicitação', 
        error: error.message,
        type: 'suggestions',
        suggestions: ['Ocorreu um erro inesperado. Tente novamente mais tarde.']
      });
    }
  },

  /**
   * Gerar relatório de sessão
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  generateReport: async (req, res) => {
    try {
      console.log('AI Controller: Iniciando geração de relatório');
      const { sessionId, transcript } = req.body;
      const userId = req.user?.id;
      
      console.log(`AI Controller: Processando relatório para sessão ${sessionId}, usuário ${userId}`);

      // Verificar se a sessão existe e se o usuário tem acesso
      const session = await prisma.session.findUnique({
        where: {
          id: sessionId,
        },
        include: {
          therapist: true,
          client: true
        }
      });

      if (!session) {
        console.log('AI Controller: Sessão não encontrada');
        return res.status(404).json({ 
          message: 'Sessão não encontrada',
          success: false,
          type: 'report',
          report: 'A sessão solicitada não foi encontrada no sistema.' 
        });
      }

      // Para testes ou desenvolvimento, permitir acesso mais amplo
      const isDevMode = process.env.NODE_ENV === 'development';
      const isTesting = process.env.TESTING === 'true';
      
      // Verificar se o usuário é o terapeuta da sessão
      if (!isDevMode && !isTesting && session.therapist?.userId !== userId) {
        console.log(`AI Controller: Acesso não autorizado. Terapeuta: ${session.therapist?.userId}, Usuário: ${userId}`);
        return res.status(403).json({ 
          message: 'Apenas o terapeuta pode gerar relatórios',
          success: false,
          type: 'report',
          report: 'Você não tem permissão para gerar relatórios para esta sessão.' 
        });
      }

      // Construir ou buscar transcrição
      let processedTranscript = transcript;
      if (!processedTranscript) {
        console.log(`AI Controller: Transcript não fornecido, buscando mensagens do banco de dados`);
        
        // Se não foi fornecido, tentar obter do banco
        let messages = [];
        
        try {
          // Tentar buscar de diferentes modelos possíveis
          try {
            messages = await prisma.message.findMany({
              where: {
                sessionId: sessionId
              },
              orderBy: {
                timestamp: 'asc'
              }
            });
          } catch (err) {
            console.log(`AI Controller: Erro ao buscar de Message, tentando SessionTranscript`);
            
            const transcripts = await prisma.sessionTranscript.findMany({
              where: {
                sessionId: sessionId
              },
              orderBy: {
                timestamp: 'asc'
              }
            });
            
            messages = transcripts.map(t => ({
              sender: t.speaker,
              content: t.content,
              timestamp: t.timestamp
            }));
          }
          
          if (!messages || messages.length === 0) {
            console.error(`AI Controller: Nenhuma mensagem encontrada para a sessão ${sessionId}`);
            return res.status(400).json({
              error: 'Não há mensagens na sessão para gerar um relatório',
              success: false,
              type: 'report',
              report: 'Não há mensagens registradas nesta sessão para gerar um relatório.'
            });
          }
          
          // Montar o transcript a partir das mensagens
          processedTranscript = messages.map(msg => {
            // Determinar quem é o sender (pode variar dependendo do modelo)
            let sender;
            if (typeof msg.sender === 'string') {
              sender = msg.sender.toUpperCase() === 'THERAPIST' || 
                      msg.sender.toUpperCase() === 'TERAPEUTA' ? 
                      'Terapeuta' : 'Paciente';
            } else {
              sender = 'Participante';
            }
            
            return `${sender}: ${msg.content}`;
          }).join('\n');
          
        } catch (dbError) {
          console.error(`AI Controller: Erro ao buscar transcrições do banco: ${dbError.message}`);
          return res.status(500).json({
            error: 'Erro ao buscar transcrições da sessão',
            success: false,
            type: 'report',
            report: 'Ocorreu um erro ao buscar o histórico da sessão. Tente novamente mais tarde.'
          });
        }
      }

      if (!processedTranscript || processedTranscript.length < 100) {
        console.error(`AI Controller: Transcript muito curto (${processedTranscript?.length || 0} caracteres)`);
        return res.status(400).json({
          error: 'Conteúdo insuficiente para gerar um relatório',
          success: false,
          type: 'report',
          report: 'A sessão não possui conteúdo suficiente para gerar um relatório detalhado.'
        });
      }

      // NOVO: Pré-processar a transcrição se for muito longa
      processedTranscript = await preprocessLongTranscript(processedTranscript, 6000);

      // Gerar o relatório usando OpenAI
      try {
        console.log('AI Controller: Gerando relatório via OpenAI');
        
        // Recuperar informações do paciente e terapeuta para personalizar o relatório
        const patientName = session.client?.name || 'Paciente';
        const therapistName = session.therapist?.name || 'Terapeuta';
        
        // Verificar se tem sessões anteriores para referência
        let previousSessionsInfo = "Não há informações sobre sessões anteriores disponíveis.";
        try {
          const previousSessions = await prisma.session.findMany({
            where: {
              therapistId: session.therapistId,
              clientId: session.clientId,
              status: 'COMPLETED',
              id: { not: sessionId },
              startTime: { lt: session.startTime }
            },
            orderBy: {
              startTime: 'desc'
            },
            take: 5
          });
          
          if (previousSessions && previousSessions.length > 0) {
            previousSessionsInfo = `Existem ${previousSessions.length} sessões anteriores registradas com este paciente. A última sessão ocorreu em ${new Date(previousSessions[0].startTime).toLocaleDateString()}.`;
          }
        } catch (prevSessionsError) {
          console.error('Erro ao buscar sessões anteriores:', prevSessionsError);
          // Continuar mesmo sem info das sessões anteriores
        }
        
        // Realizar a chamada à API
        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Você é um assistente especializado na elaboração de relatórios de sessões de terapia.

              Gere um relatório profissional, estruturado e completo com base na transcrição da sessão terapêutica, seguindo as melhores práticas de documentação clínica.
              
              Informações importantes:
              - Nome do paciente: ${patientName}
              - Nome do terapeuta: ${therapistName}
              - Data da sessão: ${session.startTime ? new Date(session.startTime).toLocaleDateString() : 'Data não disponível'}
              - ${previousSessionsInfo}
              
              O relatório deve incluir as seguintes seções:
              
              1. RESUMO DA SESSÃO
              - Breve resumo dos principais tópicos abordados
              
              2. TEMAS PRINCIPAIS
              - Lista e descrição dos principais temas discutidos
              
              3. ESTADO EMOCIONAL E COMPORTAMENTO
              - Observações sobre o estado emocional do paciente durante a sessão
              - Padrões de comportamento relevantes
              
              4. PROGRESSO
              - Avanços e insights alcançados na sessão
              - Relação com objetivos terapêuticos (se evidentes)
              
              5. DESAFIOS E OBSTÁCULOS
              - Principais dificuldades identificadas
              - Resistências ou padrões disfuncionais observados
              
              6. INTERVENÇÕES E TÉCNICAS
              - Abordagens e técnicas utilizadas pelo terapeuta
              - Eficácia das intervenções (quando observável)
              
              7. PLANO E RECOMENDAÇÕES
              - Sugestões para o paciente até a próxima sessão
              - Áreas a focar nas próximas sessões
              - Exercícios ou práticas recomendadas
              
              Formatação:
              - Use linguagem profissional, clara e objetiva
              - Evite jargão excessivo
              - Seja factual e baseado na evidência da transcrição
              - Use marcadores para facilitar a leitura quando apropriado
              - Use cabeçalhos para estruturar o documento
              - Mantenha o relatório conciso mas informativo`
            },
            {
              role: "user",
              content: `Gere um relatório completo para a seguinte sessão de terapia:
              
              ${processedTranscript}`
            }
          ],
          max_tokens: 2000,
        });
        
        const reportText = completion.choices[0].message.content;
        
        // Salvar o relatório no banco de dados
        const savedReport = await prisma.aIInsight.create({
          data: {
            sessionId,
            content: reportText,
            type: 'REPORT',
            keywords: 'relatório, sessão, progresso'
          }
        });
        
        // Responder com o relatório gerado
        res.status(200).json({
          message: 'Relatório gerado com sucesso',
          success: true,
          type: 'report',
          report: reportText,
          data: {
            report: reportText,
            id: savedReport.id
          }
        });
        
      } catch (openaiError) {
        console.error('AI Controller: Erro na chamada da API OpenAI:', openaiError);
        return res.status(500).json({
          message: 'Erro ao processar com a IA',
          error: openaiError.message,
          success: false,
          type: 'report',
          report: 'Ocorreu um erro ao gerar o relatório com a IA. Tente novamente em alguns instantes.'
        });
      }
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
      return res.status(500).json({
        error: 'Erro ao gerar relatório: ' + error.message,
        success: false
      });
    }
  },

  /**
   * Verificar se a API OpenAI está configurada e funcionando
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  checkOpenAI: async (req, res) => {
    try {
      console.log('AI Controller: Verificando configuração da API OpenAI');
      
      // Verificar se a chave da API está configurada
      if (!process.env.OPENAI_API_KEY) {
        console.error('AI Controller: API OpenAI não configurada - chave ausente');
        return res.status(500).json({
          status: 'error',
          message: 'API OpenAI não configurada - chave ausente',
          configured: false
        });
      }
      
      // Testar a conexão com a API OpenAI
      try {
        const testPrompt = "Responda apenas com 'API funcionando': Este é um teste de conectividade.";
        console.log('AI Controller: Testando conexão com OpenAI');
        
        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "Você é um assistente que responde de forma muito concisa."
            },
            {
              role: "user",
              content: testPrompt
            }
          ],
          max_tokens: 20,
        });
        
        const response = completion.choices[0].message.content;
        console.log('AI Controller: Resposta do teste OpenAI:', response);
        
        res.status(200).json({
          status: 'success',
          message: 'API OpenAI configurada e funcionando',
          configured: true,
          test_response: response
        });
      } catch (openaiError) {
        console.error('AI Controller: Erro ao testar API OpenAI:', openaiError);
        return res.status(500).json({
          status: 'error',
          message: 'Erro ao conectar com a API OpenAI',
          error: openaiError.message,
          configured: false
        });
      }
    } catch (error) {
      console.error('Erro ao verificar API OpenAI:', error);
      res.status(500).json({ 
        status: 'error',
        message: 'Erro ao processar solicitação', 
        error: error.message,
        configured: false
      });
    }
  },

  /**
   * Transcrever áudio usando a API Whisper da OpenAI
   * Aceita WAV, MP3 ou outros formatos, mas SEMPRE converte qualquer formato para MP3 limpo
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  transcribeAudio: async (req, res) => {
    // Verificar se há um arquivo na requisição
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Nenhum arquivo de áudio enviado' });
    }

    console.log(`AI Controller: Recebido arquivo para transcrição: ${req.file.originalname}, tamanho: ${req.file.size} bytes, tipo: ${req.file.mimetype}`);
    
    let originalFilePath = req.file.path;
    let convertedFilePath = null;
    
    try {
      // Não criar cópias extras, usar apenas o arquivo original para conversão
      console.log('Detalhes do arquivo:');
      console.log(`- Caminho: ${originalFilePath}`);
      console.log(`- Nome: ${req.file.originalname}`);
      console.log(`- Tamanho: ${(req.file.size / 1024).toFixed(2)} KB`);
      console.log(`- MIME Type: ${req.file.mimetype}`);
      
      // Verificar tamanho mínimo do arquivo
      if (req.file.size < 500) {
        console.error('AI Controller: Arquivo de áudio muito pequeno, provavelmente corrompido');
        return res.status(400).json({ 
          success: false, 
          message: 'Arquivo de áudio muito pequeno ou possivelmente corrompido'
        });
      }
      
      // IMPORTANTE: SEMPRE converter para MP3 limpo com configurações exatas
      // independente do formato original
      convertedFilePath = originalFilePath + '_converted.mp3';
      console.log(`SEMPRE convertendo para MP3 limpo: ${originalFilePath} -> ${convertedFilePath}`);
      
      try {
        // Converter para MP3 limpo usando FFmpeg com configurações otimizadas para voz
        await new Promise((resolve, reject) => {
          ffmpeg(originalFilePath)
            .outputOptions([
              '-y',                 // Substituir arquivo existente
              '-acodec libmp3lame', // Usar codec MP3
              '-ac 1',              // Mono (crucial para Whisper)
              '-ar 16000',          // 16 kHz (ideal para reconhecimento de voz)
              '-b:a 64k',           // 64 kbps (suficiente para voz)
              '-write_xing 0',      // Não escrever cabeçalhos VBR Xing/Info
              '-id3v2_version 0'    // Não incluir metadados ID3
            ])
            .on('start', (commandLine) => {
              console.log('FFmpeg iniciou com o comando:', commandLine);
            })
            .on('progress', (progress) => {
              if (progress.percent) {
                console.log(`FFmpeg progresso: ${progress.percent.toFixed(1)}% concluído`);
              }
            })
            .on('end', () => {
              console.log('FFmpeg: Conversão para MP3 concluída com sucesso');
              resolve();
            })
            .on('error', (err) => {
              console.error('Erro ao converter áudio:', err);
              reject(err);
            })
            .save(convertedFilePath);
        });
        
        // Verificar se o arquivo convertido foi criado e tem tamanho adequado
        if (!fs.existsSync(convertedFilePath) || fs.statSync(convertedFilePath).size < 500) {
          throw new Error('Arquivo convertido não foi criado ou está vazio');
        }
        
        console.log(`Arquivo convertido com sucesso: ${convertedFilePath} (${fs.statSync(convertedFilePath).size} bytes)`);
      } catch (conversionError) {
        console.error('Erro na conversão do áudio:', conversionError);
        return res.status(500).json({ 
          success: false, 
          message: 'Erro ao converter o formato de áudio',
          details: conversionError.message
        });
      }
      
      console.log(`AI Controller: Enviando ${convertedFilePath} para a API Whisper`);
      
      // Preparar request para OpenAI
      const formData = new FormData();
      formData.append('file', fs.createReadStream(convertedFilePath));
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('language', 'pt');
      
      // Enviar para a API Whisper
      const openaiResponse = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      
      if (!openaiResponse.data || !openaiResponse.data.text) {
        console.error('AI Controller: Resposta da API Whisper sem texto:', openaiResponse.data);
        return res.status(500).json({ 
          success: false, 
          message: 'Resposta da API Whisper sem texto'
        });
      }
      
      const transcription = openaiResponse.data.text.trim();
      console.log(`AI Controller: Transcrição obtida (${transcription.length} caracteres)`);
      
      // Se transcription for vazio, retornar erro
      if (!transcription || transcription.length === 0) {
        console.error('AI Controller: Transcrição vazia recebida da API Whisper');
        return res.status(500).json({ 
          success: false, 
          message: 'Nenhum texto reconhecido no áudio'
        });
      }
      
      // Filtrar texto indesejado das transcrições
      const cleanedTranscription = transcription
        .replace(/tamara\.org/gi, '') // Remover "tamara.org"
        .replace(/w{3}\.[\w\-\.]+\.(?:com|org|net)/gi, '') // Remover qualquer URL comum 
        .replace(/\s{2,}/g, ' ') // Substituir múltiplos espaços por um único
        .trim();
      
      console.log(`AI Controller: Transcrição filtrada: ${cleanedTranscription}`);
      
      const responseData = {
        success: true,
        text: cleanedTranscription,
        format: openaiResponse.data.language || 'pt',
        duration: openaiResponse.data.duration || 0
      };
      
      // Salvar transcrição se tiver sessionId
      if (req.body.sessionId) {
        try {
          const sessionId = req.body.sessionId;
          const speaker = req.body.speaker || 'undefined';
          
          // Adicionar à transcrição no banco
          await prisma.sessionTranscript.create({
            data: {
              sessionId,
              speaker,
              content: cleanedTranscription,
              timestamp: new Date()
            }
          });
          
          console.log(`AI Controller: Transcrição salva para a sessão ${sessionId}, falante ${speaker}`);
        } catch (dbError) {
          console.error('AI Controller: Erro ao salvar transcrição no banco:', dbError);
          // Continuar apesar do erro no banco
        }
      }
      
      return res.json(responseData);
    } catch (error) {
      console.error('AI Controller: Erro ao transcrever áudio:', error);
      
      // Detectar erro específico de formato
      const errorMessage = error.response?.data?.error?.message || error.message;
      if (errorMessage.includes('format') || errorMessage.includes('decode')) {
        console.error('AI Controller: Erro de formato de áudio detectado:', errorMessage);
        return res.status(400).json({ 
          success: false, 
          message: 'Formato de áudio inválido ou não suportado pela API Whisper',
          details: errorMessage
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Erro ao transcrever áudio', 
        error: error.message
      });
    } finally {
      // Limpar arquivos temporários
      try {
        // Aguardar um momento para garantir que todos os streams estejam fechados
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Remover o arquivo original
        if (originalFilePath && fs.existsSync(originalFilePath)) {
          fs.unlinkSync(originalFilePath);
          console.log(`Arquivo original removido: ${originalFilePath}`);
        }
        
        // Remover o arquivo convertido
        if (convertedFilePath && fs.existsSync(convertedFilePath)) {
          fs.unlinkSync(convertedFilePath);
          console.log(`Arquivo convertido removido: ${convertedFilePath}`);
        }
      } catch (cleanupError) {
        console.error('Erro ao remover arquivos temporários:', cleanupError.message);
      }
    }
  },

  /**
   * Obter relatório de uso de tokens
   * @param {Request} req - Requisição Express
   * @param {Response} res - Resposta Express
   */
  getTokenUsage: async (req, res) => {
    try {
      const report = tokenUsageService.getUsageReport();
      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      console.error('Erro ao obter relatório de uso de tokens:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao obter relatório de uso de tokens',
        error: error.message
      });
    }
  },

  /**
   * @api {post} /api/ai/emotion/analyze Analisa emoções em áudio
   * @apiName AnalyzeEmotionInAudio
   * @apiGroup AI
   * @apiDescription Analisa um arquivo de áudio para detectar emoções e tom de voz
   * 
   * @apiParam {File} audio Arquivo de áudio para análise
   * @apiParam {Boolean} [analyzeEmotion=true] Se deve analisar emoções
   * @apiParam {Boolean} [analyzeTone=true] Se deve analisar tom de voz
   * @apiParam {String} [language=pt] Idioma do áudio
   * 
   * @apiSuccess {Object} emotions Informações sobre emoções detectadas
   * @apiSuccess {Object} emotions.dominant Emoção dominante
   * @apiSuccess {String} emotions.dominant.label Nome da emoção
   * @apiSuccess {Number} emotions.dominant.confidence Nível de confiança [0-1]
   * @apiSuccess {Array} emotions.all Lista de todas as emoções detectadas
   * @apiSuccess {Object} tones Informações sobre tons de voz detectados
   * @apiSuccess {Object} tones.dominant Tom dominante
   * @apiSuccess {String} tones.dominant.label Nome do tom
   * @apiSuccess {Number} tones.dominant.confidence Nível de confiança [0-1]
   * @apiSuccess {Array} tones.all Lista de todos os tons detectados
   */
  analyzeEmotionInAudio: async (req, res) => {
    try {
      // Verificar se foi enviado um arquivo
      if (!req.files || !req.files.audio) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum arquivo de áudio enviado. Use o campo "audio" para enviar o arquivo.'
        });
      }
      
      // Obter o arquivo de áudio
      const audioFile = req.files.audio;
      
      // Verificar tipo de arquivo
      const validMimeTypes = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      
      // Se o tipo não for reconhecido automaticamente, tentar inferir pela extensão
      let mimeType = audioFile.mimetype;
      if (!validMimeTypes.includes(mimeType)) {
        const extension = audioFile.name.split('.').pop().toLowerCase();
        
        if (extension === 'wav') mimeType = 'audio/wav';
        else if (extension === 'mp3') mimeType = 'audio/mpeg';
        else if (extension === 'webm') mimeType = 'audio/webm';
        else if (extension === 'ogg') mimeType = 'audio/ogg';
        else if (extension === 'mp4') mimeType = 'audio/mp4';
      }
      
      // Validar tipo de arquivo
      if (!validMimeTypes.includes(mimeType)) {
        return res.status(400).json({
          success: false,
          message: `Tipo de arquivo não suportado: ${mimeType}. Tipos suportados: WAV, MP3, WebM, OGG, MP4.`
        });
      }
      
      // Obter opções da requisição
      const options = {
        analyzeEmotion: req.body.analyzeEmotion !== 'false',
        analyzeTone: req.body.analyzeTone !== 'false',
        language: req.body.language || 'pt',
        processingId: req.body.processingId || `proc_${Date.now()}`
      };
      
      // Analisar emoções no áudio
      const analysisResult = await emotionAnalysisService.analyzeAudio(
        audioFile.data,
        options
      );
      
      // Retornar resultado
      return res.status(200).json({
        success: true,
        emotions: options.analyzeEmotion ? analysisResult.emotions : undefined,
        tones: options.analyzeTone ? analysisResult.tones : undefined,
        processingId: options.processingId
      });
    } catch (error) {
      logger.error(`Erro ao analisar emoções em áudio: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Erro ao processar análise de emoção',
        error: error.message
      });
    }
  },
};

// Exportar as funções para testes
module.exports = {
  ...aiController,
  
  // Exportar funções auxiliares apenas para teste
  // Em produção, estas exportações adicionais serão ignoradas
  estimateTokens,
  preprocessLongTranscript
}; 