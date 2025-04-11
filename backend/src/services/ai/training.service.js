const { OpenAI } = require('openai');
const prisma = require('../../utils/prisma');
const { createLogger } = require('../../utils/logger');
const logger = createLogger('training-service');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');
const embeddingService = require('./embedding.service');
const openaiService = require('./openai.service');

class TrainingService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Adiciona um material de treinamento
   * @param {Object} material - Dados do material
   */
  async addTrainingMaterial(material) {
    try {
      const newMaterial = await prisma.trainingMaterial.create({
        data: {
          title: material.title,
          content: material.content,
          type: material.type,
          categories: material.categories || [],
          videoUrl: material.videoUrl,
          isVideoTranscription: material.isVideoTranscription || false,
          documentPath: material.documentPath,
          documentName: material.documentName,
          documentType: material.documentType,
          userId: material.userId
        }
      });

      logger.info(`Material de treinamento adicionado: ${newMaterial.id}`);
      return newMaterial;
    } catch (error) {
      logger.error('Erro ao adicionar material:', error);
      throw error;
    }
  }

  /**
   * Divide texto em pedaços menores para processamento
   * @param {string} text - Texto a ser dividido
   * @param {number} chunkSize - Tamanho máximo de cada pedaço
   */
  splitTextIntoChunks(text, chunkSize) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + chunkSize));
      i += chunkSize;
    }
    return chunks;
  }

  /**
   * Sintetiza insights de múltiplos pedaços de texto
   * @param {string[]} insights - Lista de insights a serem sintetizados
   * @param {string} title - Título do material
   */
  async synthesizeInsights(insights, title) {
    try {
      const combinedInsights = insights.join('\n\n--- PRÓXIMO SEGMENTO ---\n\n');
      
      const prompt = `
        Abaixo estão insights extraídos de diferentes partes do documento "${title}".
        Sintetize-os em um único conjunto coerente de insights, removendo redundâncias
        e organizando em tópicos claros.

        ${combinedInsights}
      `;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Você é um especialista em sintetizar informações de documentos técnicos e educacionais."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500
      });

      return completion.choices[0].message.content;
    } catch (error) {
      logger.error('Erro ao sintetizar insights:', error);
      return `Síntese dos insights extraídos:\n\n${insights.join('\n\n')}`;
    }
  }

  /**
   * Processa um material com a IA para extrair insights e padrões
   * @param {string} materialId - ID do material
   */
  async processMaterial(materialId) {
    try {
      const material = await prisma.trainingMaterial.findUnique({
        where: { id: materialId }
      });

      if (!material) {
        throw new Error('Material não encontrado');
      }

      let insights = '';
      
      logger.info(`Iniciando processamento de material: ${materialId}, tipo: ${material.type}`);
      
      // Processamento específico para vídeos do YouTube
      if (material.type === 'VIDEO_YOUTUBE' && material.videoUrl) {
        try {
          // Extrair informações do vídeo
          const videoInfo = await ytdl.getInfo(material.videoUrl);
          const transcript = await this.extractYouTubeTranscript(material.videoUrl);
          
          // Gerar insights baseados no vídeo e transcrição
          insights = await this.generateVideoInsights({
            title: videoInfo.videoDetails.title,
            description: videoInfo.videoDetails.description,
            transcript: transcript,
            duration: videoInfo.videoDetails.lengthSeconds,
            category: material.categories[0] || 'Geral'
          });
        } catch (error) {
          logger.error('Erro ao processar vídeo do YouTube:', error);
          insights = 'Não foi possível extrair insights do vídeo. Verifique se o vídeo tem legendas disponíveis.';
        }
      } 
      // Processamento específico para documentos
      else if (['DOCUMENT_PDF', 'DOCUMENT_TXT', 'DOCUMENT_DOCX'].includes(material.type)) {
        try {
          // Verificar se temos conteúdo extraído
          if (!material.content || material.content.length < 100) {
            logger.info(`Conteúdo insuficiente para o material ${materialId}, tentando extrair do arquivo original`);
            
            // Se o conteúdo está vazio ou muito pequeno, tentar extrair do arquivo diretamente
            if (material.documentPath && fs.existsSync(material.documentPath)) {
              logger.info(`Arquivo encontrado: ${material.documentPath}`);
              
              // Processar documentos DOCX com mammoth
              if (material.type === 'DOCUMENT_DOCX' || 
                  material.documentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                  material.documentType === 'application/msword') {
                try {
                  logger.info(`Extraindo texto do documento Word: ${material.documentName}`);
                  const result = await mammoth.extractRawText({ path: material.documentPath });
                  
                  if (result && result.value) {
                    material.content = result.value;
                    logger.info(`Texto extraído com sucesso do Word (${result.value.length} caracteres)`);
                    
                    // Atualizar o material com o conteúdo extraído
                    await prisma.trainingMaterial.update({
                      where: { id: materialId },
                      data: { 
                        content: material.content 
                      }
                    });
                    
                    logger.info(`Conteúdo do documento Word atualizado no banco de dados: ${materialId}`);
                  } else {
                    logger.error(`Falha ao extrair conteúdo do Word - resultado vazio ou nulo`);
                  }
                } catch (docxError) {
                  logger.error('Erro ao extrair texto do documento Word:', docxError);
                  throw new Error(`Erro específico do processamento Word: ${docxError.message}`);
                }
              }
              // Processar PDFs como fallback, caso não tenha sido processado no controller
              else if (material.type === 'DOCUMENT_PDF' || 
                       material.documentType === 'application/pdf') {
                try {
                  logger.info(`Tentativa adicional de extração do PDF: ${material.documentName}`);
                  
                  // Primeira tentativa usando pdf-parse
                  try {
                    const dataBuffer = fs.readFileSync(material.documentPath);
                    const pdfData = await pdf(dataBuffer);
                    
                    if (pdfData && pdfData.text && pdfData.text.length > 100) {
                      material.content = pdfData.text;
                      logger.info(`Texto extraído com sucesso do PDF usando pdf-parse (${material.content.length} caracteres)`);
                    } else {
                      logger.warn(`Extração com pdf-parse resultou em texto insuficiente (${pdfData?.text?.length || 0} caracteres), tentando método alternativo`);
                      
                      // Segunda tentativa usando pdf-lib
                      const pdfBytes = fs.readFileSync(material.documentPath);
                      const pdfDoc = await PDFDocument.load(pdfBytes);
                      const numPages = pdfDoc.getPageCount();
                      
                      logger.info(`PDF carregado com pdf-lib. Total de páginas: ${numPages}`);
                      
                      // Extrair texto usando método alternativo (caracteres das páginas)
                      let extractedText = '';
                      for (let i = 0; i < numPages; i++) {
                        const page = pdfDoc.getPage(i);
                        const text = `Conteúdo da página ${i+1}: ${page.getContentStream()}`;
                        extractedText += text + '\n\n';
                      }
                      
                      if (extractedText.length > 100) {
                        material.content = extractedText;
                        logger.info(`Texto extraído com sucesso do PDF usando pdf-lib (${extractedText.length} caracteres)`);
                      } else {
                        // Se ainda não conseguimos texto suficiente, usar o caminho do arquivo diretamente
                        logger.warn(`Extração com pdf-lib também resultou em texto insuficiente, usando caminho do arquivo como referência`);
                        material.content = `Este é um documento PDF com ${numPages} páginas. Por favor, consulte o arquivo original em: ${material.documentPath}`;
                      }
                    }
                    
                    // Atualizar o material com o conteúdo extraído
                    await prisma.trainingMaterial.update({
                      where: { id: materialId },
                      data: { 
                        content: material.content 
                      }
                    });
                    
                    logger.info(`Conteúdo do PDF atualizado no banco de dados: ${materialId}`);
                  } catch (pdfParseError) {
                    logger.error('Erro ao extrair texto do PDF com pdf-parse:', pdfParseError);
                    throw new Error(`Erro no processamento PDF com pdf-parse: ${pdfParseError.message}`);
                  }
                } catch (pdfError) {
                  logger.error('Erro ao extrair texto do PDF:', pdfError);
                  throw new Error(`Erro específico do processamento PDF: ${pdfError.message}`);
                }
              }
            } else {
              logger.error(`Arquivo não encontrado no caminho: ${material.documentPath}`);
              throw new Error('Arquivo do documento não encontrado ou inacessível');
            }
          }
          
          // Agora verificar novamente se temos conteúdo suficiente
          if (material.content && material.content.length > 100) {
            logger.info(`Conteúdo suficiente para processamento (${material.content.length} caracteres)`);
            
            // Dividir o conteúdo em partes menores se for muito grande
            if (material.content.length > 16000) {
              logger.info(`Conteúdo grande, dividindo em partes menores (total: ${material.content.length} caracteres)`);
              const chunks = this.splitTextIntoChunks(material.content, 8000);
              logger.info(`Documento dividido em ${chunks.length} partes`);
              
              let allInsights = [];
              
              // Processar cada parte e concatenar os resultados
              for (let i = 0; i < chunks.length; i++) {
                logger.info(`Processando parte ${i+1} de ${chunks.length}`);
                const chunkInsight = await this.extractInsights(
                  chunks[i], 
                  `Parte ${i+1} de ${chunks.length} - ${material.title}`
                );
                allInsights.push(chunkInsight);
                logger.info(`Parte ${i+1} processada com sucesso`);
              }
              
              // Sintetizar os insights de todos os chunks
              logger.info(`Sintetizando insights de ${allInsights.length} partes`);
              insights = await this.synthesizeInsights(allInsights, material.title);
              logger.info(`Sintetização concluída com sucesso`);
            } else {
              logger.info(`Processando documento inteiro como uma única parte`);
              insights = await this.extractInsights(material.content, material.title);
              logger.info(`Documento processado com sucesso`);
            }
          } else {
            logger.error(`Conteúdo insuficiente após tentativa de extração (${material.content?.length || 0} caracteres)`);
            insights = 'Não foi possível extrair conteúdo suficiente do documento. Por favor, verifique se o formato do arquivo é suportado ou adicione o conteúdo manualmente.';
          }
        } catch (error) {
          logger.error(`Erro ao processar documento: ${error.message}`, error);
          insights = `Erro ao processar o documento: ${error.message}. Verifique se o formato é suportado.`;
        }
      }
      else {
        // Processamento padrão para outros tipos de material
        logger.info(`Usando processamento padrão para tipo: ${material.type}`);
        insights = await this.extractInsights(material.content);
        logger.info(`Processamento padrão concluído com sucesso`);
      }
      
      // Atualizar o material com os insights
      await prisma.trainingMaterial.update({
        where: { id: materialId },
        data: {
          insights: insights,
          status: 'processed'
        }
      });
      
      logger.info(`Material ${materialId} atualizado com insights e marcado como processado`);

      // Gerar embedding para o material processado
      try {
        logger.info(`Gerando embedding para o material ${materialId}`);
        await embeddingService.updateMaterialEmbedding(materialId);
        logger.info(`Embedding gerado com sucesso para o material ${materialId}`);
      } catch (embeddingError) {
        logger.error(`Erro ao gerar embedding para o material ${materialId}:`, embeddingError);
        // Continuar mesmo se houver erro no embedding
      }

      return insights;
    } catch (error) {
      logger.error(`Erro geral ao processar material ${materialId}:`, error);
      
      // Atualizar status para error
      try {
        await prisma.trainingMaterial.update({
          where: { id: materialId },
          data: {
            status: 'error',
            insights: `Erro durante o processamento: ${error.message}`
          }
        });
        logger.info(`Status do material ${materialId} atualizado para 'error'`);
      } catch (updateError) {
        logger.error(`Erro ao atualizar status do material ${materialId}:`, updateError);
      }
      
      throw error;
    }
  }

  /**
   * Extrai a transcrição de um vídeo do YouTube
   * @param {string} videoUrl - URL do vídeo do YouTube
   */
  async extractYouTubeTranscript(videoUrl) {
    try {
      const videoInfo = await ytdl.getInfo(videoUrl);
      const transcript = await ytdl.getTranscript(videoInfo.videoDetails.videoId);
      return transcript.map(item => item.text).join(' ');
    } catch (error) {
      logger.error('Erro ao extrair transcrição do YouTube:', error);
      return '';
    }
  }

  /**
   * Gera insights específicos para vídeos
   * @param {Object} videoData - Dados do vídeo
   */
  async generateVideoInsights(videoData) {
    try {
      const prompt = `
        Analise o seguinte vídeo e extraia informações detalhadas:

        Título: ${videoData.title}
        Duração: ${Math.floor(videoData.duration / 60)} minutos
        Categoria: ${videoData.category}
        
        Transcrição:
        ${videoData.transcript}

        Por favor, forneça uma análise estruturada incluindo:
        1. Resumo do conteúdo principal
        2. Principais conceitos e teorias apresentados
        3. Técnicas e metodologias mencionadas
        4. Pontos-chave para prática clínica
        5. Exemplos práticos ou casos mencionados
        6. Referências importantes
        7. Pontos de atenção ou considerações
        8. Sugestões de aplicação prática
        9. Recursos adicionais recomendados
        10. Temas relacionados para aprofundamento

        Formate a resposta em seções claras e bem organizadas.
      `;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Você é um especialista em análise de conteúdo terapêutico e educacional, com foco em vídeos de treinamento."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      });

      return completion.choices[0].message.content;
    } catch (error) {
      logger.error('Erro ao gerar insights do vídeo:', error);
      throw error;
    }
  }

  /**
   * Extrai insights do conteúdo usando a IA
   * @param {string} content - Conteúdo do material
   * @param {string} contextTitle - Título do contexto (opcional)
   */
  async extractInsights(content, contextTitle = null) {
    try {
      const titleContext = contextTitle ? `Contexto: ${contextTitle}\n\n` : '';
      
      const prompt = `
        ${titleContext}Analise o seguinte conteúdo e extraia:
        1. Principais conceitos e teorias
        2. Técnicas e metodologias mencionadas
        3. Casos de exemplo
        4. Recomendações práticas
        5. Pontos de atenção
        6. Referências importantes
        
        Conteúdo:
        ${content}
      `;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Você é um especialista em análise de conteúdo terapêutico e educacional."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      return completion.choices[0].message.content;
    } catch (error) {
      logger.error('Erro ao extrair insights:', error);
      throw error;
    }
  }

  /**
   * Busca materiais de treinamento por categoria
   * @param {string} category - Categoria dos materiais
   */
  async getMaterialsByCategory(category) {
    try {
      console.log(`TrainingService: Buscando materiais para categoria '${category}'`);
      
      return await prisma.trainingMaterial.findMany({
        where: {
          categories: {
            has: category
          },
          status: 'processed'
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    } catch (error) {
      console.error('TrainingService: Erro ao buscar materiais:', error);
      return [];
    }
  }

  /**
   * Realiza uma busca semântica por materiais relevantes ao texto fornecido
   * @param {string} text - Texto para buscar materiais relevantes
   * @param {number} limit - Número máximo de resultados
   * @returns {Promise<Array>} Materiais relevantes
   */
  async searchSemanticMaterials(text, limit = 5) {
    try {
      logger.info(`TrainingService: Iniciando busca semântica para texto: "${text.substring(0, 50)}..."`);
      
      // Usar o serviço de embeddings para realizar a busca semântica
      const results = await embeddingService.searchSimilarMaterials(text, limit, 0.65);
      
      logger.info(`TrainingService: Busca semântica retornou ${results.length} resultados`);
      return results;
    } catch (error) {
      logger.error('TrainingService: Erro na busca semântica:', error);
      // Retornar array vazio em caso de erro
      return [];
    }
  }

  /**
   * Usa os materiais treinados para melhorar a análise de uma sessão
   * @param {string} sessionContent - Conteúdo da sessão
   * @param {string[]} categories - Categorias da sessão
   */
  async enhanceSessionAnalysis(sessionContent, categories) {
    try {
      console.log(`TrainingService: Iniciando enhanceSessionAnalysis com ${categories?.length || 0} categorias`);
      
      // Verificar se temos categorias
      if (!categories || categories.length === 0) {
        console.log('TrainingService: Nenhuma categoria especificada, tentando busca semântica');
        
        // Se não temos categorias, tentar busca semântica
        const semanticResults = await this.searchSemanticMaterials(sessionContent, 5);
        
        if (semanticResults.length > 0) {
          console.log(`TrainingService: Busca semântica encontrou ${semanticResults.length} materiais relevantes`);
          
          // Combina insights dos materiais com o conteúdo da sessão
          const materialsContext = semanticResults
            .map(m => `Título: ${m.title}\nInsights: ${m.insights || 'Sem insights disponíveis'}\nRelevância: ${Math.round(m.similarity * 100)}%\n`)
            .join('\n\n');

          console.log(`TrainingService: Gerando análise com ${semanticResults.length} materiais da busca semântica`);
          
          const prompt = `
            Analise a seguinte sessão considerando os insights dos materiais de treinamento:
            
            Materiais Relevantes Encontrados via Busca Semântica:
            ${materialsContext}
            
            Conteúdo da Sessão:
            ${sessionContent}
            
            Forneça uma análise detalhada da sessão, considerando:
            1. Temas principais discutidos
            2. Padrões emocionais observados
            3. Possíveis questões subjacentes
            4. Progresso em relação a sessões anteriores (se mencionado)
            5. Pontos importantes para acompanhamento
            6. Aplicação de conceitos e técnicas dos materiais de referência
            
            Formate a resposta de maneira clara, estruturada e profissional.
          `;

          const completion = await this.openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "Você é um especialista em análise de sessões terapêuticas com conhecimento profundo dos materiais de treinamento."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 1000
          });

          console.log('TrainingService: Análise enriquecida gerada com sucesso via busca semântica');
          return completion.choices[0].message.content;
        } else {
          console.log('TrainingService: Busca semântica não encontrou materiais, retornando análise padrão');
          return this.generateFallbackAnalysis(sessionContent);
        }
      }
      
      // Busca materiais relevantes para todas as categorias
      const relevantMaterialsPromises = categories.map(category => 
        this.getMaterialsByCategory(category)
      );
      
      const relevantMaterialsArrays = await Promise.all(relevantMaterialsPromises);
      // Remover duplicatas e materiais vazios (usar Set para IDs únicos)
      const materialIds = new Set();
      const relevantMaterials = [];
      
      relevantMaterialsArrays.flat().forEach(material => {
        if (material && !materialIds.has(material.id)) {
          materialIds.add(material.id);
          relevantMaterials.push(material);
        }
      });
      
      console.log(`TrainingService: Encontrados ${relevantMaterials.length} materiais relevantes`);
      
      // Se não encontrou materiais por categoria, tentar busca semântica
      if (relevantMaterials.length === 0) {
        console.log('TrainingService: Nenhum material encontrado por categoria, tentando busca semântica');
        
        const semanticResults = await this.searchSemanticMaterials(sessionContent, 5);
        
        if (semanticResults.length > 0) {
          console.log(`TrainingService: Busca semântica encontrou ${semanticResults.length} materiais relevantes`);
          
          // Combina insights dos materiais com o conteúdo da sessão
          const materialsContext = semanticResults
            .map(m => `Título: ${m.title}\nInsights: ${m.insights || 'Sem insights disponíveis'}\nRelevância: ${Math.round(m.similarity * 100)}%\n`)
            .join('\n\n');

          console.log(`TrainingService: Gerando análise com ${semanticResults.length} materiais da busca semântica`);
          
          const prompt = `
            Analise a seguinte sessão considerando os insights dos materiais de treinamento:
            
            Categorias da Sessão: ${categories.join(', ')}
            
            Materiais Relevantes Encontrados via Busca Semântica:
            ${materialsContext}
            
            Conteúdo da Sessão:
            ${sessionContent}
            
            Forneça uma análise detalhada da sessão, considerando:
            1. Temas principais discutidos
            2. Padrões emocionais observados
            3. Possíveis questões subjacentes
            4. Progresso em relação a sessões anteriores (se mencionado)
            5. Pontos importantes para acompanhamento
            6. Aplicação de conceitos e técnicas dos materiais de referência
            
            Formate a resposta de maneira clara, estruturada e profissional.
          `;

          const completion = await this.openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "Você é um especialista em análise de sessões terapêuticas com conhecimento profundo dos materiais de treinamento."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 1000
          });

          console.log('TrainingService: Análise enriquecida gerada com sucesso via busca semântica');
          return completion.choices[0].message.content;
        } else {
          console.log('TrainingService: Não foram encontrados materiais via busca semântica, retornando análise padrão');
          return this.generateFallbackAnalysis(sessionContent);
        }
      }
      
      // Limitar o número de materiais para não exceder o limite de tokens
      const maxMaterials = 5;
      const selectedMaterials = relevantMaterials.slice(0, maxMaterials);
      
      // Combina insights dos materiais com o conteúdo da sessão
      const materialsContext = selectedMaterials
        .map(m => `Título: ${m.title}\nInsights: ${m.insights || 'Sem insights disponíveis'}\n`)
        .join('\n\n');

      console.log(`TrainingService: Gerando análise com ${selectedMaterials.length} materiais`);
      
      const prompt = `
        Analise a seguinte sessão considerando os insights dos materiais de treinamento:
        
        Categorias da Sessão: ${categories.join(', ')}
        
        Materiais de Referência:
        ${materialsContext}
        
        Conteúdo da Sessão:
        ${sessionContent}
        
        Forneça uma análise detalhada da sessão, considerando:
        1. Temas principais discutidos
        2. Padrões emocionais observados
        3. Possíveis questões subjacentes
        4. Progresso em relação a sessões anteriores (se mencionado)
        5. Pontos importantes para acompanhamento
        6. Aplicação de conceitos e técnicas dos materiais de referência
        
        Formate a resposta de maneira clara, estruturada e profissional.
      `;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Você é um especialista em análise de sessões terapêuticas com conhecimento profundo dos materiais de treinamento."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      console.log('TrainingService: Análise enriquecida gerada com sucesso');
      return completion.choices[0].message.content;
    } catch (error) {
      console.error('TrainingService: Erro ao melhorar análise da sessão:', error);
      return this.generateFallbackAnalysis(sessionContent);
    }
  }
  
  /**
   * Gera uma análise padrão quando não há materiais relevantes
   * @param {string} sessionContent - Conteúdo da sessão
   */
  async generateFallbackAnalysis(sessionContent) {
    try {
      console.log('TrainingService: Gerando análise padrão sem materiais');
      
      const prompt = `
        Analise a seguinte transcrição de sessão de terapia e forneça insights sobre:
        1. Temas principais discutidos
        2. Padrões emocionais observados
        3. Possíveis questões subjacentes
        4. Progresso em relação a sessões anteriores (se mencionado)
        5. Pontos importantes para acompanhamento
        
        Conteúdo da Sessão:
        ${sessionContent}
        
        Formate a resposta de maneira clara, concisa e profissional.
      `;
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "Você é um especialista em análise de sessões terapêuticas."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });
      
      return completion.choices[0].message.content;
    } catch (error) {
      console.error('TrainingService: Erro ao gerar análise padrão:', error);
      throw error;
    }
  }
}

module.exports = new TrainingService(); 