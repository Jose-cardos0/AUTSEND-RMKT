import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Sem React.StrictMode: o editor de e-mail (Easy Email) não é StrictMode-safe —
// o duplo mount/unmount do StrictMode em dev quebra a inicialização dos painéis
// (blocos e configuração ficam vazios). StrictMode é só auxiliar de dev; não afeta produção.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
