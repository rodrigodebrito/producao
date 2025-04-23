/**
 * FIX CARDS EXTREME - Script de emergência ultra agressivo e definitivo
 * Este script contém uma abordagem definitiva para resolver qualquer problema de cards pretos
 * Ele usa múltiplos métodos, incluindo modificação direta de propriedades CSS inline
 */

(function() {
  console.log('🔥🔥🔥 INICIANDO CORREÇÃO NUCLEAR PARA CARDS PRETOS 🔥🔥🔥');
  
  const CARD_SELECTORS = [
    '.form-section .tools-grid > div',
    '.tool-item',
    '.niche-item',
    '[class*="tool-item"]',
    '[class*="niche-item"]',
    '.specialty-card',
    '.tools-grid div'
  ];
  
  // Método nuclear 1: Reescrever estilos inline
  function nuclearFix1() {
    console.log('☢️ Método 1: Reescrevendo estilos inline');
    
    // Encontrar todos os elementos que podem ser cards
    document.querySelectorAll(CARD_SELECTORS.join(', ')).forEach(card => {
      // Forçar estilo inline diretamente
      card.style.setProperty('background-color', '#FFFFFF', 'important');
      card.style.setProperty('background', '#FFFFFF', 'important');
      card.style.setProperty('color', '#333333', 'important');
      card.style.setProperty('border', '1px solid #ddd', 'important');
      card.style.setProperty('text-shadow', 'none', 'important');
      card.style.setProperty('position', 'relative', 'important');
      card.style.setProperty('z-index', '10', 'important');
      
      // Se for selecionado, aplicar estilo específico
      if (card.classList.contains('selected') || card.querySelector('input[type="checkbox"]:checked')) {
        card.style.setProperty('background-color', '#e8f4fd', 'important');
        card.style.setProperty('background', '#e8f4fd', 'important');
        card.style.setProperty('border-color', '#4299e1', 'important');
      }
      
      // Forçar todos os elementos filhos
      card.querySelectorAll('*').forEach(child => {
        child.style.setProperty('color', '#333333', 'important');
        child.style.setProperty('text-shadow', 'none', 'important');
        
        // Se for o nome da ferramenta, garantir cor correta
        if (child.classList.contains('tool-name') || child.nodeName === 'SPAN') {
          child.style.setProperty('color', '#333333', 'important');
          child.style.setProperty('text-shadow', 'none', 'important');
          child.style.setProperty('font-weight', '500', 'important');
        }
      });
      
      // Adicionar overlay branco como camada de proteção
      if (!card.querySelector('.white-overlay-protection')) {
        const overlay = document.createElement('div');
        overlay.className = 'white-overlay-protection';
        overlay.style.cssText = `
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100% !important;
          height: 100% !important;
          background-color: ${card.classList.contains('selected') ? '#e8f4fd' : '#FFFFFF'} !important;
          z-index: -1 !important;
          pointer-events: none !important;
          border-radius: inherit !important;
        `;
        card.insertBefore(overlay, card.firstChild);
      }
    });
  }
  
  // Método nuclear 2: Substituir elementos
  function nuclearFix2() {
    console.log('☢️ Método 2: Substituindo elementos problemáticos');
    
    // Encontrar todos os cards com fundo preto
    document.querySelectorAll('div').forEach(div => {
      const style = window.getComputedStyle(div);
      const bgColor = style.backgroundColor;
      
      if (bgColor === 'rgb(0, 0, 0)' || 
          bgColor === 'rgb(32, 32, 32)' || 
          bgColor === '#000' || 
          bgColor === '#000000' || 
          bgColor === 'black') {
        
        console.log('🧨 Encontrado elemento com fundo preto:', div);
        
        // Verificar se é um card de nicho
        let isNicheCard = false;
        let nicheName = '';
        
        // Tentar encontrar o nome do nicho
        const spans = div.querySelectorAll('span');
        spans.forEach(span => {
          const text = span.textContent.trim();
          if (text && text.length > 0) {
            nicheName = text;
            isNicheCard = true;
          }
        });
        
        // Se for um card de nicho, substituir completamente
        if (isNicheCard) {
          console.log(`🔄 Substituindo card de nicho: ${nicheName}`);
          
          // Preservar classes e estado de seleção
          const classes = div.className;
          const isSelected = div.classList.contains('selected') || div.querySelector('input[type="checkbox"]:checked');
          
          // Criar novo elemento
          const newCard = document.createElement('div');
          newCard.className = classes;
          newCard.innerHTML = `
            <div class="tool-header" style="background-color:#ffffff !important; color:#333333 !important;">
              <span class="tool-name" style="color:#333333 !important; text-shadow:none !important;">${nicheName}</span>
              <input type="checkbox" ${isSelected ? 'checked' : ''} style="background-color:#ffffff !important;">
            </div>
          `;
          
          // Estilizar o novo card
          newCard.style.cssText = `
            background-color: ${isSelected ? '#e8f4fd' : '#ffffff'} !important;
            background: ${isSelected ? '#e8f4fd' : '#ffffff'} !important;
            color: #333333 !important;
            border: 1px solid ${isSelected ? '#4299e1' : '#e0e0e0'} !important;
            text-shadow: none !important;
            position: relative !important;
            border-radius: 8px !important;
            padding: 0.75rem 1rem !important;
            margin-bottom: 1rem !important;
            transition: all 0.2s !important;
          `;
          
          // Substituir o elemento original
          if (div.parentNode) {
            div.parentNode.replaceChild(newCard, div);
            console.log('✅ Card substituído com sucesso');
          }
        } else {
          // Se não for um card de nicho, apenas corrigir estilos
          div.style.cssText += 'background-color: #ffffff !important; background: #ffffff !important; color: #333333 !important;';
        }
      }
    });
  }
  
  // Método nuclear 3: Aplicar classes diretas e forçadas
  function nuclearFix3() {
    console.log('☢️ Método 3: Aplicando classes diretas');
    
    // Criar e injetar estilo no documento
    if (!document.getElementById('emergency-niche-style')) {
      const style = document.createElement('style');
      style.id = 'emergency-niche-style';
      style.innerHTML = `
        .forced-white-card {
          background-color: #FFFFFF !important;
          background: #FFFFFF !important;
          color: #333333 !important;
          text-shadow: none !important;
          border: 1px solid #ddd !important;
          position: relative !important;
          z-index: 10 !important;
        }
        
        .forced-white-card * {
          color: #333333 !important;
          text-shadow: none !important;
        }
        
        .forced-white-card.selected {
          background-color: #e8f4fd !important;
          background: #e8f4fd !important;
          border-color: #4299e1 !important;
        }
        
        .forced-white-card.selected * {
          color: #2c5282 !important;
        }
        
        /* Estilos específicos para Constelação Familiar */
        div:has(span:contains("Constelação Familiar")),
        div:has(*:contains("Constelação Familiar")) {
          background-color: #FFFFFF !important;
          background: #FFFFFF !important;
          color: #333333 !important;
          border: 1px solid #ddd !important;
        }
        
        div:has(span:contains("Constelação Familiar")).selected,
        div:has(*:contains("Constelação Familiar")).selected {
          background-color: #e8f4fd !important;
          background: #e8f4fd !important;
          border-color: #4299e1 !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Aplicar classe a todos os possíveis cards
    document.querySelectorAll(CARD_SELECTORS.join(', ')).forEach(card => {
      card.classList.add('forced-white-card');
    });
  }
  
  // Método nuclear 4: Interceptar renderização
  function nuclearFix4() {
    console.log('☢️ Método 4: Interceptando renderização');
    
    // Monitorar todas as mutações do DOM
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // É um elemento
              // Verificar se é um card
              if (CARD_SELECTORS.some(selector => node.matches && node.matches(selector))) {
                console.log('🔍 Novo card detectado, aplicando correção imediata');
                fixCard(node);
              }
              
              // Verificar se contém cards
              if (node.querySelectorAll) {
                node.querySelectorAll(CARD_SELECTORS.join(', ')).forEach(card => {
                  fixCard(card);
                });
              }
            }
          });
        } else if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          // Se o estilo for modificado, reaplicar a correção
          if (CARD_SELECTORS.some(selector => mutation.target.matches && mutation.target.matches(selector))) {
            fixCard(mutation.target);
          }
        }
      });
    });
    
    // Configurar observer
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }
  
  // Função auxiliar para corrigir um card específico
  function fixCard(card) {
    // Verificar se o fundo é preto
    const style = window.getComputedStyle(card);
    const bgColor = style.backgroundColor;
    
    // Verificar se tem texto "Constelação Familiar"
    const hasConstellationText = card.textContent.includes('Constelação Familiar');
    
    if (hasConstellationText) {
      console.log('🎯 Encontrado card de Constelação Familiar, aplicando correção específica');
      fixConstellationCard(card);
      return;
    }
    
    if (bgColor === 'rgb(0, 0, 0)' || 
        bgColor === 'rgb(32, 32, 32)' || 
        bgColor === '#000' || 
        bgColor === '#000000' || 
        bgColor === 'black') {
      
      // Aplicar correção direta
      card.style.setProperty('background-color', '#FFFFFF', 'important');
      card.style.setProperty('background', '#FFFFFF', 'important');
      card.style.setProperty('color', '#333333', 'important');
      card.style.setProperty('border', '1px solid #ddd', 'important');
      card.style.setProperty('text-shadow', 'none', 'important');
      
      // Forçar todos os elementos filhos
      card.querySelectorAll('*').forEach(child => {
        child.style.setProperty('color', '#333333', 'important');
        child.style.setProperty('text-shadow', 'none', 'important');
      });
    }
  }
  
  // Executar todas as correções nucleares
  function executeAllNuclearFixes() {
    console.log('☢️☢️☢️ EXECUTANDO TODAS AS CORREÇÕES NUCLEARES ☢️☢️☢️');
    
    // Aplicar correção específica para Constelação Familiar primeiro
    fixConstellationSpecific();
    
    // Executar todas as correções gerais
    nuclearFix1();
    nuclearFix2();
    nuclearFix3();
    nuclearFix4();
    
    console.log('✅✅✅ CORREÇÕES NUCLEARES CONCLUÍDAS ✅✅✅');
  }
  
  // Função específica para corrigir cards de Constelação Familiar
  function fixConstellationSpecific() {
    console.log('🌟 Iniciando correção específica para Constelação Familiar');
    
    // Encontrar todos os elementos que podem conter "Constelação Familiar"
    document.querySelectorAll('div, span, button, a, li, label').forEach(element => {
      if (element.textContent.includes('Constelação Familiar')) {
        console.log('🎯 Encontrado elemento com texto Constelação Familiar:', element);
        fixConstellationCard(element);
        
        // Verificar também os elementos pais (até 3 níveis acima)
        let parent = element.parentElement;
        for (let i = 0; i < 3; i++) {
          if (parent) {
            fixConstellationCard(parent);
            parent = parent.parentElement;
          }
        }
      }
    });
  }
  
  // Função para corrigir especificamente o card de Constelação Familiar
  function fixConstellationCard(element) {
    if (!element) return;
    
    // Verificar o estilo de fundo
    const style = window.getComputedStyle(element);
    const bgColor = style.backgroundColor;
    const textColor = style.color;
    
    // Converte cor para formato RGB para comparação
    const isDarkBg = isColorDark(bgColor);
    const isLightText = !isColorDark(textColor);
    
    // Aplicar correção forçada
    element.style.setProperty('background-color', '#FFFFFF', 'important');
    element.style.setProperty('background', '#FFFFFF', 'important');
    element.style.setProperty('color', '#333333', 'important');
    element.style.setProperty('border', '1px solid #ddd', 'important');
    element.style.setProperty('text-shadow', 'none', 'important');
    
    // Se for selecionado ou estiver em estado de hover
    if (element.classList.contains('selected') || 
        element.classList.contains('active') || 
        element.querySelector('input[type="checkbox"]:checked')) {
      element.style.setProperty('background-color', '#e8f4fd', 'important');
      element.style.setProperty('background', '#e8f4fd', 'important');
      element.style.setProperty('border-color', '#4299e1', 'important');
    }
    
    // Adicionar classe para estilização extra
    element.classList.add('constellation-fixed');
    
    // Corrigir também os elementos filhos
    Array.from(element.children).forEach(child => {
      child.style.setProperty('background-color', 'transparent', 'important');
      child.style.setProperty('color', '#333333', 'important');
      
      // Se for o texto do nicho, garantir que seja visível
      if (child.textContent.includes('Constelação Familiar') || 
          child.nodeName === 'SPAN' || 
          child.classList.contains('tool-name')) {
        child.style.setProperty('color', '#333333', 'important');
        child.style.setProperty('text-shadow', 'none', 'important');
        child.style.setProperty('font-weight', '500', 'important');
      }
    });
    
    // Adicionar estilos CSS para .constellation-fixed se ainda não existirem
    if (!document.querySelector('#constellation-fix-style')) {
      const css = `
        .constellation-fixed, 
        .constellation-fixed:hover, 
        .constellation-fixed:active, 
        .constellation-fixed:focus {
          background-color: #FFFFFF !important;
          color: #333333 !important;
          border: 1px solid #ddd !important;
          position: relative !important;
          z-index: 10 !important;
        }
        
        .constellation-fixed.selected, 
        .constellation-fixed.active, 
        .constellation-fixed:has(input:checked),
        .constellation-fixed:has(input:checked) {
          background-color: #e8f4fd !important;
          border-color: #4299e1 !important;
        }
        
        .constellation-fixed * {
          color: #333333 !important;
          text-shadow: none !important;
        }
      `;
      
      const style = document.createElement('style');
      style.id = 'constellation-fix-style';
      style.innerHTML = css;
      document.head.appendChild(style);
    }
    
    console.log('✅ Correção aplicada ao elemento com Constelação Familiar');
  }
  
  // Função auxiliar para verificar se uma cor é escura
  function isColorDark(color) {
    // Cor padrão se não conseguirmos determinar
    if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
      return false;
    }
    
    // Converter para RGB se for outro formato
    let r, g, b;
    
    if (color.startsWith('rgb')) {
      // Formato RGB ou RGBA
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (match) {
        r = parseInt(match[1]);
        g = parseInt(match[2]);
        b = parseInt(match[3]);
      }
    } else if (color.startsWith('#')) {
      // Formato Hex
      const hex = color.substring(1);
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else {
      // Formato não suportado
      return false;
    }
    
    // Calcular luminosidade
    // https://www.w3.org/TR/WCAG20-TECHS/G17.html
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Luminância < 0.5 é considerado escuro
    return luminance < 0.5;
  }
  
  // Iniciar correções quando o DOM estiver carregado
  document.addEventListener('DOMContentLoaded', function() {
    executeAllNuclearFixes();
    
    // Aplicar correções periodicamente
    setInterval(executeAllNuclearFixes, 1000);
  });
  
  // Iniciar correções quando a página estiver totalmente carregada
  window.addEventListener('load', executeAllNuclearFixes);
})(); 