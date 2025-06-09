import React from "react";
import { Link } from "react-router-dom";
import { ConnectButton } from "@suiet/wallet-kit";
import "../styles/theme.scss";

const NavBar: React.FC = () => (
  <nav className="navbar">
    <div className="nav-links">
      <Link to="/">Home</Link>
      <Link to="/lend">Lending</Link>
    </div>
    <ConnectButton />
  </nav>
);

export default NavBar;
