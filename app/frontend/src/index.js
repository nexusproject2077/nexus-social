// nexus-social/app/frontend/src/index.js

import React from "react";
import ReactDOM from "react-dom/client";
import '../index.css'; // ✅ Correction : Chemin relatif pour le CSS
import App from "../App"; // ✅ Correction : Chemin relatif pour le composant App

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
