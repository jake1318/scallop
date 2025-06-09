import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ConnectButton } from "@suiet/wallet-kit";
import "../styles/Navbar.scss";

const Navbar: React.FC = () => {
  const location = useLocation();
  return (
    <header className="navbar">
      <div className="navbar__left">
        <Link to="/" className="navbar__brand">
          🏦 Scallop Lending
        </Link>
      </div>
      <nav className="navbar__center">
        <Link to="/" className={location.pathname === "/" ? "active" : ""}>
          Home
        </Link>
        <Link
          to="/lending"
          className={location.pathname === "/lending" ? "active" : ""}
        >
          Lending
        </Link>
      </nav>
      <div className="navbar__right">
        <ConnectButton className="wallet-button" />
      </div>
    </header>
  );
};

export default Navbar;
