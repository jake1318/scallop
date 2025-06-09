import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { WalletProvider } from "@suiet/wallet-kit";
import "@suiet/wallet-kit/style.css";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import LendingPage from "./pages/LendingPage";
import "./App.css";

function App() {
  return (
    <WalletProvider autoConnect={true}>
      <Router>
        <div className="App">
          <Navbar />
          <div className="container">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/lending" element={<LendingPage />} />
            </Routes>
          </div>
        </div>
      </Router>
    </WalletProvider>
  );
}

export default App;
