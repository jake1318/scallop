// src/App.tsx
import { Link, Routes, Route } from "react-router-dom";
import { ConnectButton, useWallet } from "@suiet/wallet-kit";
import HomePage from "./pages/HomePage";
import LendingPage from "./pages/LendingPage";
import "./App.css";

function App() {
  const { address } = useWallet();
  return (
    <div className="app-container">
      <header className="app-header">
        <nav className="nav-links">
          <Link to="/">Home</Link>
          <Link to="/lending">Lending</Link>
        </nav>
        <div className="wallet-info">
          <ConnectButton className="connect-button" />
        </div>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/lending" element={<LendingPage />} />
      </Routes>
    </div>
  );
}

export default App;
