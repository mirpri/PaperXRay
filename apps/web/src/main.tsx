import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LibraryPage } from "./pages/LibraryPage";
import { ReaderPage } from "./pages/ReaderPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RequireAuth>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/documents/:id" element={<ReaderPage />} />
          </Routes>
        </RequireAuth>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
