import './index.css';
import './styles/custom.css'; // Importando estilos personalizados
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter } from 'react-router-dom';

// DESATIVADO: Import do HybridAI comentado
// import hybridAIService from './services/hybridAI.service';

// Flags globais para desativar completamente o HybridAI
window.__HYBRID_AI_ACTIVE = false;
window.__HYBRID_AI_DISABLED = true;
window.__HYBRID_AI_FORCE_DISABLED = true;

// DESATIVADO: Serviço HybridAI comentado para evitar qualquer tipo de inicialização
// window.hybridAIService = hybridAIService;

// DESATIVADO: Inicialização do HybridAI removida completamente
/*
hybridAIService.initService().then(success => {
  console.log('HybridAI: Serviço inicializado com sucesso =', success);
  hybridAIService.toggleAutoRestart(false);
}).catch(error => {
  console.error('Erro ao inicializar HybridAI:', error);
});
*/

// Log para informar que o HybridAI está completamente desativado
console.log('⛔⛔⛔ HybridAI: Serviço TOTALMENTE DESATIVADO');
console.log('⛔⛔⛔ HybridAI: Todos os imports e inicializações foram removidos');

// Também desabilitar versão global para impedir qualquer tentativa de inicialização
if (typeof window !== 'undefined') {
  window.HybridAIService = null;
  window.hybridAIService = null;
}

// Configurar default para toasts
toast.configure = () => {};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
        limit={5}
      />
    </BrowserRouter>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals(); 