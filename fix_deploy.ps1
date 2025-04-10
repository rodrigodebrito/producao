# Script de correção para deploy
Write-Host "=== TerapiaConect - Script de correção para deploy ===" -ForegroundColor Green

# 1. Verificar o arquivo config.js
$configFile = "frontend/src/config.js"
Write-Host "Verificando $configFile..." -ForegroundColor Yellow

$configCorrect = $true
$configContent = Get-Content $configFile -Raw
if (-not ($configContent -match "theraconnect-prd.onrender.com")) {
    Write-Host "PROBLEMA: URL de produção incorreta em $configFile" -ForegroundColor Red
    $configCorrect = $false
}

if ($configCorrect) {
    Write-Host "Config.js parece OK!" -ForegroundColor Green
} else {
    Write-Host "Corrigindo $configFile..." -ForegroundColor Yellow
    
    # Substituir o conteúdo do arquivo por um configuração correta
    $newConfig = @"
// Configuração global da aplicação

// Determinar o ambiente atual
const isDevelopment = 
  window.location.hostname === 'localhost' || 
  window.location.hostname === '127.0.0.1';

// URLs baseadas no ambiente
export const API_URL = isDevelopment 
  ? 'http://localhost:3000/api'
  : 'https://theraconnect-prd.onrender.com/api';

// URL base do servidor Socket.IO
export const SOCKET_URL = isDevelopment 
  ? 'http://localhost:3000'
  : 'https://theraconnect-prd.onrender.com';

// URL base do servidor Whisper API (transcrição)
export const WHISPER_URL = isDevelopment 
  ? 'http://localhost:3000/api/ai/whisper/transcribe'
  : 'https://theraconnect-prd.onrender.com/api/ai/whisper/transcribe';

export const FRONTEND_URL = isDevelopment
  ? 'http://localhost:3001'
  : 'https://terapia-conect-frontend.vercel.app';

// URL base da API para facilitar importação
export const BASE_API_URL = API_URL;

// Debug global para mostrar qual URL está sendo usada
console.log(`CONFIG.JS - URL da API configurada: \${BASE_API_URL} (\${isDevelopment ? 'desenvolvimento' : 'produção'})`);
console.log(`CONFIG.JS - URL do Socket.IO configurada: \${SOCKET_URL} (\${isDevelopment ? 'desenvolvimento' : 'produção'})`);
console.log(`CONFIG.JS - URL da Whisper API configurada: \${WHISPER_URL} (\${isDevelopment ? 'desenvolvimento' : 'produção'})`);

// Injetar URL global na janela para debug
if (typeof window !== 'undefined') {
  window.__API_CONFIG = {
    url: BASE_API_URL,
    socketUrl: SOCKET_URL,
    whisperUrl: WHISPER_URL,
    environment: isDevelopment ? 'development' : 'production',
    timestamp: new Date().toISOString()
  };
}

// Exportar configuração para uso em toda a aplicação
export default {
  apiUrl: BASE_API_URL,
  socketUrl: SOCKET_URL,
  whisperUrl: WHISPER_URL,
  frontendUrl: FRONTEND_URL,
  isDevelopment
};
"@
    
    Set-Content -Path $configFile -Value $newConfig
    Write-Host "Config.js corrigido!" -ForegroundColor Green
}

# 2. Verificar importações em hybridAI.service.js
$hybridAIFile = "frontend/src/services/hybridAI.service.js"
Write-Host "Verificando $hybridAIFile..." -ForegroundColor Yellow

$hybridContent = Get-Content $hybridAIFile -Raw
if ($hybridContent -match "import config from '../environments'") {
    Write-Host "PROBLEMA: Importação incorreta em $hybridAIFile" -ForegroundColor Red
    
    # Corrigir a importação
    $fixedHybridContent = $hybridContent -replace "import config from '../environments'", "import config from '../config'"
    Set-Content -Path $hybridAIFile -Value $fixedHybridContent
    Write-Host "Importação corrigida em $hybridAIFile" -ForegroundColor Green
} else {
    Write-Host "Importações em hybridAI.service.js parecem OK!" -ForegroundColor Green
}

# 3. Verificar importações em whisperTranscriptionService.js
$whisperFile = "frontend/src/services/whisperTranscriptionService.js"
Write-Host "Verificando $whisperFile..." -ForegroundColor Yellow

# 4. Commit das mudanças
Write-Host "Preparando para fazer commit das correções..." -ForegroundColor Yellow
Write-Host "Execute manualmente os seguintes comandos:" -ForegroundColor Cyan
Write-Host "git add frontend/src/config.js frontend/src/services/hybridAI.service.js frontend/src/services/whisperTranscriptionService.js" -ForegroundColor White
Write-Host "git commit -m 'Fix: Corrigir configurações e importações para resolver problemas no deploy'" -ForegroundColor White
Write-Host "git push origin theraconnect-prd" -ForegroundColor White

Write-Host "=== Script de correção concluído ===" -ForegroundColor Green 