import React from "react";
import { useNavigate } from "react-router-dom";
import "../styles/HomePage.scss";

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <main className="home-page">
      <h1>🏦 Scallop Lending on Sui</h1>
      <p>
        Supply assets to earn interest, or borrow against your deposits using
        the Scallop Protocol on the Sui blockchain.
      </p>
      <button className="enter-button" onClick={() => navigate("/lending")}>
        Go to Lending Market
      </button>
    </main>
  );
};

export default HomePage;
