/**
 * Script para corrigir os cards de ferramentas terapêuticas
 * - Corrige fundos pretos
 * - Ajusta textos que estão saindo para fora
 */

(function() {
  console.log('Therapy cards fix script loaded');
  
  // Função principal para corrigir os cards
  function fixTherapyCards() {
    console.log('Aplicando correções aos cards de terapia...');
    
    // Seletores para cards com problemas
    const cardSelectors = [
      '.tool-item',
      '.niche-item',
      '[class*="tool-item"]',
      '[class*="niche-item"]',
      '.tools-grid > div'
    ];
    
    // Encontrar todos os cards usando os seletores
    cardSelectors.forEach(selector => {
      const cards = document.querySelectorAll(selector);
      if (cards.length > 0) {
        console.log(`Encontrados ${cards.length} cards usando seletor "${selector}"`);
        
        cards.forEach(card => {
          // Corrigir fundos pretos
          if (getComputedStyle(card).backgroundColor === 'rgb(0, 0, 0)' || 
              getComputedStyle(card).backgroundColor === 'rgb(32, 32, 32)' ||
              getComputedStyle(card).backgroundColor === '#000' ||
              getComputedStyle(card).backgroundColor === '#202020' || 
              card.style.backgroundColor === 'black') {
            
            console.log('Corrigindo card com fundo preto:', card);
            card.style.cssText = card.style.cssText + '; background-color: #ffffff !important; color: #333333 !important; border: 1px solid #e0e0e0 !important;';
            
            // Corrigir textos dentro do card
            const textElements = card.querySelectorAll('*');
            textElements.forEach(el => {
              if (getComputedStyle(el).color === 'rgb(255, 255, 255)' || 
                  el.style.color === 'white' || 
                  el.style.color === '#fff') {
                el.style.cssText = el.style.cssText + '; color: #333333 !important; text-shadow: none !important;';
              }
            });
            
            // Se o card estiver selecionado, aplicar estilo adequado
            if (card.classList.contains('selected')) {
              card.style.cssText = card.style.cssText + '; background-color: #e8f4fd !important; border-color: #4299e1 !important;';
            }
          }
          
          // Corrigir texto saindo para fora
          const toolName = card.querySelector('.tool-name, [class*="tool-name"]');
          if (toolName) {
            toolName.style.cssText = toolName.style.cssText + '; white-space: normal !important; overflow: visible !important; text-overflow: clip !important; font-size: 0.9rem !important; line-height: 1.3 !important;';
          }
          
          // Garantir que os checkboxes sejam visíveis
          const checkbox = card.querySelector('input[type="checkbox"]');
          if (checkbox) {
            checkbox.style.cssText = checkbox.style.cssText + '; visibility: visible !important; opacity: 1 !important; position: static !important;';
          }
        });
      }
    });
    
    // Correção específica para o card de Constelação Familiar
    fixConstellationCard();
  }
  
  // Função específica para o card de Constelação Familiar
  function fixConstellationCard() {
    const constellationTexts = ['Constelação Familiar', 'Constelação', 'Constelação F'];
    
    constellationTexts.forEach(text => {
      // Encontrar elementos que contêm o texto
      const elements = Array.from(document.querySelectorAll('*')).filter(el => 
        el.textContent.includes(text) && 
        (el.tagName === 'SPAN' || el.tagName === 'DIV' || el.tagName === 'LABEL')
      );
      
      elements.forEach(el => {
        // Encontrar o card pai
        let card = el;
        while (card && !card.classList.contains('tool-item') && !card.className.includes('tool-item') && card.tagName !== 'BODY') {
          card = card.parentElement;
        }
        
        if (card && card.tagName !== 'BODY') {
          console.log('Corrigindo card de Constelação Familiar');
          card.style.cssText = card.style.cssText + '; background-color: #ffffff !important; color: #333333 !important; border: 1px solid #4299e1 !important;';
          
          // Corrigir textos dentro do card
          const textElements = card.querySelectorAll('*');
          textElements.forEach(textEl => {
            textEl.style.cssText = textEl.style.cssText + '; color: #333333 !important; text-shadow: none !important;';
          });
          
          // Se estiver selecionado
          if (card.classList.contains('selected')) {
            card.style.cssText = card.style.cssText + '; background-color: #e8f4fd !important;';
          }
        }
      });
    });
  }
  
  // Aplicar as correções quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(fixTherapyCards, 100);
    });
  } else {
    setTimeout(fixTherapyCards, 100);
  }
  
  // Também aplicar quando a janela terminar de carregar
  window.addEventListener('load', function() {
    setTimeout(fixTherapyCards, 500);
    setTimeout(fixTherapyCards, 1500);
  });
  
  // Aplicar periodicamente para caso de alterações dinâmicas
  setInterval(fixTherapyCards, 2000);
  
  // Sobrescrever método de adição de classe para interceptar mudanças na classe 'selected'
  const originalAddClass = Element.prototype.classList.add;
  Element.prototype.classList.add = function() {
    originalAddClass.apply(this, arguments);
    if (arguments[0] === 'selected') {
      setTimeout(fixTherapyCards, 10);
    }
  };
  
  const originalRemoveClass = Element.prototype.classList.remove;
  Element.prototype.classList.remove = function() {
    originalRemoveClass.apply(this, arguments);
    if (arguments[0] === 'selected') {
      setTimeout(fixTherapyCards, 10);
    }
  };
})(); 