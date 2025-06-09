// main.tsx
import { Buffer } from "buffer";
if (typeof window !== "undefined" && !(window as any).Buffer) {
  (window as any).Buffer = Buffer;
}
if (!Buffer.prototype.readUint8)
  Buffer.prototype.readUint8 = Buffer.prototype.readUInt8;

import React from "react";
import ReactDOM from "react-dom/client";
import { WalletProvider } from "@suiet/wallet-kit";
import App from "./App";
import "./styles/global.scss";
import "@suiet/wallet-kit/style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider autoConnect={true}>
      <App />
    </WalletProvider>
  </React.StrictMode>
);
