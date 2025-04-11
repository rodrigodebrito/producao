# TerapiaConect - Implementação do Sistema de Transcrição WebRTC

Este documento detalha a implementação do sistema de transcrição em tempo real "Transcrever Agora" da plataforma TerapiaConect, que permite aos terapeutas solicitar transcrições parciais durante uma sessão sem interromper a gravação.

## Visão Geral da Arquitetura

O sistema de transcrição é composto por:

1. **Frontend**: Interface de usuário com botão "Transcrever Agora" que solicita transcrições parciais
2. **Serviço WebRTC (frontend)**: Responsável pela comunicação com o backend para envio de áudio
3. **Serviço WebRTC (backend)**: Gerencia sessões, captura de áudio e processamento
4. **Serviço OpenAI**: Utiliza o modelo Whisper para transcrição de áudio para texto

## Problemas Encontrados e Soluções Aplicadas

### 1. Problema: URLs de API com Prefixo Duplicado (404 Not Found)

**Problema**: O serviço WebRTC frontend estava gerando URLs de API com prefixo "/api" duplicado, resultando em erros 404.

**Solução**: Implementamos o método `_buildApiUrl()` para lidar com diferentes formatos de URL base:

```javascript
_buildApiUrl(path) {
  // Remover barras iniciais duplicadas
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  
  // Construir URL corretamente com base na configuração
  if (API_URL.endsWith('/api')) {
    return `${API_URL}/${cleanPath}`;
  } else if (API_URL.includes('/api/')) {
    return `${API_URL.split('/api/')[0]}/api/${cleanPath}`;
  } else {
    return `${API_URL}/api/${cleanPath}`;
  }
}
```

### 2. Problema: Falhas de Autenticação (401 Unauthorized)

**Problema**: As chamadas de API estavam falhando com erro 401 por falta de autenticação.

**Solução**: Implementamos a recuperação do token de autenticação de múltiplas fontes possíveis:

```javascript
_getAuthToken() {
  const token = localStorage.getItem('authToken') || 
               sessionStorage.getItem('authToken') || 
               localStorage.getItem('token') || 
               sessionStorage.getItem('token');
  
  return token;
}
```

### 3. Problema: Formato de Arquivo WAV Inválido

**Problema**: O arquivo WAV gerado não tinha um cabeçalho apropriado para processamento.

**Solução**: Implementamos uma geração mais robusta de cabeçalhos WAV no arquivo `webrtc.service.js` com validação:

```javascript
// Escrever cabeçalho WAV manualmente
const headerBuffer = Buffer.alloc(44);

// RIFF chunk descriptor
headerBuffer.write('RIFF', 0);
headerBuffer.writeUInt32LE(0, 4); // Tamanho total (atualizado depois)
headerBuffer.write('WAVE', 8);

// "fmt " sub-chunk
headerBuffer.write('fmt ', 12);
headerBuffer.writeUInt32LE(16, 16); // Tamanho do sub-chunk fmt
headerBuffer.writeUInt16LE(1, 20); // Formato de áudio (PCM)
headerBuffer.writeUInt16LE(channels, 22); // Número de canais
headerBuffer.writeUInt32LE(sampleRate, 24); // Sample rate
headerBuffer.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28); // Byte rate
headerBuffer.writeUInt16LE(channels * (bitDepth / 8), 32); // Block align
headerBuffer.writeUInt16LE(bitDepth, 34); // Bits per sample

// "data" sub-chunk
headerBuffer.write('data', 36);
headerBuffer.writeUInt32LE(0, 40); // Tamanho dos dados (atualizado depois)
```

### 4. Problema: Arquivo de Áudio Muito Curto

**Problema**: Enfrentamos erros "Audio file is too short" porque não havia dados de áudio suficientes.

**Solução**: Implementamos várias melhorias:

1. **Captura real de áudio dos participantes**
2. **Gerador de tom de teste** (440Hz) quando não há áudio real
3. **Verificação de duração mínima**
4. **Mecanismo para adicionar dados quando os arquivos são muito pequenos**
5. **Atualização apropriada do cabeçalho WAV**

### 5. Problema: Não detecção de participantes reais

**Problema**: O sistema não estava detectando corretamente os participantes reais nas conexões WebRTC, resultando em transcrições vazias.

**Solução**: Implementamos um rastreamento mais robusto de participantes reais:

1. **Contagem explícita de participantes reais**:
   ```javascript
   this.realParticipantCount = (this.realParticipantCount || 0) + 1;
   ```

2. **Marcação de participantes com flags**:
   ```javascript
   participant.isReal = true;
   ```

3. **Monitoramento avançado de streams**:
   ```javascript
   producer.on('score', (score) => {
     // Score é um indicador de qualidade do audio
     logger.debug(`Producer recebendo áudio com qualidade: ${JSON.stringify(score)}`);
     participant.lastActivity = Date.now();
   });
   ```

4. **Detecção e gerenciamento melhores de participantes inativos**

### 6. Problema: Conexões peer-to-peer instáveis

**Problema**: As conexões WebRTC entre participantes não estavam sendo estabelecidas corretamente.

**Solução**: Melhoramos o gerenciamento de conexões e streams de áudio no frontend:

1. **Configurações de áudio de alta qualidade**:
   ```javascript
   const constraints = {
     audio: {
       echoCancellation: true,
       noiseSuppression: true,
       autoGainControl: true,
       sampleRate: 48000,
       sampleSize: 16,
       channelCount: 2
     },
     video: false
   };
   ```

2. **Validação rigorosa das tracks de áudio**:
   ```javascript
   const audioTracks = this.localStream.getAudioTracks();
   if (audioTracks.length === 0) {
     console.warn('Nenhuma track de áudio encontrada no stream local!');
     this.localAudioEnabled = false;
   }
   ```

3. **Métodos de diagnóstico**:
   - `diagnoseConnections()` para identificar problemas
   - `repairConnections()` para consertar problemas automaticamente

### 7. Problema: Texto "Legendas pela comunidade Amara.org" na transcrição

**Problema**: Nas transcrições aparecia o texto "Legendas pela comunidade Amara.org" mesmo quando nenhum participante havia falado algo, gerando confusão.

**Solução**: Identificamos que o problema era causado pelo áudio simulado que o sistema adicionava quando não detectava participantes reais. As seguintes alterações foram implementadas:

1. **Remoção do áudio simulado com textos pré-definidos**:
   ```javascript
   // Código antigo removido:
   if (participantCount === 0 || this.realParticipantCount === 0) {
     logger.info('Nenhum participante real encontrado, adicionando input virtual para garantir dados de áudio');
     
     // Criar um input para áudio silencioso/teste
     const virtualInput = this.audioMixer.input({
       channels: 2,
       volume: 50,
       bitDepth: 16,
       sampleRate: 48000,
       name: 'virtual-participant'
     });
     
     this.virtualInput = virtualInput;
     this._simulateAudioData(virtualInput, 'virtual');
   }
   ```

2. **Substituição por espera por participantes reais**:
   ```javascript
   // Novo código:
   logger.info(`Verificando participantes: encontrados ${participantCount} participantes, ${this.realParticipantCount} com áudio real`);
   
   // Não adicionar mais dados simulados de áudio que causam problemas
   // Aguardar pela entrada de áudio real dos participantes
   logger.info(`Inicializando gravação apenas com participantes reais (${this.realParticipantCount})`);
   ```

3. **Uso apenas de áudio silencioso quando necessário**:
   ```javascript
   _simulateAudioData(input, participantId) {
     try {
       // Criar buffer de áudio completamente silencioso
       const buffer = Buffer.alloc(bufferSize);
       
       // Preencher com um silêncio absoluto (zeros)
       // O buffer já está inicializado com zeros, então não precisamos preencher
       logger.info(`Usando silêncio para participante ${participantId}`);
       
       // ... código para enviar dados ...
     }
   }
   ```

Esta mudança garante que o sistema apenas transcreva áudio real dos participantes e não adicione texto simulado ou pré-definido nas transcrições.

### 8. Problema: Não detecção de participantes sem áudio ativo

**Problema**: O sistema não estava reconhecendo participantes conectados como "reais" se eles não enviassem áudio ativo, mesmo estando conectados à sessão.

**Solução**: Implementamos uma lógica melhorada para marcar participantes como reais assim que eles produzem áudio (mesmo sem falar), não apenas quando dados de áudio são detectados:

1. **Identificação imediata como participante real**:
   ```javascript
   // Marcar como participante "real" assim que um producer de áudio é criado
   async produceAudio(participantId, rtpParameters) {
     // ... código existente ...
     
     // Marcar este participante como "real" imediatamente
     participant.isReal = true;
     this.realParticipantCount = (this.realParticipantCount || 0) + 1;
     logger.info(`Participante ${participantId} marcado como real. Total: ${this.realParticipantCount}`);
     
     // ... resto do código ...
   }
   ```

2. **Consistência na contagem de participantes reais**:
   ```javascript
   // Verificar se o participante já está marcado como real antes de incrementar
   if (!participant.isReal) {
     participant.isReal = true;
     // Incrementar contador apenas se não foi incrementado antes
     this.realParticipantCount = (this.realParticipantCount || 0) + 1;
   }
   ```

Estas mudanças garantem que todos os participantes conectados sejam considerados válidos para transcrição, mesmo sem falar ativamente, eliminando a necessidade de gerar áudio simulado e permitindo que o sistema funcione corretamente com múltiplas janelas abertas.

### 9. Problema: Arquivos de áudio vazios ou muito pequenos

**Problema**: Quando não havia áudio real sendo capturado, os arquivos WAV permaneciam com apenas 44 bytes (tamanho do cabeçalho) e a API Whisper rejeitava esses arquivos com o erro "Audio file is too short. Minimum audio length is 0.1 seconds."

**Solução**: Implementamos duas melhorias complementares:

1. **Adição automática de silêncio mínimo ao iniciar a gravação**:
   ```javascript
   // Adicionar um som mínimo de silêncio (1 segundo) para garantir que o arquivo tenha tamanho mínimo
   logger.info(`Adicionando silêncio mínimo para garantir formato de arquivo válido`);
   this._addMinimumSilence();
   
   // Função que adiciona silêncio
   _addMinimumSilence() {
     // Criar silêncio para 1 segundo
     const dataSize = sampleRate * channels * bytesPerSample * duration;
     const buffer = Buffer.alloc(dataSize);
     
     // Criar input temporário para silêncio
     const silenceInput = this.audioMixer.input({
       channels: 2,
       volume: 1, // Volume mínimo
       bitDepth: 16,
       sampleRate: 48000,
       name: 'silence-minimum'
     });
     
     // Escrever buffer de silêncio
     silenceInput.write(buffer);
   }
   ```

2. **Verificação e correção de arquivos temporários para transcrição**:
   ```javascript
   // Verificar se o arquivo tem dados de áudio suficientes
   if (tempStats.size <= 4096) { // Se for muito pequeno (menos de 4KB)
     logger.warn(`Arquivo temporário muito pequeno, adicionando silêncio mínimo`);
     await this._appendSilenceToTempFile(tempOutputFile);
   }
   ```

Estas alterações garantem que, mesmo quando não há áudio real sendo captado, o sistema sempre gera um arquivo de tamanho suficiente para ser processado pela API Whisper, permitindo que o fluxo de transcrição continue funcionando corretamente.

### 10. Problema: Falha na detecção de participantes em sessões com múltiplas abas

**Problema**: Mesmo com dois participantes conectados (duas abas abertas), o sistema não conseguia detectá-los corretamente:
```
[INFO] [webrtc-service] Verificando participantes: encontrados 0 participantes, 0 com áudio real
```

**Causa raiz**: Análise aprofundada mostrou três problemas específicos:

1. **Incompatibilidade entre eventos Socket.IO**: O frontend emitia `join-session` enquanto o backend estava configurado para ouvir `join-room`.

2. **Dependência incorreta de producers**: A detecção de participantes dependia da existência de producers de áudio, que nem sempre são criados adequadamente quando os participantes se conectam silenciosamente.

3. **Falta de registro explícito**: Participantes que se conectavam ao socket não eram automaticamente registrados na sessão WebRTC.

**Solução**: Implementamos uma abordagem abrangente para resolver o problema:

1. **Registro explícito de participantes**:
   ```javascript
   // Novo método no WebRTC Service
   async registerParticipant(sessionId, participantId) {
     // Criar novo participante
     session.participants.set(participantId, {
       id: participantId,
       producerTransport: null,
       consumerTransport: null,
       producers: new Map(),
       consumers: new Map(),
       inputStream: null,
       isReal: true // Marcar como real mesmo sem producer
     });
     
     // Incrementar contador de participantes reais
     session.realParticipantCount = (session.realParticipantCount || 0) + 1;
   }
   ```

2. **Correção do evento Socket.IO**:
   ```javascript
   // Adicionado handler para join-session no backend
   socket.on('join-session', async (data) => {
     if (data && data.sessionId) {
       // Código para juntar-se à sala
       
       // Registrar participante explicitamente
       await webRTCService.registerParticipant(sessionId, socket.id);
     }
   });
   ```

3. **Melhoria da lógica de contagem de participantes**:
   ```javascript
   // Melhorias na função startRecording
   // Contar todos os participantes conectados, não apenas aqueles com producers
   for (const [participantId, participant] of this.participants.entries()) {
     participantCount++; // Contar todos os participantes conectados
     
     // Tratar tanto participantes com producers quanto sem producers
     if (participant.producers && participant.producers.size > 0) {
       // Processar producers
     } else {
       // Marcar como real mesmo sem producer
       participant.isReal = true;
       this.realParticipantCount++;
     }
   }
   ```

Essas alterações garantem que todos os participantes conectados sejam detectados corretamente, independentemente de terem producers de áudio ativos, permitindo que o sistema de transcrição funcione corretamente com múltiplas abas abertas.

## Fluxo de Funcionamento

1. **Criação da sessão**: Uma sessão WebRTC é criada quando os participantes se conectam à sala de terapia.

2. **Captura de áudio**: O sistema captura áudio real dos participantes ou gera um tom de teste quando necessário.

3. **Quando o terapeuta clica em "Transcrever Agora"**:
   - O frontend faz uma requisição para o endpoint `/api/webrtc/record/transcribe`.
   - O backend cria uma cópia temporária do arquivo de áudio atual.
   - O arquivo é enviado para transcrição usando o modelo Whisper via OpenAI API.
   - A transcrição parcial é retornada ao terapeuta sem interromper a gravação.

## Serviços Principais

### Frontend - webrtcTranscriptionService.js

Responsável por:
- Estabelecer conexões peer-to-peer com outros participantes
- Capturar e enviar streams de áudio
- Autenticar as requisições com token
- Solicitar transcrições parciais
- Monitorar a qualidade das conexões
- Diagnosticar e corrigir problemas de conexão

### Backend - webrtc.service.js

Responsável por:
- Gerenciar sessões WebRTC (classe `WebRTCSession`)
- Detectar participantes reais vs. participantes sem áudio
- Mixar áudio de múltiplos participantes
- Gerar e processar arquivos WAV
- Interface com serviço de transcrição OpenAI
- Tratar casos de falha com mecanismos de recuperação

## Ferramentas de Diagnóstico e Reparo

### Frontend

O serviço WebRTC do frontend inclui ferramentas de diagnóstico avançadas:

1. **diagnoseConnections()**: Gera um relatório detalhado sobre:
   - Status de todas as conexões peer
   - Configurações de áudio local
   - Estado das tracks de áudio
   - Estado dos streams remotos

2. **repairConnections()**: Tenta consertar problemas automaticamente:
   - Restabelece o stream de áudio local se necessário
   - Recria conexões peer problemáticas
   - Corrige configurações de áudio

### Backend

O backend inclui mecanismos de monitoramento:

1. **_monitorOutputFile()**: Verifica se o arquivo de gravação está crescendo
2. **Contagem de participantes reais**: Rastreia ativamente participantes com áudio real
3. **Backup para zero participantes**: Gera tom de teste quando não há áudio real

## Como ampliar e manter o código

### Adicionando novos recursos

1. **Ajuste de qualidade de áudio**: Modificar os parâmetros em `startRecording()`
2. **Suporte a diferentes formatos de áudio**: Implementar conversão
3. **Interface para controlar volume de participantes**: Ampliar a classe `WebRTCSession`
4. **Recursos de diagnóstico visual**: Integrar relatórios do método `diagnoseConnections()`

### Resolvendo problemas comuns

1. **Arquivo WAV corrompido**: Verifique a geração de cabeçalho WAV
2. **Problemas de autenticação**: Confirme que o token está sendo recuperado
3. **Dados de áudio insuficientes**: Ajuste os parâmetros em `_simulateAudioData()`
4. **Erros de API 404**: Verifique a construção de URLs usando `_buildApiUrl()`
5. **Participantes sem áudio detectável**: Use `diagnoseConnections()` para verificar as conexões

### Verificando problemas de conexão

Para verificar problemas em tempo real no console do navegador:

```javascript
// Obter status geral do WebRTC
webrtcTranscriptionService.getStatus()

// Executar diagnóstico detalhado
webrtcTranscriptionService.diagnoseConnections()

// Tentar reparar automaticamente as conexões
webrtcTranscriptionService.repairConnections()
```

## Tecnologias Utilizadas

- **mediasoup**: Para gerenciamento de conexões WebRTC
- **audio-mixer**: Para mixagem de áudio de múltiplos participantes
- **OpenAI Whisper**: Para transcrição de áudio para texto
- **Node.js Streams**: Para processamento eficiente de dados de áudio
- **WebRTC API**: Para comunicação peer-to-peer no navegador

## Próximos Passos Sugeridos

1. Implementar testes automatizados para validar as conexões WebRTC
2. Melhorar o feedback visual para problemas de conexão de áudio
3. Adicionar recursos de filtragem de ruído para melhorar a qualidade da transcrição
4. Implementar um dashboard para monitorar qualidade das conexões em tempo real
5. Adicionar detecção automática e reconexão de participantes perdidos 