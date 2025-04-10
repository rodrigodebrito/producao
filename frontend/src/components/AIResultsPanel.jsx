import React, { useEffect, useState, useCallback } from 'react';
import { useAI } from '../contexts/AIContext';
import { toast } from 'react-toastify';
import './AIResultsPanel.css';
import { injectDownloadButton } from './DownloadReportButton';

const AIResultsPanel = () => {
  const { lastResult, isProcessing } = useAI();
  const [visible, setVisible] = useState(false);
  const [resultData, setResultData] = useState(null);
  const [pinnedMode, setPinnedMode] = useState(false);
  const [removeButtonFn, setRemoveButtonFn] = useState(null);

  // Funções para download e impressão de relatórios
  const downloadReport = useCallback(() => {
    try {
      console.log('Iniciando download do relatório');
      
      if (!resultData || (!resultData.report && !resultData.data?.report)) {
        toast.error('Relatório não disponível para download');
        return;
      }
      
      // Obter o texto do relatório
      const reportText = resultData.report || resultData.data?.report || '';
      
      // Método direto de download
      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(reportText));
      element.setAttribute('download', 'relatorio-sessao.txt');
      element.style.display = 'none';
      
      // Adicionar ao DOM e forçar o clique
      document.body.appendChild(element);
      element.click();
      
      // Limpar
      document.body.removeChild(element);
      
      toast.success('Relatório baixado com sucesso!');
    } catch (error) {
      console.error('Erro ao baixar relatório:', error);
      toast.error('Erro ao baixar o relatório. Tente novamente.');
    }
  }, [resultData]);
  
  const printReport = useCallback(() => {
    try {
      console.log('Preparando relatório para impressão');
      
      if (!resultData || (!resultData.report && !resultData.data?.report)) {
        toast.error('Relatório não disponível para impressão');
        return;
      }
      
      // Obter o texto do relatório
      const reportText = resultData.report || resultData.data?.report || '';
      
      // Abrir nova janela para impressão
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Não foi possível abrir janela de impressão. Verifique se os pop-ups estão permitidos.');
        return;
      }
      
      printWindow.document.write(`
        <html>
          <head>
            <title>Relatório da Sessão</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }
              h1 { color: #2c3e50; }
              h3 { color: #3498db; margin-top: 20px; }
              p { margin-bottom: 10px; }
              @media print {
                body { padding: 0; margin: 1cm; }
                button { display: none; }
              }
            </style>
          </head>
          <body>
            <h1>Relatório da Sessão</h1>
            ${reportText.split('\n').map(p => 
              p.trim() ? (
                p.startsWith('#') || p.startsWith('##') ? 
                  `<h3>${p.replace(/^#+\s+/, '')}</h3>` : 
                  `<p>${p}</p>`
              ) : '<br>'
            ).join('')}
            <hr>
            <p style="color: #7f8c8d; font-size: 0.8em;">Gerado por TerapiaConect</p>
            <button onclick="window.print()" style="margin-top: 20px; padding: 10px 15px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Imprimir Relatório</button>
          </body>
        </html>
      `);
      printWindow.document.close();
      toast.success('Preparado para impressão!');
    } catch (error) {
      console.error('Erro ao preparar relatório para impressão:', error);
      toast.error('Erro ao gerar visualização para impressão.');
    }
  }, [resultData]);

  // Função para injetar CSS de alta prioridade para sobrepor todos os elementos
  const injectHighPriorityCSS = () => {
    // Remove estilo antigo se existir
    const oldStyle = document.getElementById('ai-results-priority-styles');
    if (oldStyle) oldStyle.remove();
    
    // Cria novo estilo
    const style = document.createElement('style');
    style.id = 'ai-results-priority-styles';
    style.innerHTML = `
      #ai-results-overlay-panel {
        position: fixed !important;
        z-index: 99999999999 !important; /* Z-index aumentado */
        pointer-events: auto !important;
        visibility: visible !important;
        opacity: 1 !important;
        display: flex !important;
      }
      #ai-results-overlay-panel * {
        pointer-events: auto !important;
      }
      
      /* Força o painel acima dos elementos do jitsi */
      .prejitsi-watermark,
      .watermark,
      .tOQNJSLwCYnxUY3bW0zj,
      #new-toolbox,
      #videospace,
      .filmstrip,
      .subject,
      .tOQNJSLwCYnxUY3bW0zj,
      #jitsiConferenceFrame0,
      button[aria-label="Sair da sessão"],
      button[aria-label="Sair da Sessão"],
      button[aria-label="Leave"],
      button[aria-label="Hang up"],
      button[data-testid="hangup-button"],
      .toolbox-button.hangup,
      .toolbox-button-wth-dialog.hangup {
        z-index: auto !important;
        pointer-events: none !important;
      }
      
      /* Hack específico para o botão de fim de chamada */
      .hangup-button {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      
      /* Estilos adicionais para garantir visibilidade */
      .ai-results-panel {
        opacity: 1 !important;
        visibility: visible !important;
        display: block !important;
      }
      
      /* Garantir que a overlay tenha cor de fundo para ser visível */
      .ai-results-overlay {
        background-color: rgba(0, 0, 0, 0.7) !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    `;
    document.head.appendChild(style);
    
    // Tenta encontrar e desabilitar o botão de sair da sessão por seletor específico
    setTimeout(() => {
      // Tentar diferentes seletores que podem existir para o botão de sair
      const possibleButtonSelectors = [
        'button[aria-label="Sair da sessão"]',
        'button[aria-label="Sair da Sessão"]',
        'button[aria-label="Leave"]',
        'button[aria-label="Hang up"]',
        'button[data-testid="hangup-button"]',
        '.toolbox-button.hangup',
        '.toolbox-button-wth-dialog.hangup',
        // Seletor baseado na cor vermelha comum em botões de fim de chamada
        'button.red',
        'button.hangup'
      ];
      
      // Tenta todos os seletores
      possibleButtonSelectors.forEach(selector => {
        const buttons = document.querySelectorAll(selector);
        buttons.forEach(btn => {
          if (btn) {
            btn.style.visibility = 'hidden';
            btn.style.pointerEvents = 'none';
            btn.style.zIndex = '-1';
            console.log('Botão de sair encontrado e desabilitado:', selector);
          }
        });
      });
    }, 200);
  };

  // Listen for changes in lastResult
  useEffect(() => {
    if (lastResult && !isProcessing) {
      console.log('AIResultsPanel: Received result data:', lastResult);
      console.log('AIResultsPanel: Setting visibility to TRUE');
      
      // Verificar se é uma resposta do ChatGPT
      const isChatGPTResponse = lastResult.source === 'chatgpt' || 
                               (lastResult.data && lastResult.data.source === 'chatgpt') ||
                               (lastResult.type && ['analysis', 'suggestions', 'report'].includes(lastResult.type));
      
      if (isChatGPTResponse) {
        console.log('AIResultsPanel: Detected ChatGPT response, ensuring visibility');
      }
      
      setResultData(lastResult);
      setVisible(true);
      
      // Injetar CSS de alta prioridade
      injectHighPriorityCSS();
      
      // IMPORTANTE: Adicionar temporizador para verificar visibilidade após renderização
      setTimeout(() => {
        const panel = document.getElementById('ai-results-overlay-panel');
        if (panel) {
          console.log('AIResultsPanel: Status de visibilidade do painel:', {
            display: window.getComputedStyle(panel).display,
            visibility: window.getComputedStyle(panel).visibility,
            opacity: window.getComputedStyle(panel).opacity,
            zIndex: window.getComputedStyle(panel).zIndex
          });
          
          // Forçar painel a ser visível em caso de problemas
          panel.style.display = 'flex';
          panel.style.visibility = 'visible';
          panel.style.opacity = '1';
          panel.style.zIndex = '99999999999';
        } else {
          console.warn('AIResultsPanel: Painel não encontrado no DOM!');
          
          // Tentar forçar nova renderização
          setResultData({...lastResult, timestamp: Date.now()});
        }
      }, 300);
      
      // SOLUÇÃO FINAL: Botões flutuantes usando React Portal
      if (lastResult.type === 'report') {
        // Obter texto do relatório
        const reportText = lastResult.report || lastResult.data?.report || '';
        
        // Injetar botão de download que permanecerá visível
        const removeButton = injectDownloadButton(reportText);
        setRemoveButtonFn(() => removeButton);
      }
      
      // NOVA SOLUÇÃO DE BACKUP - Muito mais simples e garantida
      // Botões flutuantes independentes de qualquer painel
      if (lastResult.type === 'report') {
        // Remover botões antigos se existirem
        const oldButtons = document.getElementById('floating-report-buttons');
        if (oldButtons) oldButtons.remove();
        
        // Criar container flutuante
        const floatingContainer = document.createElement('div');
        floatingContainer.id = 'floating-report-buttons';
        floatingContainer.style.position = 'fixed';
        floatingContainer.style.top = '150px';
        floatingContainer.style.right = '20px';
        floatingContainer.style.zIndex = '2147483647';
        floatingContainer.style.display = 'flex';
        floatingContainer.style.flexDirection = 'column';
        floatingContainer.style.gap = '10px';
        
        // Botão de download
        const downloadButton = document.createElement('button');
        downloadButton.textContent = '⬇️ Baixar';
        downloadButton.style.backgroundColor = '#1e88e5';
        downloadButton.style.color = 'white';
        downloadButton.style.border = 'none';
        downloadButton.style.borderRadius = '50%';
        downloadButton.style.width = '60px';
        downloadButton.style.height = '60px';
        downloadButton.style.fontSize = '16px';
        downloadButton.style.cursor = 'pointer';
        downloadButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        
        downloadButton.addEventListener('click', () => {
          const reportText = lastResult.report || lastResult.data?.report || '';
          
          // Método 1: Usando Blob e URL.createObjectURL
          try {
            const blob = new Blob([reportText], {type: 'text/plain'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'relatorio-sessao.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.success('Relatório baixado!');
          } catch (e) {
            console.error('Erro ao baixar com método 1:', e);
            
            // Método 2: Usando data URI
            try {
              const a = document.createElement('a');
              a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(reportText);
              a.download = 'relatorio-sessao.txt';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              toast.success('Relatório baixado!');
            } catch (e2) {
              console.error('Erro ao baixar com método 2:', e2);
              toast.error('Erro ao baixar. Tente outro navegador.');
            }
          }
        });
        
        // Botão de impressão
        const printButton = document.createElement('button');
        printButton.textContent = '🖨️';
        printButton.style.backgroundColor = '#43a047';
        printButton.style.color = 'white';
        printButton.style.border = 'none';
        printButton.style.borderRadius = '50%';
        printButton.style.width = '60px';
        printButton.style.height = '60px';
        printButton.style.fontSize = '24px';
        printButton.style.cursor = 'pointer';
        printButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        
        printButton.addEventListener('click', () => {
          const reportText = lastResult.report || lastResult.data?.report || '';
          const printWindow = window.open('', '_blank');
          if (printWindow) {
            printWindow.document.write(`
              <html>
                <head>
                  <title>Relatório da Sessão</title>
                  <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }
                    h1 { color: #2c3e50; }
                    h3 { color: #3498db; margin-top: 20px; }
                    p { margin-bottom: 10px; }
                    @media print {
                      body { padding: 0; margin: 1cm; }
                      button { display: none; }
                    }
                  </style>
                </head>
                <body>
                  <h1>Relatório da Sessão</h1>
                  ${reportText.split('\n').map(p => 
                    p.trim() ? (
                      p.startsWith('#') || p.startsWith('##') ? 
                        `<h3>${p.replace(/^#+\s+/, '')}</h3>` : 
                        `<p>${p}</p>`
                    ) : '<br>'
                  ).join('')}
                  <hr>
                  <p style="color: #7f8c8d; font-size: 0.8em;">Gerado por TerapiaConect</p>
                  <button onclick="window.print()" style="margin-top: 20px; padding: 10px 15px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Imprimir Relatório</button>
                </body>
              </html>
            `);
            printWindow.document.close();
            toast.success('Preparado para impressão!');
          } else {
            toast.error('Não foi possível abrir a janela de impressão. Verifique se os pop-ups estão permitidos.');
          }
        });
        
        // Adicionar os botões ao container
        floatingContainer.appendChild(downloadButton);
        floatingContainer.appendChild(printButton);
        
        // Adicionar o container ao documento
        document.body.appendChild(floatingContainer);
      }
      
      // Adição de backup: Forçar criação de botões diretamente no corpo da página
      if (lastResult.type === 'report') {
        setTimeout(() => {
          // Verificar se painel está visível mas sem botões
          const container = document.createElement('div');
          container.id = 'backup-report-buttons';
          container.style.position = 'fixed';
          container.style.top = '20px';
          container.style.left = '20px';
          container.style.zIndex = '9999999999';
          container.style.background = 'white';
          container.style.padding = '15px';
          container.style.borderRadius = '8px';
          container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
          container.style.display = 'flex';
          container.style.flexDirection = 'column';
          container.style.gap = '10px';
          
          const title = document.createElement('h3');
          title.textContent = 'Ações do Relatório';
          title.style.margin = '0 0 10px 0';
          title.style.fontSize = '16px';
          
          const downloadBtn = document.createElement('button');
          downloadBtn.innerHTML = '⬇️ Baixar Relatório';
          downloadBtn.style.backgroundColor = '#2196f3';
          downloadBtn.style.color = 'white';
          downloadBtn.style.border = 'none';
          downloadBtn.style.padding = '10px 16px';
          downloadBtn.style.borderRadius = '4px';
          downloadBtn.style.cursor = 'pointer';
          downloadBtn.style.fontSize = '14px';
          downloadBtn.style.display = 'flex';
          downloadBtn.style.alignItems = 'center';
          downloadBtn.style.justifyContent = 'center';
          downloadBtn.style.width = '100%';
          
          downloadBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            try {
              console.log('Iniciando download direto do botão de backup');
              
              // Obter o texto do relatório
              const reportText = lastResult.report || lastResult.data?.report || '';
              
              // Método direto de download
              const element = document.createElement('a');
              element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(reportText));
              element.setAttribute('download', 'relatorio-sessao.txt');
              element.style.display = 'none';
              
              // Adicionar ao DOM e forçar o clique
              document.body.appendChild(element);
              element.click();
              
              // Limpar
              document.body.removeChild(element);
              
              toast.success('Relatório baixado com sucesso!');
            } catch (error) {
              console.error('Erro ao baixar relatório:', error);
              toast.error('Erro ao baixar o relatório. Tente novamente.');
            }
          };
          
          const printBtn = document.createElement('button');
          printBtn.innerHTML = '🖨️ Imprimir Relatório';
          printBtn.style.backgroundColor = '#4caf50';
          printBtn.style.color = 'white';
          printBtn.style.border = 'none';
          printBtn.style.padding = '10px 16px';
          printBtn.style.borderRadius = '4px';
          printBtn.style.cursor = 'pointer';
          printBtn.style.fontSize = '14px';
          printBtn.style.display = 'flex';
          printBtn.style.alignItems = 'center';
          printBtn.style.justifyContent = 'center';
          printBtn.style.width = '100%';
          
          printBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const reportText = lastResult.report || lastResult.data?.report || '';
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
              <html>
                <head>
                  <title>Relatório da Sessão</title>
                  <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }
                    h1 { color: #2c3e50; }
                    h3 { color: #3498db; margin-top: 20px; }
                    p { margin-bottom: 10px; }
                    @media print {
                      body { padding: 0; margin: 1cm; }
                      button { display: none; }
                    }
                  </style>
                </head>
                <body>
                  <h1>Relatório da Sessão</h1>
                  ${reportText.split('\n').map(p => 
                    p.trim() ? (
                      p.startsWith('#') || p.startsWith('##') ? 
                        `<h3>${p.replace(/^#+\s+/, '')}</h3>` : 
                        `<p>${p}</p>`
                    ) : '<br>'
                  ).join('')}
                  <hr>
                  <p style="color: #7f8c8d; font-size: 0.8em;">Gerado por TerapiaConect</p>
                  <button onclick="window.print()" style="margin-top: 20px; padding: 10px 15px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Imprimir Relatório</button>
                </body>
              </html>
            `);
            printWindow.document.close();
            toast.success('Preparado para impressão!');
          };
          
          const closeBtn = document.createElement('button');
          closeBtn.innerHTML = '✖️ Fechar';
          closeBtn.style.backgroundColor = '#f44336';
          closeBtn.style.color = 'white';
          closeBtn.style.border = 'none';
          closeBtn.style.padding = '10px 16px';
          closeBtn.style.borderRadius = '4px';
          closeBtn.style.cursor = 'pointer';
          closeBtn.style.fontSize = '14px';
          closeBtn.style.display = 'flex';
          closeBtn.style.alignItems = 'center';
          closeBtn.style.justifyContent = 'center';
          closeBtn.style.width = '100%';
          
          closeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Remover os botões de backup
            const backupButtons = document.getElementById('backup-report-buttons');
            if (backupButtons) {
              backupButtons.remove();
            }
          };
          
          // Adicionar ao container
          container.appendChild(title);
          container.appendChild(downloadBtn);
          container.appendChild(printBtn);
          container.appendChild(closeBtn);
          
          // Verificar se já existe e remover
          const existingBackup = document.getElementById('backup-report-buttons');
          if (existingBackup) {
            existingBackup.remove();
          }
          
          // Adicionar ao corpo do documento
          document.body.appendChild(container);
        }, 1000);
      }
      
      // Solução radical: Mover o painel para fora do iframe
      setTimeout(() => {
        const portalDiv = document.createElement('div');
        portalDiv.id = 'ai-results-portal';
        portalDiv.style.position = 'fixed';
        portalDiv.style.top = '0';
        portalDiv.style.left = '0';
        portalDiv.style.width = '100vw';
        portalDiv.style.height = '100vh';
        portalDiv.style.zIndex = '9999999999';
        portalDiv.style.pointerEvents = 'auto';
        
        // Adicionar estilos inline para o portal
        const portalStyles = document.createElement('style');
        portalStyles.innerHTML = `
          #ai-results-portal {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 9999999999 !important;
            pointer-events: auto !important;
          }
          
          #ai-results-portal .ai-results-overlay {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            background-color: rgba(0, 0, 0, 0.7) !important;
            display: flex !important;
            justify-content: center !important;
            align-items: center !important;
            z-index: 9999999999 !important;
            pointer-events: auto !important;
          }
          
          #ai-results-portal .ai-results-panel {
            background-color: #fff !important;
            border-radius: 8px !important;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3) !important;
            width: 90% !important;
            max-width: 800px !important;
            max-height: 90vh !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
            position: relative !important;
            z-index: 9999999999 !important;
            pointer-events: auto !important;
          }
          
          #ai-results-portal .close-button,
          #ai-results-portal .pin-button,
          #ai-results-portal .ai-results-button {
            cursor: pointer !important;
            pointer-events: auto !important;
            z-index: 9999999999 !important;
          }
          
          #ai-results-portal .report-actions {
            display: flex !important;
            gap: 10px !important;
            margin-top: 20px !important;
            justify-content: flex-end !important;
            position: relative !important;
            z-index: 9999999999 !important;
          }
          
          #ai-results-portal .report-action-btn {
            background-color: #2196f3 !important;
            color: white !important;
            border: none !important;
            padding: 10px 16px !important;
            border-radius: 4px !important;
            cursor: pointer !important;
            font-size: 1em !important;
            display: flex !important;
            align-items: center !important;
            font-weight: 500 !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
            pointer-events: auto !important;
            position: relative !important;
            z-index: 9999999999 !important;
          }
          
          #ai-results-portal .report-action-btn:nth-child(2) {
            background-color: #4caf50 !important;
          }
        `;
        document.head.appendChild(portalStyles);
        
        // Adicionar ao topo do documento principal (fora de qualquer iframe)
        document.body.appendChild(portalDiv);
        
        // Forçar a remoção do antigo painel e montar um novo
        const oldPanel = document.getElementById('ai-results-overlay-panel');
        if (oldPanel) {
          try {
            // Cria uma cópia visual do painel existente
            portalDiv.innerHTML = oldPanel.outerHTML;
            // Remover o original
            oldPanel.style.display = 'none';
            
            // Adicionar handlers de eventos aos botões copiados
            // Botão de fechar no header
            const closeButtons = portalDiv.querySelectorAll('.close-button');
            closeButtons.forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleClose();
              });
            });
            
            // Botão de fechar no footer
            const footerCloseButtons = portalDiv.querySelectorAll('.ai-results-footer .ai-results-button');
            footerCloseButtons.forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleClose();
              });
            });
            
            // Botão de pin/fixar
            const pinButtons = portalDiv.querySelectorAll('.pin-button');
            pinButtons.forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePinMode();
              });
            });
            
            // Botões de relatório
            const reportActionsDiv = portalDiv.querySelectorAll('.report-actions');
            
            // Garantir que os botões estejam visíveis e clicáveis
            const buttons = reportActionsDiv.querySelectorAll('button');
            if (buttons.length === 0) {
              console.log('Recriando botões de relatório');
              
              // Se não existem botões, recria-los
              if (resultData.type === 'report') {
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'report-action-btn';
                downloadBtn.innerHTML = '<span style="margin-right: 8px;">⬇️</span> Baixar Relatório';
                downloadBtn.style.zIndex = "9999999999";
                downloadBtn.style.position = "relative";
                downloadBtn.style.pointerEvents = "auto";
                downloadBtn.onclick = (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  try {
                    console.log('Iniciando download direto do relatório recriado');
                    
                    // Obter o texto do relatório
                    const reportText = resultData.report || resultData.data?.report || '';
                    
                    // Criar o elemento para download
                    const element = document.createElement('a');
                    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(reportText));
                    element.setAttribute('download', 'relatorio-sessao.txt');
                    element.style.display = 'none';
                    
                    // Adicionar ao DOM e forçar o clique
                    document.body.appendChild(element);
                    element.click();
                    
                    // Limpar
                    document.body.removeChild(element);
                    
                    toast.success('Relatório baixado com sucesso!');
                  } catch (error) {
                    console.error('Erro ao baixar relatório:', error);
                    toast.error('Erro ao baixar o relatório. Tente novamente.');
                  }
                };
                
                const printBtn = document.createElement('button');
                printBtn.className = 'report-action-btn';
                printBtn.innerHTML = '<span style="margin-right: 8px;">🖨️</span> Imprimir';
                printBtn.style.zIndex = "9999999999";
                printBtn.style.position = "relative";
                printBtn.style.pointerEvents = "auto";
                printBtn.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  const reportText = resultData.report || resultData.data?.report || '';
                  const printWindow = window.open('', '_blank');
                  printWindow.document.write(`
                    <html>
                      <head>
                        <title>Relatório da Sessão</title>
                        <style>
                          body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }
                          h1 { color: #2c3e50; }
                          h3 { color: #3498db; margin-top: 20px; }
                          p { margin-bottom: 10px; }
                          @media print {
                            body { padding: 0; margin: 1cm; }
                            button { display: none; }
                          }
                        </style>
                      </head>
                      <body>
                        <h1>Relatório da Sessão</h1>
                        ${reportText.split('\n').map(p => 
                          p.trim() ? (
                            p.startsWith('#') || p.startsWith('##') ? 
                              `<h3>${p.replace(/^#+\s+/, '')}</h3>` : 
                              `<p>${p}</p>`
                          ) : '<br>'
                        ).join('')}
                        <hr>
                        <p style="color: #7f8c8d; font-size: 0.8em;">Gerado por TerapiaConect</p>
                        <button onclick="window.print()" style="margin-top: 20px; padding: 10px 15px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Imprimir Relatório</button>
                      </body>
                    </html>
                  `);
                  printWindow.document.close();
                  toast.success('Preparado para impressão!');
                });
                
                // Adicionar os botões recriados
                reportActionsDiv.appendChild(downloadBtn);
                reportActionsDiv.appendChild(printBtn);
              }
            } else {
              // Se existem botões, garantir que estão acessíveis
              buttons.forEach(btn => {
                btn.style.zIndex = "9999999999";
                btn.style.position = "relative";
                btn.style.display = "flex";
                btn.style.pointerEvents = "auto";
                btn.style.cursor = "pointer";
              });
            }
          } catch (e) {
            console.error('Erro ao mover painel:', e);
          }
        }
      }, 100);
      
      // Notificar o usuário quando um novo resultado chegar
      if (lastResult.type === 'report') {
        toast.success('Relatório gerado com sucesso!', {
          position: "top-center",
          autoClose: 3000
        });
      } else if (lastResult.type === 'analysis') {
        toast.info('Nova análise disponível!', {
          position: "top-center",
          autoClose: 3000
        });
      } else if (lastResult.type === 'suggestions') {
        toast.info('Novas sugestões disponíveis!', {
          position: "top-center",
          autoClose: 3000
        });
      }
    }
  }, [lastResult, isProcessing]);

  // Novo useEffect para lidar com eventos específicos do ChatGPT
  useEffect(() => {
    // Função para lidar com evento de resultado do ChatGPT
    const handleChatGPTResult = (event) => {
      console.log('AIResultsPanel: Received ChatGPT result event', event.detail);
      
      if (event.detail && event.detail.result) {
        // Forçar visibilidade e atualização do painel
        setResultData(event.detail.result);
        setVisible(true);
        
        // Injetar CSS de alta prioridade
        injectHighPriorityCSS();
        
        // Notificar usuário
        toast.success('Resposta do ChatGPT recebida');
      }
    };
    
    // Registrar ouvintes para diversos formatos de evento para maior compatibilidade
    window.addEventListener('chatgpt-result', handleChatGPTResult);
    window.addEventListener('ai-result', handleChatGPTResult);
    window.addEventListener('report-generated', handleChatGPTResult);
    document.addEventListener('chatgpt-result', handleChatGPTResult);
    document.addEventListener('ai-result', handleChatGPTResult);
    document.addEventListener('report-generated', handleChatGPTResult);
    
    return () => {
      // Limpar ouvintes ao desmontar
      window.removeEventListener('chatgpt-result', handleChatGPTResult);
      window.removeEventListener('ai-result', handleChatGPTResult);
      window.removeEventListener('report-generated', handleChatGPTResult);
      document.removeEventListener('chatgpt-result', handleChatGPTResult);
      document.removeEventListener('ai-result', handleChatGPTResult);
      document.removeEventListener('report-generated', handleChatGPTResult);
    };
  }, []);

  // Adicionar um listener para eventos de teclado para fechar com ESC
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && visible && !pinnedMode) {
        handleClose();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, pinnedMode]);
  
  // Efeito para lidar com a prioridade de camadas
  useEffect(() => {
    if (visible) {
      injectHighPriorityCSS();
      
      // Chamar função para injetar botões diretamente
      setTimeout(() => {
        injectActionButtonsDirectly();
      }, 500);
      
      // Definir temporizador para forçar a restauração da visibilidade do painel
      const forceVisibilityTimerId = setTimeout(() => {
        // Forçar o painel a aparecer mesmo se algo tentar ocultá-lo
        const portal = document.getElementById('ai-results-portal');
        if (portal) {
          portal.style.display = 'block';
          portal.style.visibility = 'visible';
          portal.style.opacity = '1';
          
          // Forçar visibilidade de todos os botões
          const buttons = portal.querySelectorAll('button');
          buttons.forEach(btn => {
            btn.style.display = 'flex';
            btn.style.visibility = 'visible';
            btn.style.opacity = '1';
          });
        }
        
        // Buscar e focar novamente em qualquer botão que pode ter perdido o foco
        setTimeout(() => {
          const downloadBtns = document.querySelectorAll('.report-action-btn');
          if (downloadBtns.length > 0) {
            try {
              // Tentar dar foco ao botão de download
              downloadBtns[0].focus();
              
              // Mostrar qual elemento tem o foco atual para debugging
              console.log('Foco atual:', document.activeElement);
            } catch (e) {
              console.error('Erro ao tentar focar botão:', e);
            }
          }
        }, 200);
      }, 500);
      
      // Tenta sobrescrever qualquer z-index aplicado dinamicamente
      const intervalId = setInterval(() => {
        const overlay = document.getElementById('ai-results-overlay-panel');
        if (overlay) {
          overlay.style.zIndex = "9999999999";
          Array.from(overlay.querySelectorAll('*')).forEach(el => {
            el.style.pointerEvents = 'auto';
          });
        }
        
        // Verificar portal para elementos interativos
        const portal = document.getElementById('ai-results-portal');
        if (portal) {
          // Garantir que todos os elementos dentro do portal tenham eventos
          try {
            if (portal && portal.querySelectorAll) {
              const interactiveElements = portal.querySelectorAll('button, a, input, select, textarea');
              if (interactiveElements.length > 0) {
                interactiveElements.forEach(el => {
                  if (el && typeof el === 'object') {
                    try {
                      el.style.pointerEvents = 'auto';
                      el.style.cursor = 'pointer';
                      el.style.zIndex = '9999999999';
                      el.style.position = 'relative';
                    } catch (styleError) {
                      console.warn('Erro ao aplicar estilo a elemento interativo:', styleError);
                    }
                  }
                });
              }
            }
          } catch (e) {
            console.error('Erro ao processar elementos interativos:', e);
          }
        }
      }, 1000);
      
      return () => {
        clearInterval(intervalId);
        clearTimeout(forceVisibilityTimerId);
      };
    } else {
      // Restaurar interatividade quando o painel está fechado
      const jitsiElements = document.querySelectorAll('#jitsiConferenceFrame0, #new-toolbox, .filmstrip, .subject, .watermark, .tOQNJSLwCYnxUY3bW0zj');
      jitsiElements.forEach(el => {
        if (el) el.style.pointerEvents = 'auto';
      });
    }
  }, [visible]);

  // Função simplificada para fechar o painel de resultados
  const handleClose = useCallback(() => {
    console.log('AIResultsPanel: Fechando painel de resultados (versão simplificada)');
    
    try {
      // Primeiro, alterar os estados React
      setVisible(false);
      
      // Remover apenas o CSS injetado
      const styleElement = document.getElementById('ai-results-priority-styles');
      if (styleElement) {
        styleElement.remove();
      }
      
      // Remover elementos específicos sem afetar a navegação
      try {
        const floatingButtons = document.getElementById('floating-report-buttons');
        if (floatingButtons) floatingButtons.parentNode.removeChild(floatingButtons);
      } catch (e) {
        console.log('Não foi possível remover floating-report-buttons');
      }
      
      try {
        const backupButtons = document.getElementById('backup-report-buttons');
        if (backupButtons) backupButtons.parentNode.removeChild(backupButtons);
      } catch (e) {
        console.log('Não foi possível remover backup-report-buttons');
      }
      
      try {
        const directActions = document.getElementById('direct-report-actions');
        if (directActions) directActions.parentNode.removeChild(directActions);
      } catch (e) {
        console.log('Não foi possível remover direct-report-actions');
      }
      
      // Opcionalmente, desativar a função de remoção do botão se existir
      if (typeof removeButtonFn === 'function') {
        try {
          removeButtonFn();
        } catch (e) {
          console.log('Erro na função removeButtonFn:', e.message);
        }
      }
      
      // Restaurar o overflow do body se houver sido alterado
      document.body.style.overflow = '';
      
      // Restaurar interatividade de elementos
      const jitsiElements = document.querySelectorAll('#jitsiConferenceFrame0, #new-toolbox, .filmstrip, .subject, .watermark, .tOQNJSLwCYnxUY3bW0zj');
      jitsiElements.forEach(el => {
        if (el) el.style.pointerEvents = 'auto';
      });
      
      // Limpar resultado apenas depois de remover os elementos visuais
      setTimeout(() => {
        setResultData(null);
      }, 100);
    } catch (error) {
      console.error('Erro ao fechar o painel:', error);
      
      // Falhar com segurança - só alterar os estados do React
      setVisible(false);
      
      // Limpar resultado apenas depois de remover os elementos visuais
      setTimeout(() => {
        setResultData(null);
      }, 100);
    }
    
    // Notificar o usuário sem causar problemas adicionais
    try {
      toast.info('Painel fechado');
    } catch (e) {
      console.log('Não foi possível mostrar toast');
    }
  }, [removeButtonFn]);
  
  const togglePinMode = () => {
    setPinnedMode(!pinnedMode);
    toast.info(
      !pinnedMode 
        ? '📌 Painel fixado na tela' 
        : '🔓 Painel desfixado',
      { autoClose: 2000 }
    );

    // Forçar recriação dos botões quando o modo é alterado
    setTimeout(() => {
      injectActionButtonsDirectly();
    }, 200);
  };

  // Nova função para injetar botões diretamente no corpo do painel
  const injectActionButtonsDirectly = () => {
    if (!resultData || resultData.type !== 'report') return;
    
    // Tentar encontrar o painel primeiro
    const panels = [
      document.getElementById('ai-results-portal'),
      document.getElementById('ai-results-overlay-panel'),
      document.body
    ];
    
    for (const panel of panels) {
      if (!panel) continue;
      
      // Verificar se já existe botão de ações diretas
      const existingActions = panel.querySelector('#direct-report-actions');
      if (existingActions) {
        existingActions.remove();
      }
      
      // Criar container para os botões
      const actionsContainer = document.createElement('div');
      actionsContainer.id = 'direct-report-actions';
      actionsContainer.style.position = 'fixed';
      actionsContainer.style.top = '50%';
      actionsContainer.style.left = '50%';
      actionsContainer.style.transform = 'translate(-50%, -50%)';
      actionsContainer.style.zIndex = '9999999999';
      actionsContainer.style.display = 'flex';
      actionsContainer.style.flexDirection = 'column';
      actionsContainer.style.gap = '15px';
      actionsContainer.style.backgroundColor = 'white';
      actionsContainer.style.padding = '20px';
      actionsContainer.style.borderRadius = '10px';
      actionsContainer.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';
      actionsContainer.style.width = '300px';
      actionsContainer.style.textAlign = 'center';
      
      // Adicionar título
      const title = document.createElement('h3');
      title.textContent = 'Ações para o Relatório';
      title.style.marginTop = '0';
      title.style.marginBottom = '15px';
      title.style.color = '#333';
      title.style.fontSize = '18px';
      
      // Adicionar botão de download
      const downloadBtn = document.createElement('button');
      downloadBtn.innerHTML = '⬇️ Baixar Relatório';
      downloadBtn.style.backgroundColor = '#2196f3';
      downloadBtn.style.color = 'white';
      downloadBtn.style.border = 'none';
      downloadBtn.style.padding = '12px 20px';
      downloadBtn.style.borderRadius = '50px';
      downloadBtn.style.cursor = 'pointer';
      downloadBtn.style.fontSize = '16px';
      downloadBtn.style.fontWeight = 'bold';
      downloadBtn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
      downloadBtn.style.display = 'flex';
      downloadBtn.style.alignItems = 'center';
      downloadBtn.style.justifyContent = 'center';
      downloadBtn.style.width = '100%';
      
      downloadBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          const reportText = resultData.report || resultData.data?.report || '';
          const element = document.createElement('a');
          element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(reportText));
          element.setAttribute('download', 'relatorio-sessao.txt');
          element.style.display = 'none';
          document.body.appendChild(element);
          element.click();
          document.body.removeChild(element);
          toast.success('Relatório baixado com sucesso!');
        } catch (error) {
          console.error('Erro ao baixar relatório:', error);
          toast.error('Erro ao baixar relatório. Tente novamente.');
        }
      };
      
      // Adicionar botão de impressão
      const printBtn = document.createElement('button');
      printBtn.innerHTML = '🖨️ Imprimir Relatório';
      printBtn.style.backgroundColor = '#4caf50';
      printBtn.style.color = 'white';
      printBtn.style.border = 'none';
      printBtn.style.padding = '12px 20px';
      printBtn.style.borderRadius = '50px';
      printBtn.style.cursor = 'pointer';
      printBtn.style.fontSize = '16px';
      printBtn.style.fontWeight = 'bold';
      printBtn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
      printBtn.style.display = 'flex';
      printBtn.style.alignItems = 'center';
      printBtn.style.justifyContent = 'center';
      printBtn.style.width = '100%';
      
      printBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const reportText = resultData.report || resultData.data?.report || '';
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
          <html>
            <head>
              <title>Relatório da Sessão</title>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }
                h1 { color: #2c3e50; }
                h3 { color: #3498db; margin-top: 20px; }
                p { margin-bottom: 10px; }
                @media print {
                  body { padding: 0; margin: 1cm; }
                  button { display: none; }
                }
              </style>
            </head>
            <body>
              <h1>Relatório da Sessão</h1>
              ${reportText.split('\n').map(p => 
                p.trim() ? (
                  p.startsWith('#') || p.startsWith('##') ? 
                    `<h3>${p.replace(/^#+\s+/, '')}</h3>` : 
                    `<p>${p}</p>`
                ) : '<br>'
              ).join('')}
              <hr>
              <p style="color: #7f8c8d; font-size: 0.8em;">Gerado por TerapiaConect</p>
              <button onclick="window.print()" style="margin-top: 20px; padding: 10px 15px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Imprimir Relatório</button>
            </body>
          </html>
        `);
        printWindow.document.close();
        toast.success('Preparado para impressão!');
      };
      
      // Botão para fechar o painel de ações
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '❌ Fechar';
      closeBtn.style.backgroundColor = '#f44336';
      closeBtn.style.color = 'white';
      closeBtn.style.border = 'none';
      closeBtn.style.padding = '12px 20px';
      closeBtn.style.borderRadius = '50px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.fontSize = '16px';
      closeBtn.style.fontWeight = 'bold';
      closeBtn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
      closeBtn.style.display = 'flex';
      closeBtn.style.alignItems = 'center';
      closeBtn.style.justifyContent = 'center';
      closeBtn.style.width = '100%';
      
      closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Remover apenas este painel de ações
        actionsContainer.remove();
      };
      
      // Adicionar elementos ao container
      actionsContainer.appendChild(title);
      actionsContainer.appendChild(downloadBtn);
      actionsContainer.appendChild(printBtn);
      actionsContainer.appendChild(closeBtn);
      
      // Adicionar container ao painel
      panel.appendChild(actionsContainer);
      break;
    }
  };

  if (!visible || !resultData) return null;

  console.log('AIResultsPanel: Rendering with data:', resultData);
  
  // Garantir que temos um título apropriado
  const getTitle = () => {
    if (resultData.type === 'analysis') return '🔍 Análise da Sessão';
    if (resultData.type === 'suggestions') return '💡 Sugestões';
    if (resultData.type === 'report') return '📝 Relatório da Sessão';
    return '🤖 Resultados da IA';
  };
  
  // Garantir que temos sugestões para exibir
  const getSuggestions = () => {
    if (!resultData.suggestions) return [];
    
    if (Array.isArray(resultData.suggestions)) {
      return resultData.suggestions.length > 0 
        ? resultData.suggestions 
        : ['Não há sugestões específicas para esta conversa no momento.'];
    }
    
    return [resultData.suggestions];
  };
  
  return (
    <>
      {visible && resultData && (
        <div 
          id="ai-results-overlay-panel"
          className={`ai-results-overlay ${pinnedMode ? 'pinned' : ''}`}
          style={{
            display: 'flex',
            visibility: 'visible',
            opacity: 1,
            zIndex: 99999999999
          }}
        >
          <div className="ai-results-panel">
            <div className="ai-results-header">
              <h2>{getTitle()}</h2>
              <div className="ai-results-controls">
                <button 
                  className="pin-button"
                  onClick={togglePinMode}
                  title={pinnedMode ? "Desafixar painel" : "Fixar painel"}
                >
                  📌
                </button>
                <button 
                  className="close-button"
                  onClick={handleClose}
                  title="Fechar"
                >
                  ✖
                </button>
              </div>
            </div>
            <div className="ai-results-content">
              {resultData.type === 'analysis' && (
                <div className="ai-analysis-result">
                  {resultData.analysis ? (
                    <p>{resultData.analysis}</p>
                  ) : resultData.content ? (
                    <p>{resultData.content}</p>
                  ) : (
                    <p>Nenhuma análise disponível.</p>
                  )}
                </div>
              )}
              
              {resultData.type === 'suggestions' && (
                <div className="ai-suggestions-result">
                  {resultData.suggestions && resultData.suggestions.length > 0 ? (
                    <ul>
                      {getSuggestions().map((suggestion, index) => (
                        <li key={index}>{suggestion}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>Nenhuma sugestão disponível.</p>
                  )}
                </div>
              )}
              
              {resultData.type === 'report' && (
                <div className="ai-report-result">
                  {resultData.report ? (
                    <div className="report-text">
                      {resultData.report.split('\n').map((paragraph, index) => (
                        paragraph.trim() ? (
                          paragraph.startsWith('#') ? (
                            <h3 key={index}>{paragraph.replace(/^#+\s+/, '')}</h3>
                          ) : (
                            <p key={index}>{paragraph}</p>
                          )
                        ) : (
                          <br key={index} />
                        )
                      ))}
                      
                      <div className="report-actions">
                        <button 
                          className="report-action-btn"
                          onClick={downloadReport}
                        >
                          ⬇️ Baixar Relatório
                        </button>
                        <button 
                          className="report-action-btn"
                          onClick={printReport}
                        >
                          🖨️ Imprimir Relatório
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p>Relatório não disponível.</p>
                  )}
                </div>
              )}
              
              {resultData.error && (
                <div className="ai-error-result">
                  <p className="error-message">{resultData.error}</p>
                  {resultData.message && (
                    <p className="error-details">{resultData.message}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AIResultsPanel; 