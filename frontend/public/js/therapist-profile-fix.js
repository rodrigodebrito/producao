/**
 * Script de correção específico para o perfil do terapeuta
 * - Corrige cores de fundo preto
 * - Resolve problemas de imagem estagnada
 * - Ajusta layouts incorretos
 */

(function() {
  console.log('🔧 Carregando correções para o perfil do terapeuta');

  // Função para melhorar a exibição da foto de perfil
  function fixProfileImage() {
    console.log('Verificando imagem de perfil...');
    
    // Seletores para a imagem de perfil
    const imageSelectors = [
      '.profile-image-preview',
      '.image-preview img',
      '.profile-image-section img'
    ];
    
    let imageFound = false;
    
    // Para cada seletor possível
    imageSelectors.forEach(selector => {
      const images = document.querySelectorAll(selector);
      
      if (images.length > 0) {
        console.log(`Encontradas ${images.length} imagens com seletor "${selector}"`);
        imageFound = true;
        
        images.forEach(img => {
          // Forçar recarregamento da imagem (evitar cache)
          if (img.src && !img.src.includes('?')) {
            const timestamp = new Date().getTime();
            img.src = img.src.split('?')[0] + '?t=' + timestamp;
            console.log('Imagem atualizada com cache busting:', img.src);
          }
          
          // Melhorar o estilo da imagem
          img.style.cssText = `
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            object-position: center !important;
            border-radius: 50% !important;
          `;
          
          // Adicionar evento de erro para tratar falhas de carregamento
          img.onerror = function() {
            console.log('Erro ao carregar imagem, tentando novamente...');
            setTimeout(() => {
              this.src = this.src.split('?')[0] + '?reload=' + new Date().getTime();
            }, 1000);
          };
        });
      }
    });
    
    // Se não encontrou imagem, verificar o contêiner de imagem
    if (!imageFound) {
      const imageContainers = document.querySelectorAll('.image-preview, .profile-image-section');
      if (imageContainers.length > 0) {
        console.log('Contêiner de imagem encontrado, aplicando melhorias...');
        
        imageContainers.forEach(container => {
          container.style.cssText = `
            width: 150px !important;
            height: 150px !important;
            border-radius: 50% !important;
            overflow: hidden !important;
            display: flex !important;
            justify-content: center !important;
            align-items: center !important;
            background-color: #f0f7ff !important;
            border: 3px solid #3b82f6 !important;
            box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3) !important;
            margin: 0 auto 20px auto !important;
          `;
        });
      }
    }
  }
  
  // Função para corrigir os cards de niche e ferramentas
  function fixCards() {
    console.log('Corrigindo cards de nicho e ferramentas...');
    
    // Seletores para os cards
    const cardSelectors = [
      '.tool-item',
      '.niche-item',
      '[class*="tool-item"]',
      '[class*="niche-item"]',
      '.tools-grid > div'
    ];
    
    // Para cada seletor possível
    cardSelectors.forEach(selector => {
      const cards = document.querySelectorAll(selector);
      
      if (cards.length > 0) {
        console.log(`Encontrados ${cards.length} cards com seletor "${selector}"`);
        
        cards.forEach(card => {
          // Verificar o estilo atual
          const computedStyle = getComputedStyle(card);
          const bgColor = computedStyle.backgroundColor;
          
          // Se o fundo for preto ou escuro
          if (bgColor === 'rgb(0, 0, 0)' || 
              bgColor === 'rgb(32, 32, 32)' || 
              bgColor === '#000' || 
              bgColor === '#202020' ||
              card.style.backgroundColor === 'black') {
            
            console.log('Corrigindo card com fundo escuro:', card);
            
            // Estilo forçado com !important para sobrescrever tudo
            card.style.cssText = `
              background-color: #ffffff !important;
              color: #333333 !important;
              border: 1px solid #e0e0e0 !important;
              border-radius: 8px !important;
              padding: 12px !important;
              margin-bottom: 10px !important;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
            `;
            
            // Corrigir todos os elementos de texto dentro do card
            const textElements = card.querySelectorAll('*');
            textElements.forEach(el => {
              const elStyle = getComputedStyle(el);
              if (elStyle.color === 'rgb(255, 255, 255)' || 
                  el.style.color === 'white' || 
                  el.style.color === '#fff') {
                el.style.color = '#333333 !important';
                el.style.textShadow = 'none !important';
              }
            });
          }
          
          // Verificar se é um card de Constelação Familiar
          const cardText = card.textContent || '';
          if (cardText.includes('Constelação Familiar') || cardText.includes('Constelação')) {
            console.log('Corrigindo card de Constelação Familiar');
            card.style.cssText = `
              background-color: #ffffff !important;
              color: #333333 !important;
              border: 1px solid #4299e1 !important;
              border-radius: 8px !important;
              padding: 12px !important;
              margin-bottom: 10px !important;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
            `;
            
            // Corrigir todos os elementos de texto
            const textElements = card.querySelectorAll('*');
            textElements.forEach(el => {
              el.style.color = '#333333 !important';
              el.style.textShadow = 'none !important';
            });
          }
          
          // Garantir que o texto não saia para fora do card
          const toolName = card.querySelector('.tool-name, [class*="tool-name"]');
          if (toolName) {
            toolName.style.cssText += `
              white-space: normal !important;
              overflow: visible !important;
              text-overflow: clip !important;
              font-size: 0.9rem !important;
              line-height: 1.3 !important;
              color: #333333 !important;
            `;
          }
          
          // Garantir que os checkboxes sejam visíveis
          const checkbox = card.querySelector('input[type="checkbox"]');
          if (checkbox) {
            checkbox.style.cssText += `
              visibility: visible !important;
              opacity: 1 !important;
              position: static !important;
              width: 20px !important;
              height: 20px !important;
            `;
          }
        });
      }
    });
  }

  // Função que adiciona uma correção de estilo global ao documento
  function addGlobalStyle() {
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      /* Correções globais para TherapistProfile */
      .profile-image-section {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        margin-bottom: 2rem !important;
        gap: 1rem !important;
      }
      
      .image-preview {
        width: 150px !important;
        height: 150px !important;
        border-radius: 50% !important;
        overflow: hidden !important;
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        background-color: #f0f7ff !important;
        border: 3px solid #3b82f6 !important;
        box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3) !important;
      }
      
      .profile-image-preview {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
        object-position: center !important;
      }
      
      .profile-image-placeholder {
        width: 100% !important;
        height: 100% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background-color: #dbeafe !important;
        font-size: 3rem !important;
        font-weight: bold !important;
        color: #3b82f6 !important;
      }
      
      .image-upload-button {
        background-color: #3b82f6 !important;
        color: white !important;
        border: none !important;
        border-radius: 8px !important;
        padding: 0.75rem 1.25rem !important;
        font-size: 1rem !important;
        cursor: pointer !important;
        font-weight: 600 !important;
      }
      
      /* Correções para cards */
      .tool-item, .niche-item, [class*="tool-item"], [class*="niche-item"], .tools-grid > div {
        background-color: #ffffff !important;
        color: #333333 !important;
        border: 1px solid #e0e0e0 !important;
        border-radius: 8px !important;
        padding: 12px !important;
        margin-bottom: 10px !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
      }
      
      .tool-name, [class*="tool-name"], .tool-header span, .tool-header label {
        color: #333333 !important;
        font-weight: 600 !important;
        text-shadow: none !important;
        white-space: normal !important;
        overflow: visible !important;
        text-overflow: clip !important;
        font-size: 0.9rem !important;
        line-height: 1.3 !important;
      }
      
      .tool-item input[type="checkbox"], .niche-item input[type="checkbox"] {
        visibility: visible !important;
        opacity: 1 !important;
        position: static !important;
        width: 20px !important;
        height: 20px !important;
      }
      
      /* Correção específica para o card de Constelação Familiar */
      div:has(> span:contains("Constelação")), div:has(> span:contains("Constelação Familiar")) {
        background-color: #ffffff !important;
        color: #333333 !important;
        border: 1px solid #4299e1 !important;
      }
    `;
    document.head.appendChild(styleEl);
    console.log('Estilos globais adicionados');
  }

  // Aplicar correções como um observador de mudanças no DOM
  function applyFixes() {
    fixProfileImage();
    fixCards();
    
    // Adicionar observador para mudanças futuras
    const targetNode = document.body;
    const config = { childList: true, subtree: true };
    
    const callback = function(mutationsList, observer) {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          setTimeout(() => {
            fixProfileImage();
            fixCards();
          }, 100);
          break;
        }
      }
    };
    
    const observer = new MutationObserver(callback);
    observer.observe(targetNode, config);
    console.log('Observador de mudanças no DOM iniciado');
  }

  // Adicionar estilos globais imediatamente
  addGlobalStyle();
  
  // Aplicar correções quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(applyFixes, 100);
    });
  } else {
    setTimeout(applyFixes, 100);
  }
  
  // Também aplicar quando a janela terminar de carregar
  window.addEventListener('load', function() {
    setTimeout(applyFixes, 500);
    setTimeout(applyFixes, 1500);
    setTimeout(applyFixes, 3000);
  });
  
  // Aplicar periodicamente para caso de alterações dinâmicas
  setInterval(applyFixes, 2000);
  
  // Interceptar qualquer carregamento de imagem
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName) {
    const element = originalCreateElement.call(document, tagName);
    
    if (tagName.toLowerCase() === 'img') {
      element.addEventListener('load', function() {
        if (this.classList.contains('profile-image-preview') || 
            this.parentElement?.classList.contains('image-preview')) {
          console.log('Imagem de perfil carregada, aplicando estilos...');
          this.style.cssText = `
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            object-position: center !important;
            border-radius: 50% !important;
          `;
        }
      });
    }
    
    return element;
  };
  
  console.log('🔧 Script de correção do perfil do terapeuta carregado com sucesso');
})(); 