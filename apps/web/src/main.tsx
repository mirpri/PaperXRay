import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LibraryPage } from "./pages/LibraryPage";
import { ReaderPage } from "./pages/ReaderPage";
import { LensesPage } from "./pages/LensesPage";
import { NotificationProvider } from "./NotificationContext";
import { MessagesPage } from "./pages/MessagesPage";
import { AdminPage } from "./pages/AdminPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RequireAuth>
          <NotificationProvider>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/documents/:id" element={<ReaderPage />} />
            <Route path="/lenses" element={<LensesPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/messages" element={<MessagesPage />} />
          </Routes>
          </NotificationProvider>
        </RequireAuth>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
